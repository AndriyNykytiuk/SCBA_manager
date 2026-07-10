// Типи API — точно за docs/backend/api-contract.md (v1.0)

export type Role = 'admin' | 'master' | 'duty';
export type ConditionStatus = 'ok' | 'warning' | 'overdue';

export interface Condition {
  status: ConditionStatus;
  reason: string | null;
  due_at?: string | null;
}

export interface StationRef {
  id: string;
  name: string;
}

export interface UserRef {
  id: string;
  full_name: string;
}

export interface AuthUser {
  id: string;
  login: string;
  full_name: string;
  role: Role;
  station: StationRef | null;
}

export interface ListMeta {
  page: number;
  limit: number;
  total: number;
}

export interface ListResponse<T> {
  data: T[];
  meta: ListMeta;
}

// ===== Stations =====
export interface Station {
  id: string;
  name: string;
  address: string | null;
  alert_counters: { overdue: number; warning: number };
  created_at: string;
  archived_at: string | null;
}

// ===== Users =====
export interface User {
  id: string;
  login: string;
  full_name: string;
  role: Role;
  station: StationRef | null;
  is_active: boolean;
  created_at: string;
  archived_at: string | null;
}

export interface UserCreateBody {
  login: string;
  password: string;
  full_name: string;
  role: Role;
  station_id: string | null;
}

export interface UserPatchBody {
  full_name?: string;
  role?: Role;
  station_id?: string | null;
  is_active?: boolean;
}

// ===== Storage locations =====
export interface StorageLocation {
  id: string;
  station_id: string;
  name: string;
  archived_at: string | null;
}

// ===== Backplates (ложаменти) =====
export type BackplateStatus = 'in_apparatus' | 'free' | 'in_repair' | 'decommissioned';

export interface Backplate {
  id: string;
  station_id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  commissioned_at: string | null;
  reducer_last_replaced_at: string | null;
  reducer_interval_months: number;
  next_reducer_replacement_at: string | null;
  status: BackplateStatus;
  condition: Condition;
  apparatus: { id: string; name: string } | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface BackplateCreateBody {
  name: string;
  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
  commissioned_at?: string | null;
  reducer_last_replaced_at?: string | null;
  reducer_interval_months: number;
  notes?: string | null;
}

export type BackplatePatchBody = Partial<BackplateCreateBody> & {
  status?: 'free' | 'in_repair';
};

// ===== Cylinders (балони) =====
export type CylinderMaterial = 'metal' | 'composite';

export interface Cylinder {
  id: string;
  station_id: string;
  number: string;
  volume_l: number;
  material: CylinderMaterial;
  working_pressure_bar: number;
  manufacturer: string | null;
  manufactured_at: string;
  end_of_life_at: string;
  hydro_interval_months: number;
  last_hydro_test_at: string | null;
  next_hydro_test_at: string | null;
  next_hydro_test_override: string | null;
  condition: Condition;
  installation: { apparatus_id: string; apparatus_name: string; position: number } | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface CylinderCreateBody {
  number: string;
  volume_l: number;
  material: CylinderMaterial;
  working_pressure_bar: number;
  manufacturer?: string | null;
  manufactured_at: string;
  end_of_life_at: string;
  hydro_interval_months: number;
  last_hydro_test_at: string;
  notes?: string | null;
}

export interface CylinderPatchBody {
  number?: string;
  working_pressure_bar?: number;
  end_of_life_at?: string;
  hydro_interval_months?: number;
  notes?: string | null;
}

export interface HydroTest {
  id: string;
  cylinder_id: string;
  tested_at: string;
  performed_by: UserRef | null;
  notes: string | null;
  created_at: string;
  cylinder?: { next_hydro_test_at: string | null; condition: Condition };
}

export interface HydroTestCreateBody {
  tested_at: string;
  performed_by?: string | null;
  notes?: string | null;
}

// ===== Apparatus (апарати) =====
export interface ApparatusCylinderSlot {
  position: number;
  cylinder: {
    id: string;
    number: string;
    volume_l?: number;
    material?: CylinderMaterial;
    condition: Condition;
  };
  installed_at: string;
}

export interface Apparatus {
  id: string;
  station_id: string;
  name: string;
  backplate: { id: string; name: string; model: string | null; condition: Condition };
  cylinders: ApparatusCylinderSlot[];
  cylinders_installed: number;
  condition: Condition;
  storage_location: { id: string; name: string } | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface ApparatusCreateBody {
  backplate_id: string;
  cylinders: { cylinder_id: string; position: number }[];
  storage_location_id?: string | null;
  notes?: string | null;
}

export interface ApparatusCylinderHistoryEntry {
  id: string;
  cylinder: { id: string; number: string };
  position: number;
  installed_at: string;
  installed_by: UserRef | null;
  removed_at: string | null;
  removed_by: UserRef | null;
}

// ===== Compressors =====
export interface MaintenanceLevelDue {
  level: number;
  due_hours: number | null;
  due_date: string | null;
  status: ConditionStatus;
}

export interface CompressorMaintenance {
  suggested_level: number | null;
  levels: MaintenanceLevelDue[];
  next: { level: number; due_hours: number } | null;
}

export interface Compressor {
  id: string;
  station_id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  engine_hours: number;
  active_fill_session_id: string | null;
  condition: Condition;
  maintenance: CompressorMaintenance;
  notes: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface CompressorCreateBody {
  name: string;
  manufacturer?: string | null;
  model?: string | null;
  initial_engine_hours: number;
  initial_maintenance_at: string;
  initial_maintenance_hours: number;
}

export interface CompressorPatchBody {
  name?: string;
  manufacturer?: string | null;
  model?: string | null;
  notes?: string | null;
}

export interface MaintenanceCreateBody {
  level: number;
  performed_at: string;
  engine_hours_at?: number;
  notes?: string | null;
}

export interface MaintenanceEvent {
  id: string;
  compressor_id: string;
  level: number;
  performed_at: string;
  engine_hours_at: number;
  performed_by: UserRef | null;
  notes: string | null;
  created_at: string;
  compressor?: {
    condition: Condition;
    maintenance: Pick<CompressorMaintenance, 'suggested_level' | 'next'>;
  };
}

export type CompressorHistoryType = 'all' | 'maintenance' | 'fill_session';

export interface CompressorHistoryEvent {
  type: 'fill_session' | 'maintenance';
  id: string;
  occurred_at: string;
  summary: string;
  performed_by: UserRef | null;
}

// ===== Fill sessions =====
export interface FillSessionItem {
  type: 'apparatus' | 'cylinder';
  id: string;
  name: string;
}

export interface FillSession {
  id: string;
  station_id: string;
  compressor: { id: string; name: string };
  pressure_before_bar: number;
  pressure_target_bar: number;
  started_at: string;
  ended_at: string | null;
  duration_hours: number | null;
  performed_by: UserRef;
  items: FillSessionItem[];
}

export type FillSessionItemBody = { apparatus_id: string } | { cylinder_id: string };

export interface FillSessionCreateBody {
  compressor_id: string;
  pressure_before_bar: number;
  pressure_target_bar: number;
  items: FillSessionItemBody[];
}

export interface ActiveFillSessions {
  server_time: string;
  data: FillSession[];
}

export interface FillSessionStopResponse {
  id: string;
  ended_at: string;
  duration_hours: number;
  compressor: {
    id: string;
    engine_hours: number;
    condition: Condition;
    maintenance: { next: { level: number; due_hours: number } | null };
  };
}

// ===== Dashboard =====
export type AlertEntityType = 'apparatus' | 'cylinder' | 'backplate' | 'compressor';

export interface DashboardAlertItem {
  entity_type: AlertEntityType;
  entity_id: string;
  title: string;
  subtitle: string;
  status: ConditionStatus;
  reason: string;
  due_at: string | null;
  overdue_days?: number;
  days_left?: number;
  due_hours?: number;
  overdue_hours?: number;
}

export interface DashboardAlerts {
  counters: { overdue: number; warning: number; ok: number };
  data: DashboardAlertItem[];
}
