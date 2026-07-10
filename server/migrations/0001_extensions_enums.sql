-- Up Migration
-- db-schema.md §3.0 — розширення та enum-типи

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- регістронезалежний login

CREATE TYPE user_role         AS ENUM ('admin', 'master', 'duty');
CREATE TYPE backplate_status  AS ENUM ('in_apparatus', 'free', 'in_repair', 'decommissioned');
CREATE TYPE cylinder_material AS ENUM ('metal', 'composite');
CREATE TYPE audit_action      AS ENUM ('create', 'update', 'archive', 'restore');

-- Статус придатності ('ok'|'warning'|'overdue') НЕ зберігається — рахується у VIEW (0007).
-- Рівні ТО компресора — smallint із CHECK (25|125|500|1000|2000), не enum.

-- Down Migration
DROP TYPE audit_action;
DROP TYPE cylinder_material;
DROP TYPE backplate_status;
DROP TYPE user_role;
