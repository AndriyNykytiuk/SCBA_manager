-- Up Migration
-- Ложамент: два додаткові ідентифікатори компонентів — номер легеневого автомату
-- та номер манометру (вводяться при створенні, опційні, як і серійний номер).
ALTER TABLE backplate ADD COLUMN lung_valve_number text;
ALTER TABLE backplate ADD COLUMN gauge_number text;

-- Down Migration
ALTER TABLE backplate DROP COLUMN gauge_number;
ALTER TABLE backplate DROP COLUMN lung_valve_number;
