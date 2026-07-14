-- Up Migration
-- MVP: справжнє видалення невикористаних балонів/ложаментів (DELETE /cylinders/:id, /backplates/:id).
-- Додаємо значення 'delete' до audit_action — фіксуємо факт видалення в audit_log
-- (entity_id залишається в лозі, хоча самого запису вже нема — audit_log без FK на cylinder/backplate).
ALTER TYPE audit_action ADD VALUE 'delete';

-- Down Migration
-- Видалення значення з enum у PostgreSQL вимагає перестворення типу; для MVP down не підтримується.
-- При потребі відкату — відновити БД з бекапу до цієї міграції.
