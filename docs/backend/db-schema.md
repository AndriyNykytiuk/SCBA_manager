# SCBA Manager — Схема БД (PostgreSQL)

> Статус: ПРОЕКТ (етап дизайну), відповідає `docs/requirements.md` v1.0 (2026-07-10).
> PostgreSQL ≥ 15. Усі PK — `uuid` (`gen_random_uuid()`, розширення `pgcrypto` або вбудоване в PG13+).
> Видалення записів **заборонене** — тільки архівація (`archived_at`).

---

## 1. Загальні принципи

1. **Мультистанційність**: майже всі доменні таблиці мають `station_id`. Для крос-табличної
   цілісності (компоненти апарата належать тій самій станції) використовуємо **композитні FK**
   `(id, station_id)` — станцію неможливо «переплутати» на рівні БД.
2. **Архівація замість видалення**: `archived_at timestamptz NULL`. Усі UNIQUE-обмеження на
   «живі» записи — **partial unique indexes** (`WHERE archived_at IS NULL`), щоб номер
   списаного балона можна було колись використати знову.
3. **Історія — append-only**: `hydro_test`, `apparatus_cylinder`, `fill_session`,
   `compressor_maintenance`, `audit_log` не редагуються і не архівуються (тільки INSERT).
4. **Усі розрахунки статусів/термінів — на бекенді**: реалізовані як SQL VIEW (розділ 4),
   API віддає вже пораховані `status: ok | warning | overdue` і дати.
5. Час — `timestamptz`; «календарні» дати (гідротест, виготовлення) — `date`.

## 2. ER-огляд

```
station 1─* app_user (крім admin: station_id IS NULL)
station 1─* storage_location, backplate, cylinder, apparatus, compressor

backplate 1─0..1 apparatus            (partial unique: 1 ложамент = 1 живий апарат)
apparatus 1─* apparatus_cylinder *─1 cylinder   (історія; "поточний" = removed_at IS NULL)
cylinder  1─* hydro_test
compressor 1─* fill_session 1─* fill_session_item ─> apparatus | cylinder
compressor 1─* compressor_maintenance
app_user  1─* refresh_token
audit_log ─> будь-яка сутність (entity_type + entity_id)
```

## 3. DDL

### 3.0 Розширення та enum-типи

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- регістронезалежний login

CREATE TYPE user_role         AS ENUM ('admin', 'master', 'duty');
CREATE TYPE backplate_status  AS ENUM ('in_apparatus', 'free', 'in_repair', 'decommissioned');
CREATE TYPE cylinder_material AS ENUM ('metal', 'composite');
CREATE TYPE audit_action      AS ENUM ('create', 'update', 'archive', 'restore');
-- Статус придатності НЕ зберігається у таблицях — рахується у VIEW (розділ 4):
-- 'ok' | 'warning' | 'overdue'
```

Рівні ТО компресора — **не enum, а smallint із CHECK** (потрібні числові порівняння
та арифметика кратностей):

```sql
-- CHECK (level IN (25, 125, 500, 1000, 2000))
```

### 3.1 station

```sql
CREATE TABLE station (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    address     text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz
);

CREATE UNIQUE INDEX ux_station_name_active
    ON station (lower(name)) WHERE archived_at IS NULL;
```

### 3.2 app_user, refresh_token

```sql
CREATE TABLE app_user (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id    uuid REFERENCES station(id),
    role          user_role NOT NULL,
    login         citext NOT NULL,
    password_hash text NOT NULL,               -- argon2id
    full_name     text NOT NULL,
    is_active     boolean NOT NULL DEFAULT true,  -- деактивація доступу (≠ архівація)
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    archived_at   timestamptz,
    -- admin — глобальний (без станції), master/duty — завжди зі станцією
    CONSTRAINT chk_user_station_scope
        CHECK ((role = 'admin') = (station_id IS NULL))
);

CREATE UNIQUE INDEX ux_app_user_login_active
    ON app_user (login) WHERE archived_at IS NULL;
CREATE INDEX ix_app_user_station ON app_user (station_id);

CREATE TABLE refresh_token (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES app_user(id),
    token_hash  text NOT NULL UNIQUE,          -- sha256 від токена; сирий токен не зберігаємо
    expires_at  timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    revoked_at  timestamptz,                   -- logout / ротація
    replaced_by uuid REFERENCES refresh_token(id)  -- ланцюжок ротації
);

CREATE INDEX ix_refresh_token_user ON refresh_token (user_id) WHERE revoked_at IS NULL;
```

### 3.3 storage_location (довідник місць зберігання)

```sql
CREATE TABLE storage_location (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id  uuid NOT NULL REFERENCES station(id),
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    UNIQUE (id, station_id)                    -- для композитного FK з apparatus
);

CREATE UNIQUE INDEX ux_storage_location_name_active
    ON storage_location (station_id, lower(name)) WHERE archived_at IS NULL;
```

### 3.4 backplate (ложамент)

```sql
CREATE TABLE backplate (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id                uuid NOT NULL REFERENCES station(id),
    name                      text NOT NULL,        -- "bS-4343234"; ідентифікатор апарата, кодується у QR
    manufacturer              text,
    model                     text,
    serial_number             text,
    commissioned_at           date,                 -- дата введення в експлуатацію
    reducer_last_replaced_at  date,                 -- остання заміна редуктора
    reducer_interval_months   integer,              -- ручний інтервал (майстер), у місяцях
    notes                     text,
    status                    backplate_status NOT NULL DEFAULT 'free',
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    archived_at               timestamptz,
    UNIQUE (id, station_id),
    CONSTRAINT chk_backplate_reducer_interval
        CHECK (reducer_interval_months IS NULL OR reducer_interval_months > 0),
    -- «списаний» ⇔ заархівований (архівація замість видалення)
    CONSTRAINT chk_backplate_decommissioned
        CHECK ((status = 'decommissioned') = (archived_at IS NOT NULL))
);

CREATE UNIQUE INDEX ux_backplate_name_active
    ON backplate (station_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX ix_backplate_station ON backplate (station_id);
```

> `status = 'in_apparatus'` дублює факт наявності живого рядка в `apparatus`
> (потрібен для фільтрів «вільні ложаменти»). Синхронізацію виконує сервісний шар
> в одній транзакції зі створенням/архівацією апарата; інваріант додатково
> перевіряється інтеграційним тестом.

### 3.5 cylinder (балон) + hydro_test

```sql
CREATE TABLE cylinder (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id               uuid NOT NULL REFERENCES station(id),
    number                   text NOT NULL,
    volume_l                 numeric(3,1) NOT NULL,
    material                 cylinder_material NOT NULL,
    working_pressure_bar     integer NOT NULL,
    manufacturer             text,
    manufactured_at          date NOT NULL,
    end_of_life_at           date NOT NULL,          -- кінець строку служби
    hydro_interval_months    integer NOT NULL,       -- вводить майстер; різний для metal/composite
    next_hydro_test_override date,                   -- ручне коригування авторозрахунку (NULL = авто)
    notes                    text,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    archived_at              timestamptz,
    UNIQUE (id, station_id),
    -- довідник об'ємів MVP; розширення значень — окремою міграцією
    CONSTRAINT chk_cylinder_volume   CHECK (volume_l IN (6.0, 6.8, 7.0)),
    CONSTRAINT chk_cylinder_pressure CHECK (working_pressure_bar BETWEEN 1 AND 450),
    CONSTRAINT chk_cylinder_eol      CHECK (end_of_life_at > manufactured_at),
    CONSTRAINT chk_cylinder_interval CHECK (hydro_interval_months > 0)
);

CREATE UNIQUE INDEX ux_cylinder_number_active
    ON cylinder (station_id, lower(number)) WHERE archived_at IS NULL;
CREATE INDEX ix_cylinder_station ON cylinder (station_id);

-- Історія гідротестів (append-only). Перший «останній гідротест» при заведенні
-- балона теж пишеться сюди звичайним рядком.
CREATE TABLE hydro_test (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cylinder_id  uuid NOT NULL REFERENCES cylinder(id),
    tested_at    date NOT NULL,
    performed_by uuid REFERENCES app_user(id),   -- NULL, якщо тест робила зовнішня лабораторія
    notes        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   uuid NOT NULL REFERENCES app_user(id),
    CONSTRAINT chk_hydro_test_date CHECK (tested_at <= current_date)
);

CREATE INDEX ix_hydro_test_cylinder ON hydro_test (cylinder_id, tested_at DESC);
```

### 3.6 apparatus (апарат) + apparatus_cylinder (склад/історія)

```sql
CREATE TABLE apparatus (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id          uuid NOT NULL REFERENCES station(id),
    backplate_id        uuid NOT NULL,
    storage_location_id uuid,
    notes               text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    archived_at         timestamptz,
    UNIQUE (id, station_id),
    -- композитні FK: компоненти гарантовано з тієї ж станції
    FOREIGN KEY (backplate_id, station_id)        REFERENCES backplate (id, station_id),
    FOREIGN KEY (storage_location_id, station_id) REFERENCES storage_location (id, station_id)
);

-- 1 ложамент = 1 живий апарат
CREATE UNIQUE INDEX ux_apparatus_backplate_active
    ON apparatus (backplate_id) WHERE archived_at IS NULL;
CREATE INDEX ix_apparatus_station ON apparatus (station_id);

-- Склад апарата + повна історія замін балонів.
-- Поточний склад: removed_at IS NULL. «Розібраний» апарат = 0 живих рядків (дозволено).
CREATE TABLE apparatus_cylinder (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    apparatus_id uuid NOT NULL REFERENCES apparatus(id),
    cylinder_id  uuid NOT NULL REFERENCES cylinder(id),
    position     smallint NOT NULL,             -- 1 або 2 (апарат = 1–2 балони)
    installed_at timestamptz NOT NULL DEFAULT now(),
    installed_by uuid NOT NULL REFERENCES app_user(id),
    removed_at   timestamptz,
    removed_by   uuid REFERENCES app_user(id),
    CONSTRAINT chk_ac_position CHECK (position IN (1, 2)),
    CONSTRAINT chk_ac_period   CHECK (removed_at IS NULL OR removed_at >= installed_at),
    CONSTRAINT chk_ac_removed_by
        CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);

-- один балон — тільки в одному апараті (серед поточних установок)
CREATE UNIQUE INDEX ux_ac_cylinder_current
    ON apparatus_cylinder (cylinder_id) WHERE removed_at IS NULL;
-- у апараті не більше одного балона на позицію (⇒ максимум 2 балони)
CREATE UNIQUE INDEX ux_ac_position_current
    ON apparatus_cylinder (apparatus_id, position) WHERE removed_at IS NULL;
CREATE INDEX ix_ac_apparatus_history ON apparatus_cylinder (apparatus_id, installed_at DESC);
```

### 3.7 compressor + fill_session + compressor_maintenance

```sql
CREATE TABLE compressor (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id                uuid NOT NULL REFERENCES station(id),
    name                      text NOT NULL,          -- ідентифікація у списках/сесіях заправки
    manufacturer              text,
    model                     text,
    -- стартові дані при заведенні (вимога 3.4):
    initial_engine_hours      numeric(10,2) NOT NULL DEFAULT 0,  -- лічильник на момент створення
    initial_maintenance_at    date,                   -- дата останнього ТО до появи в системі
    initial_maintenance_hours numeric(10,2),          -- наробіток на момент того ТО
    notes                     text,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    archived_at               timestamptz,
    UNIQUE (id, station_id),
    CONSTRAINT chk_compressor_hours CHECK (initial_engine_hours >= 0),
    CONSTRAINT chk_compressor_init_maint CHECK (
        initial_maintenance_hours IS NULL
        OR initial_maintenance_hours BETWEEN 0 AND initial_engine_hours
    )
);

CREATE UNIQUE INDEX ux_compressor_name_active
    ON compressor (station_id, lower(name)) WHERE archived_at IS NULL;

-- Сесія заправки: тиски вводяться ОДИН раз на сесію (групу апаратів/балонів).
-- Активна сесія: ended_at IS NULL. Забутий «Стоп» — без автокорекції (MVP).
CREATE TABLE fill_session (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id          uuid NOT NULL,
    compressor_id       uuid NOT NULL,
    pressure_before_bar integer NOT NULL,
    pressure_target_bar integer NOT NULL,
    started_at          timestamptz NOT NULL DEFAULT now(),
    ended_at            timestamptz,
    performed_by        uuid NOT NULL REFERENCES app_user(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    -- тривалість у мотогодинах — рахує БД, нікому не довіряємо
    duration_hours numeric(10,4) GENERATED ALWAYS AS (
        CASE WHEN ended_at IS NULL THEN NULL
             ELSE EXTRACT(EPOCH FROM (ended_at - started_at)) / 3600.0
        END
    ) STORED,
    FOREIGN KEY (compressor_id, station_id) REFERENCES compressor (id, station_id),
    CONSTRAINT chk_fs_pressures CHECK (
        pressure_before_bar >= 0
        AND pressure_target_bar > pressure_before_bar
        AND pressure_target_bar <= 450
    ),
    CONSTRAINT chk_fs_period CHECK (ended_at IS NULL OR ended_at > started_at)
);

-- один компресор — одна активна сесія
CREATE UNIQUE INDEX ux_fill_session_active
    ON fill_session (compressor_id) WHERE ended_at IS NULL;
CREATE INDEX ix_fill_session_compressor ON fill_session (compressor_id, started_at DESC);

-- Позиції сесії: апарат АБО окремий балон поза апаратом (U-5) — рівно одне з двох.
CREATE TABLE fill_session_item (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fill_session_id uuid NOT NULL REFERENCES fill_session(id),
    apparatus_id    uuid REFERENCES apparatus(id),
    cylinder_id     uuid REFERENCES cylinder(id),
    CONSTRAINT chk_fsi_target CHECK (num_nonnulls(apparatus_id, cylinder_id) = 1),
    CONSTRAINT ux_fsi_apparatus UNIQUE (fill_session_id, apparatus_id),
    CONSTRAINT ux_fsi_cylinder  UNIQUE (fill_session_id, cylinder_id)
);

CREATE INDEX ix_fsi_session ON fill_session_item (fill_session_id);

-- Подія «Провести ТО» (append-only історія).
CREATE TABLE compressor_maintenance (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    compressor_id  uuid NOT NULL REFERENCES compressor(id),
    level          smallint NOT NULL,           -- 25|125|500|1000|2000 мотогодин
    performed_at   date NOT NULL DEFAULT current_date,
    engine_hours_at numeric(10,2) NOT NULL,     -- наробіток на момент ТО (фіксує бекенд)
    performed_by   uuid NOT NULL REFERENCES app_user(id),
    notes          text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_cm_level CHECK (level IN (25, 125, 500, 1000, 2000)),
    CONSTRAINT chk_cm_hours CHECK (engine_hours_at >= 0)
);

CREATE INDEX ix_cm_compressor ON compressor_maintenance (compressor_id, performed_at DESC);
```

### 3.8 audit_log

```sql
CREATE TABLE audit_log (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    user_id     uuid NOT NULL REFERENCES app_user(id),
    station_id  uuid REFERENCES station(id),   -- NULL для глобальних дій (users, stations)
    entity_type text NOT NULL,                 -- 'cylinder' | 'backplate' | 'apparatus' | ...
    entity_id   uuid NOT NULL,
    action      audit_action NOT NULL,
    changes     jsonb,                         -- {"field": {"old": ..., "new": ...}}
    request_id  text                           -- кореляція з логами HTTP
);

CREATE INDEX ix_audit_entity ON audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX ix_audit_time   ON audit_log (occurred_at DESC);
```

Аудит пишеться сервісним шаром **в одній транзакції** з мутацією (create/update/archive/restore
для всіх доменних сутностей + hydro_test, встановлення/зняття балонів, fill_session, maintenance).

---

## 4. Розрахунок статусів і термінів (VIEW)

Статуси **ніде не зберігаються** — тільки обчислюються. Пороги попереджень винесені
в один довідковий CTE/константи сервісу:

| Сутність | warning | overdue |
|---|---|---|
| Балон (гідротест, кінець строку служби) | ≤ 30 днів | дата < сьогодні |
| Ложамент (заміна редуктора) | ≤ 60 днів (2 міс; вимога «за 1–2 міс») | дата < сьогодні |
| Компресор (ТО за наробітком) | залишилось ≤ 10% інтервалу рівня | наробіток ≥ due |
| Компресор (календар ТО-1000/2000) | ≤ 30 днів | дата < сьогодні |

### 4.1 Наробіток компресора

```sql
CREATE VIEW v_compressor_engine_hours AS
SELECT c.id AS compressor_id,
       c.initial_engine_hours
         + COALESCE(SUM(fs.duration_hours) FILTER (WHERE fs.ended_at IS NOT NULL), 0)
         AS engine_hours
FROM compressor c
LEFT JOIN fill_session fs ON fs.compressor_id = c.id
GROUP BY c.id, c.initial_engine_hours;
```

### 4.2 Статус балона

Ефективна дата наступного гідротесту:
`COALESCE(next_hydro_test_override, останній hydro_test.tested_at + hydro_interval_months)`.
При зміні інтервалу чи додаванні тесту авторозрахунок «оживає», якщо майстер скине override.

```sql
CREATE VIEW v_cylinder_status AS
WITH last_test AS (
    SELECT DISTINCT ON (cylinder_id) cylinder_id, tested_at
    FROM hydro_test ORDER BY cylinder_id, tested_at DESC
)
SELECT cy.id AS cylinder_id,
       lt.tested_at AS last_hydro_test_at,
       COALESCE(
           cy.next_hydro_test_override,
           lt.tested_at + make_interval(months => cy.hydro_interval_months)
       )::date AS next_hydro_test_at,
       cy.end_of_life_at,
       CASE
         WHEN cy.end_of_life_at < current_date THEN 'overdue'
         WHEN COALESCE(cy.next_hydro_test_override,
              lt.tested_at + make_interval(months => cy.hydro_interval_months))::date
              < current_date THEN 'overdue'
         WHEN cy.end_of_life_at <= current_date + 30 THEN 'warning'
         WHEN COALESCE(cy.next_hydro_test_override,
              lt.tested_at + make_interval(months => cy.hydro_interval_months))::date
              <= current_date + 30 THEN 'warning'
         ELSE 'ok'
       END AS status
FROM cylinder cy
LEFT JOIN last_test lt ON lt.cylinder_id = cy.id
WHERE cy.archived_at IS NULL;
```

> Балон без жодного гідротесту і без override: `next_hydro_test_at IS NULL` → сервіс
> трактує як `overdue` для металу/композиту старше інтервалу від `manufactured_at`
> (fallback: база = `manufactured_at`). При заведенні балона майстер обовʼязково вводить
> «останній гідротест» → створюється перший рядок `hydro_test`, тож кейс граничний.

### 4.3 Статус ложамента (редуктор)

База відліку: `COALESCE(reducer_last_replaced_at, commissioned_at)`.

```sql
CREATE VIEW v_backplate_status AS
SELECT b.id AS backplate_id,
       (COALESCE(b.reducer_last_replaced_at, b.commissioned_at)
          + make_interval(months => b.reducer_interval_months))::date
          AS next_reducer_replacement_at,
       CASE
         WHEN b.reducer_interval_months IS NULL
              OR COALESCE(b.reducer_last_replaced_at, b.commissioned_at) IS NULL THEN 'ok'
         WHEN (COALESCE(b.reducer_last_replaced_at, b.commissioned_at)
               + make_interval(months => b.reducer_interval_months))::date
              < current_date THEN 'overdue'
         WHEN (COALESCE(b.reducer_last_replaced_at, b.commissioned_at)
               + make_interval(months => b.reducer_interval_months))::date
              <= current_date + 60 THEN 'warning'
         ELSE 'ok'
       END AS status
FROM backplate b
WHERE b.archived_at IS NULL;
```

### 4.4 Статус апарата

Прострочений балон в апараті → апарат **несправний (`overdue`, червоний)**.
`warning` — якщо будь-який компонент у `warning` (жовтий).

```sql
CREATE VIEW v_apparatus_status AS
SELECT a.id AS apparatus_id,
       COUNT(ac.id) AS cylinders_installed,          -- 0 = «розібраний»
       CASE
         WHEN bool_or(cs.status = 'overdue')
           OR bps.status = 'overdue'                       THEN 'overdue'
         WHEN bool_or(cs.status = 'warning')
           OR bps.status = 'warning'                       THEN 'warning'
         ELSE 'ok'
       END AS status
FROM apparatus a
JOIN v_backplate_status bps ON bps.backplate_id = a.backplate_id
LEFT JOIN apparatus_cylinder ac
       ON ac.apparatus_id = a.id AND ac.removed_at IS NULL
LEFT JOIN v_cylinder_status cs ON cs.cylinder_id = ac.cylinder_id
WHERE a.archived_at IS NULL
GROUP BY a.id, bps.status;
```

### 4.5 Наступні ТО компресора

Логіка U-6: рівні **незалежні**, для рівня `L` наступне due =
`(наробіток останнього ТО рівня ≥ L) + L`. ТО вищого рівня «закриває» слот нижчого
(5 × ТО-25, шосте — ТО-125). Якщо ТО рівня ще не було — база: дані з заведення
компресора (`initial_maintenance_hours` / `initial_maintenance_at`), інакше 0.
Календар — **лише** для 1000 (1 рік) і 2000 (2 роки): «що настане раніше».

```sql
CREATE VIEW v_compressor_maintenance_due AS
WITH levels(level) AS (VALUES (25),(125),(500),(1000),(2000)),
     last_done AS (
       SELECT c.id AS compressor_id, l.level,
              GREATEST(
                COALESCE((SELECT max(cm.engine_hours_at) FROM compressor_maintenance cm
                          WHERE cm.compressor_id = c.id AND cm.level >= l.level),
                         c.initial_maintenance_hours, 0)
              ) AS last_hours,
              COALESCE((SELECT max(cm.performed_at) FROM compressor_maintenance cm
                        WHERE cm.compressor_id = c.id AND cm.level >= l.level),
                       c.initial_maintenance_at) AS last_date
       FROM compressor c CROSS JOIN levels l
       WHERE c.archived_at IS NULL
     )
SELECT ld.compressor_id,
       ld.level,
       eh.engine_hours,
       ld.last_hours + ld.level                    AS due_hours,
       CASE ld.level                               -- календарне due — тільки 1000/2000
         WHEN 1000 THEN ld.last_date + interval '1 year'
         WHEN 2000 THEN ld.last_date + interval '2 years'
         ELSE NULL
       END::date                                   AS due_date,
       CASE
         WHEN eh.engine_hours >= ld.last_hours + ld.level          THEN 'overdue'
         WHEN ld.level IN (1000, 2000) AND ld.last_date IS NOT NULL
              AND (ld.last_date + make_interval(
                     years => CASE ld.level WHEN 1000 THEN 1 ELSE 2 END))::date
                  < current_date                                    THEN 'overdue'
         WHEN eh.engine_hours >= ld.last_hours + ld.level * 0.9     THEN 'warning'
         WHEN ld.level IN (1000, 2000) AND ld.last_date IS NOT NULL
              AND (ld.last_date + make_interval(
                     years => CASE ld.level WHEN 1000 THEN 1 ELSE 2 END))::date
                  <= current_date + 30                              THEN 'warning'
         ELSE 'ok'
       END AS status
FROM last_done ld
JOIN v_compressor_engine_hours eh ON eh.compressor_id = ld.compressor_id;
```

Сервіс агрегує: статус компресора = найгірший статус серед рівнів; «наступне ТО» для UI =
рівень із найменшим `due_hours` (при рівності показуємо **найвищий** рівень — саме він і
проводиться на кратності).

**Підказка рівня при натисканні «Провести ТО»**: бекенд пропонує
`max(level) WHERE status IN ('warning','overdue')`, майстер може змінити. `engine_hours_at`
фіксується бекендом із `v_compressor_engine_hours` на момент події.

---

## 5. Інваріанти сервісного шару (те, що не виражається DDL)

| # | Правило | Механізм |
|---|---|---|
| S1 | Балон в апарат — тільки зі своєї станції | перевірка в транзакції (композитний FK покриває apparatus↔backplate/location; для apparatus_cylinder — SELECT + перевірка station_id) |
| S2 | Не можна встановити заархівований балон / у заархівований апарат | сервіс + `WHERE archived_at IS NULL` |
| S3 | `backplate.status` ⇄ наявність живого апарата | одна транзакція create/archive apparatus |
| S4 | Архівація компонента, що стоїть в апараті — заборонена (спершу зняти) | сервіс → 409 |
| S5 | «Стоп» сесії: тільки автор/майстер станції/адмін; мотогодини перераховуються одразу (VIEW — автоматично) | сервіс |
| S6 | Балон в `fill_session_item.cylinder_id` не повинен стояти в апараті (U-5: «окремий балон»); апарат — мати ≥1 балон | сервіс → 422/409 |
| S7 | `hydro_test.tested_at` новішого тесту ≥ попереднього; після INSERT скидати `next_hydro_test_override` (майстер підтверджує) | сервіс |
| S8 | Аудит-лог у тій самій транзакції, що й мутація | middleware/service |

## 6. Порядок міграцій

1. `0001_extensions_enums` — розширення + enum-типи.
2. `0002_core` — station, app_user, refresh_token, storage_location.
3. `0003_equipment` — backplate, cylinder, hydro_test.
4. `0004_apparatus` — apparatus, apparatus_cylinder.
5. `0005_compressor` — compressor, fill_session, fill_session_item, compressor_maintenance.
6. `0006_audit` — audit_log.
7. `0007_views` — усі VIEW з розділу 4.
8. `0008_seed_dev` — dev-сіди (станція, admin, майстер, черговий, зразкове обладнання) — тільки для локалки/стейджа.

## 7. Відкриті питання до PM

| # | Питання | Дефолт у цій схемі |
|---|---|---|
| DB-1 | Поріг «жовтого» для редуктора: вимога каже «1–2 місяці». Зафіксувати точне значення? | 60 днів |
| DB-2 | Поріг «жовтого» для ТО компресора за наробітком не заданий у вимогах | 10% інтервалу рівня; календарний — 30 днів |
| DB-3 | Компресору потрібна назва для вибору в сесії заправки (вимога 3.4: «більше нічого») | додано обовʼязкове поле `name` (+ опційні виробник/модель) |
| DB-4 | Балон без історії гідротестів: базою вважати `manufactured_at`? | так, fallback = manufactured_at |
| DB-5 | Чи унікальні номери балонів/ложаментів глобально або в межах станції? | у межах станції |
