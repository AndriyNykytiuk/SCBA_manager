-- Up Migration
-- Dev-сіди (ТІЛЬКИ для локалки/стейджа): станція, користувачі, зразкове обладнання.
-- Ідемпотентно: фіксовані UUID + ON CONFLICT DO NOTHING.
-- Паролі: admin/admin123, master/master123, duty/duty123 (bcrypt, cost 10).
-- Дати warning/overdue — відносні до current_date, щоб демо-статуси не «протухали».

-- Станція
INSERT INTO station (id, name, address) VALUES
  ('11111111-1111-4111-8111-111111111111', 'ДПРЧ-12', 'м. Київ, вул. Пожежна, 12')
ON CONFLICT (id) DO NOTHING;

-- Користувачі
INSERT INTO app_user (id, station_id, role, login, password_hash, full_name) VALUES
  ('00000000-0000-4000-8000-000000000001', NULL, 'admin', 'admin',
   '$2a$10$HqEs7r48unptUUqultkZXuSbHoCfxgmqzixQuDxc2J4Yo2yIgnfNi', 'Адміністратор Системи'),
  ('00000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'master', 'master',
   '$2a$10$GwoF0ZOljG.wouqgTkzYEOWVPQEJT8mXv83BtZoUHXMI9r6yobTx2', 'Іван Петренко'),
  ('00000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'duty', 'duty',
   '$2a$10$1Kmk8zOTWL2R2FngeBL1m.ucWqbeV3qI8Lh4rKgNjllLkY77mDywu', 'Олена Ковальчук')
ON CONFLICT (id) DO NOTHING;

-- Місця зберігання
INSERT INTO storage_location (id, station_id, name) VALUES
  ('00000000-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', 'Шафа №1'),
  ('00000000-0000-4000-8000-000000000012', '11111111-1111-4111-8111-111111111111', 'Пост ГДЗС')
ON CONFLICT (id) DO NOTHING;

-- Ложаменти: bS-100/bS-200 стоять в апаратах; bS-300 вільний, редуктор у warning (~45 дн)
INSERT INTO backplate (id, station_id, name, manufacturer, model, serial_number,
                       commissioned_at, reducer_last_replaced_at, reducer_interval_months, status) VALUES
  ('00000000-0000-4000-8000-000000000021', '11111111-1111-4111-8111-111111111111', 'bS-100',
   'Dräger', 'PSS 4000', 'SN-88112', DATE '2022-03-15',
   (current_date - make_interval(months => 6))::date, 24, 'in_apparatus'),
  ('00000000-0000-4000-8000-000000000022', '11111111-1111-4111-8111-111111111111', 'bS-200',
   'Dräger', 'PSS 4000', 'SN-88113', DATE '2023-01-20', NULL, NULL, 'in_apparatus'),
  ('00000000-0000-4000-8000-000000000023', '11111111-1111-4111-8111-111111111111', 'bS-300',
   'MSA', 'AirGo Pro', 'SN-90417', DATE '2021-06-01',
   (current_date + 45 - make_interval(months => 14))::date, 14, 'free')
ON CONFLICT (id) DO NOTHING;

-- Балони: №0417 — гідротест прострочено (~28 дн); №0611 — warning (~18 дн); решта ok
INSERT INTO cylinder (id, station_id, number, volume_l, material, working_pressure_bar,
                      manufacturer, manufactured_at, end_of_life_at, hydro_interval_months) VALUES
  ('00000000-0000-4000-8000-000000000031', '11111111-1111-4111-8111-111111111111', '0417',
   6.8, 'composite', 300, 'Luxfer', DATE '2019-03-01', DATE '2034-03-01', 60),
  ('00000000-0000-4000-8000-000000000032', '11111111-1111-4111-8111-111111111111', '0533',
   7.0, 'metal', 300, 'Faber', DATE '2015-05-01', DATE '2035-05-01', 60),
  ('00000000-0000-4000-8000-000000000033', '11111111-1111-4111-8111-111111111111', '0611',
   6.8, 'composite', 300, 'Luxfer', DATE '2021-08-01', DATE '2036-08-01', 36),
  ('00000000-0000-4000-8000-000000000034', '11111111-1111-4111-8111-111111111111', '0912',
   6.0, 'metal', 300, 'Faber', DATE '2018-01-15', DATE '2038-01-15', 60)
ON CONFLICT (id) DO NOTHING;

-- Історія гідротестів (перший «останній тест» при заведенні)
INSERT INTO hydro_test (id, cylinder_id, tested_at, performed_by, notes, created_by) VALUES
  ('00000000-0000-4000-8000-000000000131', '00000000-0000-4000-8000-000000000031',
   (current_date - 28 - make_interval(months => 60))::date, NULL, 'Внесено при заведенні', '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000132', '00000000-0000-4000-8000-000000000032',
   (current_date - make_interval(months => 24))::date, NULL, 'Внесено при заведенні', '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000133', '00000000-0000-4000-8000-000000000033',
   (current_date + 18 - make_interval(months => 36))::date, NULL, 'Внесено при заведенні', '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000134', '00000000-0000-4000-8000-000000000034',
   (current_date - make_interval(months => 12))::date, NULL, 'Внесено при заведенні', '00000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

-- Апарати: bS-100 (балони 0417+0533, несправний через гідротест), bS-200 (балон 0611, warning)
INSERT INTO apparatus (id, station_id, backplate_id, storage_location_id) VALUES
  ('00000000-0000-4000-8000-000000000041', '11111111-1111-4111-8111-111111111111',
   '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000011'),
  ('00000000-0000-4000-8000-000000000042', '11111111-1111-4111-8111-111111111111',
   '00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000012')
ON CONFLICT (id) DO NOTHING;

INSERT INTO apparatus_cylinder (id, apparatus_id, cylinder_id, position, installed_at, installed_by) VALUES
  ('00000000-0000-4000-8000-000000000141', '00000000-0000-4000-8000-000000000041',
   '00000000-0000-4000-8000-000000000031', 1, now() - interval '60 days', '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000142', '00000000-0000-4000-8000-000000000041',
   '00000000-0000-4000-8000-000000000032', 2, now() - interval '60 days', '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000143', '00000000-0000-4000-8000-000000000042',
   '00000000-0000-4000-8000-000000000033', 1, now() - interval '30 days', '00000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

-- Компресор: наробіток 1248 + 0.5 мг сесією нижче = 1248.5; ТО-25 due 1250 → warning
INSERT INTO compressor (id, station_id, name, manufacturer, model,
                        initial_engine_hours, initial_maintenance_at, initial_maintenance_hours) VALUES
  ('00000000-0000-4000-8000-000000000051', '11111111-1111-4111-8111-111111111111',
   'Bauer K-14', 'Bauer', 'K-14', 1248.0, (current_date - 20)::date, 1225.0)
ON CONFLICT (id) DO NOTHING;

-- Історія ТО: ТО-25 на 1225.0 мг (узгоджено з initial_maintenance_*)
INSERT INTO compressor_maintenance (id, compressor_id, level, performed_at, engine_hours_at, performed_by, notes) VALUES
  ('00000000-0000-4000-8000-000000000081', '00000000-0000-4000-8000-000000000051',
   25, (current_date - 20)::date, 1225.0, '00000000-0000-4000-8000-000000000002', 'Планове ТО-25')
ON CONFLICT (id) DO NOTHING;

-- Завершена сесія заправки (~30 хв = 0.5 мг): апарат bS-100 + окремий балон №0912
INSERT INTO fill_session (id, station_id, compressor_id, pressure_before_bar, pressure_target_bar,
                          started_at, ended_at, performed_by) VALUES
  ('00000000-0000-4000-8000-000000000061', '11111111-1111-4111-8111-111111111111',
   '00000000-0000-4000-8000-000000000051', 180, 300,
   now() - interval '2 days', now() - interval '2 days' + interval '30 minutes',
   '00000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

INSERT INTO fill_session_item (id, fill_session_id, apparatus_id, cylinder_id) VALUES
  ('00000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000061',
   '00000000-0000-4000-8000-000000000041', NULL),
  ('00000000-0000-4000-8000-000000000072', '00000000-0000-4000-8000-000000000061',
   NULL, '00000000-0000-4000-8000-000000000034')
ON CONFLICT (id) DO NOTHING;

-- Down Migration
DELETE FROM fill_session_item WHERE id IN
  ('00000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000072');
DELETE FROM fill_session WHERE id = '00000000-0000-4000-8000-000000000061';
DELETE FROM compressor_maintenance WHERE id = '00000000-0000-4000-8000-000000000081';
DELETE FROM compressor WHERE id = '00000000-0000-4000-8000-000000000051';
DELETE FROM apparatus_cylinder WHERE id IN
  ('00000000-0000-4000-8000-000000000141', '00000000-0000-4000-8000-000000000142', '00000000-0000-4000-8000-000000000143');
DELETE FROM apparatus WHERE id IN
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000042');
DELETE FROM hydro_test WHERE id IN
  ('00000000-0000-4000-8000-000000000131', '00000000-0000-4000-8000-000000000132',
   '00000000-0000-4000-8000-000000000133', '00000000-0000-4000-8000-000000000134');
DELETE FROM cylinder WHERE id IN
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000032',
   '00000000-0000-4000-8000-000000000033', '00000000-0000-4000-8000-000000000034');
DELETE FROM backplate WHERE id IN
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000022',
   '00000000-0000-4000-8000-000000000023');
DELETE FROM storage_location WHERE id IN
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012');
DELETE FROM refresh_token WHERE user_id IN
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000003');
DELETE FROM audit_log WHERE user_id IN
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000003');
DELETE FROM app_user WHERE id IN
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000003');
DELETE FROM station WHERE id = '11111111-1111-4111-8111-111111111111';
