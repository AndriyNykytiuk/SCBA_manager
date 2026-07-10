# SCBA Manager — API-контракт (REST, /api/v1)

> Статус: ПРОЕКТ (етап дизайну), версія 1.0 від 2026-07-10.
> Відповідає: `docs/requirements.md` v1.0, `docs/backend/db-schema.md` (сутності, статуси,
> VIEW, інваріанти S1–S8, дефолти DB-1…DB-5), `docs/design/screens.md` (потреби екранів,
> зокрема ВП-6 — активна сесія заправки на сервері).

---

## 1. Загальні угоди

### 1.1 Базові правила

- База: `https://<host>/api/v1`. Формат — JSON (`Content-Type: application/json; charset=utf-8`).
- Автентифікація: `Authorization: Bearer <access_token>` (JWT, TTL **1 година**) + refresh-токен
  (ротація, зберігається як hash у `refresh_token`, див. схему §3.2).
- Ідентифікатори — `uuid`. Час — ISO 8601 з таймзоною (`2026-07-10T14:02:11+03:00`),
  «календарні» дати — `YYYY-MM-DD`.
- **Видалення відсутнє.** Замість `DELETE` — архівація: `POST /<entity>/{id}/archive`
  та `POST /<entity>/{id}/restore`. Історійні записи (hydro-tests, склад апарата,
  сесії, ТО, аудит) — append-only, не редагуються і не архівуються.
- Статуси придатності (`ok | warning | overdue`) та всі дати «наступного…» **рахує бекенд**
  (VIEW зі схеми §4) і повертає готовими у відповідях. Клієнт нічого не дообчислює.
- Кожна мутація пише `audit_log` у тій самій транзакції (інваріант **S8**) — окремих
  ендпоінтів для цього немає; заголовок `X-Request-Id` (якщо переданий) зберігається
  в `audit_log.request_id`.

### 1.2 Ролі та станційний скоупінг

| Роль | Читання | Запис | Станції |
|---|---|---|---|
| `admin` | все | все (у MVP) | усі; **обирає активну станцію** параметром `station_id` |
| `master` | своя станція | своя станція | `station_id` береться з JWT |
| `duty` | своя станція | **нічого** (read-only) | `station_id` береться з JWT |

- Для station-scoped ресурсів (`storage-locations`, `backplates`, `cylinders`,
  `apparatus`, `compressors`, `fill-sessions`, `dashboard`):
  - `master` / `duty`: станція завжди з токена. Явно переданий `station_id`, що
    не збігається з токеном → `403 STATION_SCOPE_VIOLATION`.
  - `admin`: **зобовʼязаний** передавати `?station_id=<uuid>` у списках/дашборді
    (перемикач станції в хедері, screens.md §7); без нього → `422 VALIDATION_ERROR`.
    Для запитів по `{id}` станція визначається самим записом.
- Будь-яка мутація від `duty` → `403 ROLE_FORBIDDEN`.
- `/stations`, `/users` — глобальні ресурси, тільки `admin` (виняток: `GET /auth/me`).

### 1.3 Списки: пагінація, фільтри, сортування

Спільні query-параметри всіх списків:

| Параметр | Тип | Дефолт | Опис |
|---|---|---|---|
| `page` | int ≥ 1 | 1 | сторінка |
| `limit` | int 1–100 | 25 | розмір сторінки |
| `q` | string | — | пошук за номером/назвою (ILIKE) |
| `status` | `ok\|warning\|overdue` | — | фільтр за розрахованим статусом |
| `include_archived` | bool | `false` | показувати архівні (для чипа «Списані») |
| `sort` | string | ресурсо-залежний | напр. `sort=next_hydro_test_at` / `-created_at` |

Конверт відповіді списків:

```json
{
  "data": [ { } ],
  "meta": { "page": 1, "limit": 25, "total": 48 }
}
```

### 1.4 Єдиний формат помилок

```json
{
  "error": {
    "code": "CYLINDER_ALREADY_INSTALLED",
    "message": "Балон №0417 вже встановлений в апараті bS-4343234",
    "details": [
      { "field": "cylinder_id", "rule": "unique_current_installation" }
    ]
  }
}
```

`message` — готовий текст українською (для тостів/банерів), `details` — машинні
дані для полів форм (для zod-помилок: `{ "field": "...", "rule": "...", "message": "..." }`).

**HTTP-коди та коди помилок:**

| HTTP | `error.code` | Коли |
|---|---|---|
| 401 | `UNAUTHENTICATED` | немає/битий access-токен |
| 401 | `TOKEN_EXPIRED` | access-токен протух → клієнт іде на `/auth/refresh` |
| 401 | `REFRESH_TOKEN_INVALID` | refresh протух/відкликаний/повторно вжитий → на /login |
| 403 | `ROLE_FORBIDDEN` | мутація від `duty`; не-admin на `/users`, `/stations` |
| 403 | `STATION_SCOPE_VIOLATION` | доступ до чужої станції (master/duty) |
| 403 | `USER_DEACTIVATED` | `is_active = false` |
| 404 | `NOT_FOUND` | немає запису / запис іншої станції для master-duty (не розкриваємо існування) |
| 409 | `CONFLICT` + специфічні коди нижче | конфлікт стану |
| 422 | `VALIDATION_ERROR` | zod-валідація тіла/query |
| 500 | `INTERNAL` | неочікувана помилка (з `request_id`) |

**Мапінг 409/422 на інваріанти сервісного шару S1–S8 (db-schema.md §5):**

| Інваріант | `error.code` | HTTP |
|---|---|---|
| S1 — компонент з іншої станції | `STATION_MISMATCH` | 409 |
| S2 — заархівований компонент / в заархівований апарат | `COMPONENT_ARCHIVED` | 409 |
| S3 — ложамент уже в живому апараті | `BACKPLATE_ALREADY_IN_APPARATUS` | 409 |
| S3/S6 — балон уже стоїть в апараті | `CYLINDER_ALREADY_INSTALLED` | 409 |
| S4 — архівація компонента, що стоїть в апараті | `COMPONENT_IN_USE` | 409 |
| S5 — «Стоп» не автором/не майстром станції | `FILL_SESSION_FORBIDDEN` | 403 |
| — компресор уже має активну сесію (partial unique `ux_fill_session_active`) | `FILL_SESSION_ALREADY_ACTIVE` | 409 |
| S6 — «окремий балон» насправді в апараті / апарат без балонів у сесії | `CYLINDER_NOT_FREE` / `APPARATUS_EMPTY` | 409 |
| S7 — гідротест давніший за останній наявний | `HYDRO_TEST_DATE_REGRESSION` | 422 |
| — зайнятий номер/логін/назва серед живих записів | `DUPLICATE_NAME` | 409 |
| — позиція балона в апараті зайнята | `POSITION_OCCUPIED` | 409 |

---

## 2. Auth

### POST /auth/login — всі, без токена

```json
// Request
{ "login": "petrenko", "password": "•••••••" }

// 200
{
  "access_token": "eyJhbGciOi...",
  "expires_in": 3600,
  "refresh_token": "d5f1c2…(opaque, 256 біт)",
  "user": {
    "id": "b1e0…", "login": "petrenko", "full_name": "Іван Петренко",
    "role": "master",
    "station": { "id": "a7c3…", "name": "ДПРЧ-12" }
  }
}
```

Помилки: `401 UNAUTHENTICATED` («Невірний логін або пароль» — однаково для
неіснуючого логіна й хибного пароля), `403 USER_DEACTIVATED`.

### POST /auth/refresh — без access-токена

```json
// Request
{ "refresh_token": "d5f1c2…" }

// 200 — ротація: старий revoked_at + replaced_by, виданий новий
{ "access_token": "…", "expires_in": 3600, "refresh_token": "нове значення" }
```

Повторне використання вже ротованого refresh-токена → `401 REFRESH_TOKEN_INVALID`
і відкликання всього ланцюжка користувача (захист від крадіжки).

### POST /auth/logout — будь-яка роль

```json
// Request
{ "refresh_token": "d5f1c2…" }
// 204 No Content  (revoked_at = now(); access-токен добуває свою годину)
```

### GET /auth/me — будь-яка роль

Повертає `user` (як у login) — для відновлення сесії на старті SPA.

---

## 3. Stations — тільки `admin`

| Метод | Шлях | Опис |
|---|---|---|
| GET | `/stations` | список (+ `meta`), з лічильниками для перемикача станції |
| POST | `/stations` | створити |
| GET | `/stations/{id}` | картка |
| PATCH | `/stations/{id}` | оновити `name`, `address` |
| POST | `/stations/{id}/archive`, `/restore` | архівація/відновлення |

```json
// GET /stations → елемент data[] (лічильники — для SelectSheet у хедері, screens.md §7)
{
  "id": "a7c3…", "name": "ДПРЧ-12", "address": "м. Київ, вул. …",
  "alert_counters": { "overdue": 3, "warning": 7 },
  "created_at": "2026-07-01T10:00:00+03:00", "archived_at": null
}

// POST /stations — request
{ "name": "ДПРЧ-14", "address": "…" }   // 201 → повний обʼєкт
```

Помилки: `409 DUPLICATE_NAME` (жива станція з такою назвою).

---

## 4. Users — тільки `admin`

| Метод | Шлях | Опис |
|---|---|---|
| GET | `/users` | список; фільтри `role`, `station_id`, `is_active`, `q` (ПІБ/логін) |
| POST | `/users` | створити (єдиний спосіб появи облікового запису) |
| GET | `/users/{id}` | картка |
| PATCH | `/users/{id}` | `full_name`, `role`, `station_id`, `is_active` |
| POST | `/users/{id}/reset-password` | адмін задає новий пароль |
| POST | `/users/{id}/archive`, `/restore` | архівація/відновлення |

```json
// POST /users — request
{
  "login": "kovalchuk",
  "password": "Тимчасовий#1",
  "full_name": "Олена Ковальчук",
  "role": "duty",                       // 'admin' | 'master' | 'duty'
  "station_id": "a7c3…"                 // обовʼязково для master/duty; для admin — null
}

// 201
{
  "id": "c9d2…", "login": "kovalchuk", "full_name": "Олена Ковальчук",
  "role": "duty", "station": { "id": "a7c3…", "name": "ДПРЧ-12" },
  "is_active": true, "created_at": "…", "archived_at": null
}

// POST /users/{id}/reset-password — request
{ "new_password": "Новий#пароль2" }     // 204; усі refresh-токени користувача відкликаються
```

Валідація (CHECK `chk_user_station_scope`): `role='admin'` ⇔ `station_id=null`,
інакше `422 VALIDATION_ERROR`. Дублікат логіна → `409 DUPLICATE_NAME`.
«Деактивувати» з екрана admin = `PATCH { "is_active": false }` (+ відкликання refresh).

---

## 5. Storage locations (довідник місць зберігання)

Читання: `master`, `duty`, `admin`. Запис: `master` (своя станція), `admin`.

| Метод | Шлях |
|---|---|
| GET | `/storage-locations` |
| POST | `/storage-locations` |
| PATCH | `/storage-locations/{id}` |
| POST | `/storage-locations/{id}/archive`, `/restore` |

```json
// GET → елемент data[]
{ "id": "f2a1…", "station_id": "a7c3…", "name": "Шафа №2", "archived_at": null }

// POST — request (admin додатково передає station_id)
{ "name": "Шафа №3" }
```

---

## 6. Backplates (ложаменти)

Читання: всі ролі (своя станція / admin — будь-яка). Запис: `master`, `admin`.

| Метод | Шлях | Опис |
|---|---|---|
| GET | `/backplates` | список; фільтри: спільні + `backplate_status` (`in_apparatus\|free\|in_repair\|decommissioned`) |
| POST | `/backplates` | створити |
| GET | `/backplates/{id}` | картка |
| PATCH | `/backplates/{id}` | оновлення полів, вкл. `reducer_last_replaced_at` («Зафіксувати заміну редуктора» — це PATCH цього поля), `status` (`free`/`in_repair`) |
| POST | `/backplates/{id}/archive` | списання: ставить `status='decommissioned'` + `archived_at` (CHECK `chk_backplate_decommissioned`) |
| POST | `/backplates/{id}/restore` | відновлення (статус → `free`) |

```json
// POST /backplates — request
{
  "name": "bS-4343234",
  "manufacturer": "Dräger", "model": "PSS 4000", "serial_number": "SN-88112",
  "commissioned_at": "2022-03-15",
  "reducer_last_replaced_at": "2025-06-24",
  "reducer_interval_months": 14,
  "notes": null
}

// 200 GET /backplates/{id} — розрахунки з v_backplate_status
{
  "id": "e4b7…", "station_id": "a7c3…",
  "name": "bS-4343234",
  "manufacturer": "Dräger", "model": "PSS 4000", "serial_number": "SN-88112",
  "commissioned_at": "2022-03-15",
  "reducer_last_replaced_at": "2025-06-24",
  "reducer_interval_months": 14,
  "next_reducer_replacement_at": "2026-08-24",
  "status": "in_apparatus",                    // операційний статус (enum backplate_status)
  "condition": {                                // придатність (VIEW), поріг warning = 60 днів (DB-1)
    "status": "warning",
    "reason": "Заміна редуктора через 45 дн",
    "due_at": "2026-08-24"
  },
  "apparatus": { "id": "77aa…", "name": "bS-4343234" },   // null, якщо вільний
  "notes": null,
  "created_at": "…", "updated_at": "…", "archived_at": null
}
```

Помилки: `409 DUPLICATE_NAME` (жива назва в межах станції, DB-5);
`409 COMPONENT_IN_USE` — архівація/`in_repair` для ложамента, що стоїть у живому
апараті (**S4**; текст: «Спочатку розберіть апарат bS-…»).

> Поле `condition.reason` — готовий текст badge: скрізь однаковий (вимога screens.md §8).

---

## 7. Cylinders (балони) + hydro-tests

Читання: всі ролі. Запис: `master`, `admin`.

| Метод | Шлях | Опис |
|---|---|---|
| GET | `/cylinders` | список; фільтри: спільні + `material` (`metal\|composite`), `volume_l` (`6\|6.8\|7`), `installed` (`true\|false` — в апараті / вільні) |
| POST | `/cylinders` | створити (з першим гідротестом — див. нижче) |
| GET | `/cylinders/{id}` | картка |
| PATCH | `/cylinders/{id}` | оновлення полів (номер, тиск, EOL, `hydro_interval_months`, нотатки) |
| PUT | `/cylinders/{id}/next-hydro-test-override` | ручне коригування дати наступного гідротесту; `{"date": null}` = повернути авторозрахунок |
| GET | `/cylinders/{id}/hydro-tests` | історія гідротестів (append-only, `sort=-tested_at`) |
| POST | `/cylinders/{id}/hydro-tests` | «Зафіксувати гідротест» |
| POST | `/cylinders/{id}/archive`, `/restore` | списання/відновлення |

```json
// POST /cylinders — request
{
  "number": "0417",
  "volume_l": 6.8,                       // тільки 6 | 6.8 | 7 (CHECK)
  "material": "composite",
  "working_pressure_bar": 300,           // 1..450 (CHECK)
  "manufacturer": "Luxfer",
  "manufactured_at": "2019-03-01",
  "end_of_life_at": "2034-03-01",        // > manufactured_at (CHECK)
  "hydro_interval_months": 60,           // вводить майстер; > 0
  "last_hydro_test_at": "2021-06-12",    // обовʼязково → перший рядок hydro_test (схема §3.5)
  "notes": null
}

// 200 GET /cylinders/{id} — розрахунки з v_cylinder_status
{
  "id": "91fe…", "station_id": "a7c3…",
  "number": "0417", "volume_l": 6.8, "material": "composite",
  "working_pressure_bar": 300, "manufacturer": "Luxfer",
  "manufactured_at": "2019-03-01", "end_of_life_at": "2034-03-01",
  "hydro_interval_months": 60,
  "last_hydro_test_at": "2021-06-12",
  "next_hydro_test_at": "2026-06-12",           // COALESCE(override, last + interval); fallback-база manufactured_at (DB-4)
  "next_hydro_test_override": null,             // null = авторозрахунок
  "condition": { "status": "overdue", "reason": "Гідротест прострочено 28 дн", "due_at": "2026-06-12" },
  "installation": {                              // null, якщо вільний
    "apparatus_id": "77aa…", "apparatus_name": "bS-4343234", "position": 1
  },
  "notes": null, "created_at": "…", "updated_at": "…", "archived_at": null
}

// PUT /cylinders/{id}/next-hydro-test-override — request
{ "date": "2026-09-01" }        // або { "date": null } — скинути
// 200 → оновлена картка балона (з перерахованими next_hydro_test_at / condition)

// POST /cylinders/{id}/hydro-tests — request («Зафіксувати гідротест»)
{
  "tested_at": "2026-07-10",     // ≤ сьогодні (CHECK); ≥ дати останнього тесту (S7)
  "performed_by": "b1e0…",       // uuid користувача або null (зовнішня лабораторія)
  "notes": "Лаб. №3, протокол 118/26"
}

// 201
{
  "id": "3c44…", "cylinder_id": "91fe…", "tested_at": "2026-07-10",
  "performed_by": { "id": "b1e0…", "full_name": "Іван Петренко" },
  "notes": "Лаб. №3, протокол 118/26",
  "created_at": "…",
  "cylinder": { "next_hydro_test_at": "2031-07-10", "condition": { "status": "ok" } }
}
```

Правила:
- Після `POST hydro-tests` бекенд **скидає `next_hydro_test_override`** (інваріант
  **S7**; UI показує прев'ю нової дати з можливістю одразу поставити новий override).
- `tested_at` раніший за останній наявний тест → `422 HYDRO_TEST_DATE_REGRESSION`.
- Архівація балона, що стоїть в апараті → `409 COMPONENT_IN_USE` (**S4**).
- Дублікат номера в межах станції → `409 DUPLICATE_NAME` (DB-5).

---

## 8. Apparatus (апарати): склад, установка/зняття, історія

Читання: всі ролі. Запис: `master`, `admin`.
Ідентифікатор апарата для людей/QR = **назва ложамента** (U-1).

| Метод | Шлях | Опис |
|---|---|---|
| GET | `/apparatus` | список; фільтри: спільні + `assembled` (`true\|false` — розібрані), `storage_location_id`, `backplate_name` (точний збіг — резолв QR-скану) |
| POST | `/apparatus` | зібрати апарат (ложамент + 0–2 балони + місце) |
| GET | `/apparatus/{id}` | картка з компонентами |
| PATCH | `/apparatus/{id}` | `storage_location_id`, `notes` |
| POST | `/apparatus/{id}/cylinders` | встановити балон на позицію |
| POST | `/apparatus/{id}/cylinders/{position}/remove` | зняти балон з позиції (1 або 2) |
| POST | `/apparatus/{id}/disassemble` | «Розібрати апарат»: зняти всі балони (апарат лишається живим, «розібраним») |
| GET | `/apparatus/{id}/cylinder-history` | історія замін балонів (append-only) |
| POST | `/apparatus/{id}/archive`, `/restore` | архівація (перед архівацією — всі балони мають бути зняті, інакше 409) |

```json
// POST /apparatus — request (форма-збірка, screens.md §5.4)
{
  "backplate_id": "e4b7…",
  "cylinders": [                              // 0–2 елементи; порожній масив = «розібраний»
    { "cylinder_id": "91fe…", "position": 1 },
    { "cylinder_id": "5b2c…", "position": 2 }
  ],
  "storage_location_id": "f2a1…",             // nullable
  "notes": null
}

// 200 GET /apparatus/{id} — агрегат v_apparatus_status
{
  "id": "77aa…", "station_id": "a7c3…",
  "name": "bS-4343234",                        // = backplate.name (єдиний ідентифікатор, QR)
  "backplate": {
    "id": "e4b7…", "name": "bS-4343234", "model": "PSS 4000",
    "condition": { "status": "ok", "reason": null, "due_at": "2026-08-24" }
  },
  "cylinders": [
    {
      "position": 1,
      "cylinder": { "id": "91fe…", "number": "0417", "volume_l": 6.8, "material": "composite",
                    "condition": { "status": "overdue", "reason": "Гідротест прострочено 28 дн" } },
      "installed_at": "2026-05-02T11:20:00+03:00"
    },
    { "position": 2, "cylinder": { "id": "5b2c…", "number": "0533", "…": "…" }, "installed_at": "…" }
  ],
  "cylinders_installed": 2,                    // 0 = «розібраний»
  "condition": {                                // найгірший статус компонентів (v_apparatus_status)
    "status": "overdue",
    "reason": "НЕСПРАВНИЙ · гідротест бал. №0417"
  },
  "storage_location": { "id": "f2a1…", "name": "Шафа №2" },
  "notes": null, "created_at": "…", "updated_at": "…", "archived_at": null
}

// POST /apparatus/{id}/cylinders — request (установка; заміна = remove + install)
{ "cylinder_id": "8d3f…", "position": 2 }     // 201 → оновлена картка апарата

// POST /apparatus/{id}/cylinders/2/remove    // без тіла; 200 → оновлена картка

// GET /apparatus/{id}/cylinder-history → data[]
{
  "id": "ac91…",
  "cylinder": { "id": "3aa0…", "number": "0311" },
  "position": 1,
  "installed_at": "2025-11-14T09:05:00+02:00",
  "installed_by": { "id": "b1e0…", "full_name": "Іван Петренко" },
  "removed_at": "2026-05-02T11:20:00+03:00",
  "removed_by": { "id": "b1e0…", "full_name": "Іван Петренко" }
}
```

Помилки (усі — до інваріантів схеми):
- `409 BACKPLATE_ALREADY_IN_APPARATUS` — ложамент уже в живому апараті (**S3**, `ux_apparatus_backplate_active`).
- `409 CYLINDER_ALREADY_INSTALLED` — балон уже стоїть в іншому апараті (`ux_ac_cylinder_current`).
- `409 POSITION_OCCUPIED` — позиція зайнята (`ux_ac_position_current`).
- `409 STATION_MISMATCH` — компонент іншої станції (**S1**).
- `409 COMPONENT_ARCHIVED` — заархівований балон/ложамент/апарат (**S2**).
- Установка балона зі статусом `overdue` **дозволена** (ВП-5, поточне рішення):
  відповідь 201, апарат одразу `overdue`; попередження — на UI.
- Створення/архівація апарата синхронізує `backplate.status`
  (`in_apparatus`/`free`) в одній транзакції (**S3**).

---

## 9. Compressors: ТО та історія

Читання: всі ролі. Запис: `master`, `admin`.

| Метод | Шлях | Опис |
|---|---|---|
| GET | `/compressors` | список (карток мало — з повним блоком `maintenance`) |
| POST | `/compressors` | створити (стартові дані, вимога §3.4) |
| GET | `/compressors/{id}` | картка: наробіток + due по рівнях + `suggested_level` |
| PATCH | `/compressors/{id}` | `name`, `manufacturer`, `model`, `notes` |
| POST | `/compressors/{id}/maintenance` | «Провести ТО» → подія в історії |
| GET | `/compressors/{id}/maintenance` | історія ТО (`sort=-performed_at`) |
| GET | `/compressors/{id}/history` | обʼєднана стрічка подій; `?type=all\|maintenance\|fill_session` (вкладки Все/ТО/Заправки) |
| POST | `/compressors/{id}/archive`, `/restore` | архівація/відновлення |

```json
// POST /compressors — request
{
  "name": "Bauer K-14",
  "manufacturer": "Bauer", "model": "K-14",     // опційні (DB-3)
  "initial_engine_hours": 1180.0,
  "initial_maintenance_at": "2026-05-30",       // останнє ТО до появи в системі
  "initial_maintenance_hours": 1150.0           // 0..initial_engine_hours (CHECK)
}

// 200 GET /compressors/{id} — v_compressor_engine_hours + v_compressor_maintenance_due
{
  "id": "cc10…", "station_id": "a7c3…",
  "name": "Bauer K-14", "manufacturer": "Bauer", "model": "K-14",
  "engine_hours": 1256.4,                        // initial + сума завершених сесій
  "active_fill_session_id": null,                // uuid, якщо просто зараз іде заправка
  "condition": { "status": "overdue", "reason": "ТО-125 прострочено · +6.2 мг" },
  "maintenance": {
    "suggested_level": 125,                      // max(level) серед warning/overdue; null якщо все ok
    "levels": [
      { "level": 25,   "due_hours": 1250.0, "due_date": null,        "status": "overdue" },
      { "level": 125,  "due_hours": 1250.2, "due_date": null,        "status": "overdue" },
      { "level": 500,  "due_hours": 1374.6, "due_date": null,        "status": "ok" },
      { "level": 1000, "due_hours": 2150.0, "due_date": "2027-03-14","status": "ok" },
      { "level": 2000, "due_hours": 3150.0, "due_date": "2028-03-14","status": "ok" }
    ],
    "next": { "level": 125, "due_hours": 1250.2 }  // для ProgressToMaintenance: найменше due; при рівності — найвищий рівень
  },
  "notes": null, "created_at": "…", "updated_at": "…", "archived_at": null
}

// POST /compressors/{id}/maintenance — request («Провести ТО», модалка screens.md §4.4)
{
  "level": 125,                        // 25|125|500|1000|2000; передвибір = suggested_level
  "performed_at": "2026-07-10",        // дефолт сьогодні
  "engine_hours_at": 1256.4,           // опційно; дефолт — поточний наробіток (бекенд бере з VIEW)
  "notes": "Виконав: І. Петренко"      // виконавець-текст — сюди; performed_by = поточний користувач
}

// 201
{
  "id": "m902…", "compressor_id": "cc10…", "level": 125,
  "performed_at": "2026-07-10", "engine_hours_at": 1256.4,
  "performed_by": { "id": "b1e0…", "full_name": "Іван Петренко" },
  "notes": "…", "created_at": "…",
  "compressor": { "condition": { "status": "ok", "reason": null },
                  "maintenance": { "suggested_level": null, "next": { "level": 25, "due_hours": 1281.4 } } }
}

// GET /compressors/{id}/history?type=all → data[] (обидва типи, sort за датою DESC)
[
  { "type": "fill_session", "id": "fs11…", "occurred_at": "2026-07-08T14:02:00+03:00",
    "summary": "Сесія 24 хв · 3 апарати · 180→300 бар",
    "performed_by": { "id": "b1e0…", "full_name": "Іван Петренко" } },
  { "type": "maintenance", "id": "m877…", "occurred_at": "2026-06-30",
    "summary": "ТО-25 · 1 225.0 мг",
    "performed_by": { "id": "b1e0…", "full_name": "Іван Петренко" } }
]
```

Правила: ТО вищого рівня «закриває» слоти нижчих (логіка U-6 — уся у VIEW);
`engine_hours_at`, якщо переданий, валідується в межах `0..поточний наробіток`,
інакше `422`. Пороги warning: 10% інтервалу рівня / 30 днів для календарних (DB-2).

---

## 10. Fill sessions (сесії заправки)

Запис: **тільки `master`** (своєї станції) та `admin`. Читання: всі ролі.

> Модель стану відповідає схемі (§3.7): драфту в БД **немає** (`started_at NOT NULL`).
> Кроки 1–3 візарда живуть на клієнті; натискання **«Старт» = `POST /fill-sessions`**
> (створення + старт однією атомарною операцією). «Стоп» — окремий виклик.
> Активна сесія: `ended_at = null`; на компресор — максимум одна (`ux_fill_session_active`).

| Метод | Шлях | Опис |
|---|---|---|
| POST | `/fill-sessions` | «Старт»: створити й запустити сесію |
| POST | `/fill-sessions/{id}/stop` | «Стоп»: зупинити, мотогодини перераховуються одразу (S5) |
| **GET** | **`/fill-sessions/active`** | **активні сесії станції (ВП-6): відновлення таймера після перезавантаження / з іншого пристрою** |
| GET | `/fill-sessions/{id}` | деталі сесії (для екрана таймера і підсумку) |
| GET | `/fill-sessions` | історія; фільтри `compressor_id`, `performed_by`, `date_from`, `date_to` |

```json
// POST /fill-sessions — request (кнопка СТАРТ)
{
  "compressor_id": "cc10…",
  "pressure_before_bar": 180,
  "pressure_target_bar": 300,            // > before, ≤ 450 (CHECK chk_fs_pressures)
  "items": [                              // ≥ 1; кожен елемент — апарат АБО окремий балон
    { "apparatus_id": "77aa…" },
    { "apparatus_id": "88bb…" },
    { "cylinder_id": "0912…" }            // балон поза апаратом (U-5)
  ]
}

// 201
{
  "id": "fs12…", "station_id": "a7c3…",
  "compressor": { "id": "cc10…", "name": "Bauer K-14" },
  "pressure_before_bar": 180, "pressure_target_bar": 300,
  "started_at": "2026-07-10T14:02:11+03:00",
  "ended_at": null, "duration_hours": null,
  "performed_by": { "id": "b1e0…", "full_name": "Іван Петренко" },
  "items": [
    { "type": "apparatus", "id": "77aa…", "name": "bS-4343234" },
    { "type": "apparatus", "id": "88bb…", "name": "bS-118" },
    { "type": "cylinder",  "id": "0912…", "name": "№0912" }
  ]
}

// GET /fill-sessions/active — 200 (ВП-6; клієнт рахує таймер від started_at, серверний
// час у заголовку Date / полі server_time захищає від збитого годинника пристрою)
{
  "server_time": "2026-07-10T14:16:48+03:00",
  "data": [ { "…": "як у 201 вище, ended_at: null" } ]
}
// Немає активних сесій → 200 { "server_time": "…", "data": [] }  (не 404 — це стан, а не помилка)

// POST /fill-sessions/{id}/stop — без тіла; 200
{
  "id": "fs12…", "ended_at": "2026-07-10T14:26:35+03:00",
  "duration_hours": 0.4067,                        // рахує БД (generated column)
  "compressor": {
    "id": "cc10…", "engine_hours": 1256.81,        // вже перераховано (S5)
    "condition": { "status": "overdue", "reason": "ТО-125 прострочено · +6.6 мг" },
    "maintenance": { "next": { "level": 125, "due_hours": 1250.2 } }
  }
}
```

Помилки:
- `409 FILL_SESSION_ALREADY_ACTIVE` — у компресора вже є активна сесія.
- `409 APPARATUS_EMPTY` — апарат у items без жодного встановленого балона (**S6**).
- `409 CYLINDER_NOT_FREE` — «окремий балон» насправді стоїть в апараті (**S6**).
- `422 VALIDATION_ERROR` — тиски (`target ≤ before`), порожній `items`, дублікати в `items`.
- `403 FILL_SESSION_FORBIDDEN` — «Стоп» викликає не автор, не майстер цієї станції і не admin (**S5**).
- Повторний `stop` уже зупиненої сесії → `409 CONFLICT` («Сесію вже зупинено»), ідемпотентність на клієнті — через це.
- Забутий «Стоп» — без лімітів і автокорекції (U-5): сесія висить активною, банер на UI.

---

## 11. Dashboard / alerts (мейнборд)

Читання: всі ролі (станція — за скоупінгом §1.2).

| Метод | Шлях | Опис |
|---|---|---|
| GET | `/dashboard/alerts` | лічильники для чипів + згруповані елементи «потребує уваги» |

Query: `status=overdue,warning` (дефолт — обидва; `ok` вмикає чип «У нормі»),
`page`/`limit` — на групу не застосовуються, список плоский з `group`.

```json
// GET /dashboard/alerts → 200
{
  "counters": { "overdue": 3, "warning": 7, "ok": 41 },   // чипи мейнборда
  "data": [
    {
      "entity_type": "apparatus", "entity_id": "77aa…",
      "title": "bS-4343234",
      "subtitle": "апарат · Шафа №2",
      "status": "overdue",
      "reason": "НЕСПРАВНИЙ · гідротест бал. №0417",       // готовий текст badge (screens.md §8)
      "due_at": "2026-06-12", "overdue_days": 28
    },
    {
      "entity_type": "cylinder", "entity_id": "91fe…",
      "title": "№0417", "subtitle": "балон 6.8 л композит · в апараті bS-4343234",
      "status": "overdue", "reason": "Гідротест прострочено",
      "due_at": "2026-06-12", "overdue_days": 28
    },
    {
      "entity_type": "compressor", "entity_id": "cc10…",
      "title": "Bauer K-14", "subtitle": "компресор",
      "status": "overdue", "reason": "ТО-125 прострочено · +6.2 мг",
      "due_at": null, "due_hours": 1250.2, "overdue_hours": 6.2
    },
    {
      "entity_type": "backplate", "entity_id": "e9c2…",
      "title": "bS-118", "subtitle": "ложамент · в апараті bS-118",
      "status": "warning", "reason": "Редуктор через 45 дн",
      "due_at": "2026-08-24", "days_left": 45
    }
  ]
}
```

Сортування (правила мейнборда, screens.md §1.1): усі `overdue`, потім `warning`;
всередині групи — найпростроченіше/найближче вгорі. Джерела: `v_apparatus_status`,
`v_cylinder_status`, `v_backplate_status`, `v_compressor_maintenance_due`.
Пороги: балони — 30 дн; редуктор — 60 дн (DB-1); ТО — 10% інтервалу / 30 дн (DB-2).

---

## 12. Зведена таблиця доступу

| Ресурс | GET | POST/PATCH/archive |
|---|---|---|
| `/auth/*` | усі | усі |
| `/stations`, `/users` | admin | admin |
| `/storage-locations`, `/backplates`, `/cylinders`, `/apparatus`, `/compressors` | admin, master, duty (своя станція) | admin, master (своя станція) |
| `/fill-sessions` | admin, master, duty (своя станція) | **тільки master (своя станція) / admin** |
| `/dashboard/alerts` | усі (за скоупінгом) | — |

---

## 13. Міграції та структура проекту (рекомендація)

### 13.1 Інструмент міграцій: **node-pg-migrate** (raw SQL)

Узгоджено зі схемою: db-schema.md §6 уже задає нумеровану послідовність
`0001_extensions_enums … 0008_seed_dev` — це рідний формат node-pg-migrate.
Причини вибору: схема написана «PostgreSQL-first» (composite FK, partial unique
indexes, generated columns, VIEW, CHECK, citext) — ORM-міграції (Prisma) це
виражають погано; node-pg-migrate дозволяє чисті `.sql`-файли (up/down),
транзакційні за замовчуванням. Доступ до даних — `pg` + тонкий шар запитів
(без ORM); валідація — **zod** (спільні схеми request/response).

### 13.2 Структура Express + TypeScript

```
backend/
  migrations/                 // 0001_… .sql (node-pg-migrate)
  src/
    config.ts                 // env (zod-валідація process.env)
    db/
      pool.ts                 // pg.Pool
      tx.ts                   // withTransaction(helper) — S8: мутація + audit в одній транзакції
    middleware/
      auth.ts                 // перевірка JWT → req.user {id, role, stationId}
      stationScope.ts         // резолв station_id (§1.2), 403 STATION_SCOPE_VIOLATION
      requireRole.ts          // requireRole('master','admin'); duty → 403 на мутаціях
      errorHandler.ts         // єдиний формат помилок (§1.4), мапінг AppError → HTTP
      requestId.ts            // X-Request-Id → audit_log.request_id
    modules/                  // модуль = routes + service + queries + zod-схеми
      auth/      auth.routes.ts auth.service.ts tokens.ts
      stations/  users/  storageLocations/
      backplates/  cylinders/          // + hydroTests усередині cylinders
      apparatus/                       // + install/remove/history (інваріанти S1–S4)
      compressors/                     // + maintenance (u-6 підказка рівня)
      fillSessions/                    // start/stop/active (S5, S6)
      dashboard/
      audit/     audit.service.ts     // writeAudit(tx, …) — викликається сервісами
    shared/
      errors.ts               // AppError(code, http, message, details)
      pagination.ts  status.ts // типи 'ok'|'warning'|'overdue', конверт списків
    app.ts                    // збирання express, /api/v1 router
    server.ts
  test/
    integration/              // supertest + testcontainers-postgres: інваріанти S1–S8, VIEW-розрахунки
    unit/
  package.json  tsconfig.json  .env.example
```

Ключові рішення: бізнес-правила S1–S7 — у сервісах усередині `withTransaction`
(разом з аудитом, S8); контролери тонкі (zod-parse → service → json). Статусні
тексти (`condition.reason`) формуються в одному модулі `shared/status.ts` бекенда —
фронт їх лише рендерить.

---

## 14. Відкриті питання (PM / суміжні агенти)

| # | Питання | Дефолт у контракті |
|---|---|---|
| API-1 | «Провести ТО»: дизайн дозволяє редагувати наробіток у модалці, схема каже «фіксує бекенд». Залишити редагованим? | так, опційне `engine_hours_at` з валідацією `0..поточний` |
| API-2 | ВП-5 (успадковано): збірка апарата з `overdue`-балоном — дозволяємо з попередженням на UI (201 без блокування). Якщо PM вирішить блокувати — стане `409` | дозволено |
| API-3 | Виконавець ТО/гідротесту — лише користувачі системи (`performed_by uuid`); зовнішній виконавець — текстом у `notes`. Достатньо для нормативного обліку? | так |
| API-4 | Ліміт активних сесій на майстра не вводимо (одна на компресор — з БД). ОК? | без ліміту |
| API-5 | Перегляд `audit_log` в UI у MVP не потрібен (лог пишеться, ендпоінт читання не публікуємо)? | ендпоінта немає |
