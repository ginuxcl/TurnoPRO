-- Esquema del sistema de gestión de turnos
-- PostgreSQL 16

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============ Organizaciones (multi-tenant) ============
CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  timezone    TEXT NOT NULL DEFAULT 'Europe/Madrid',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Usuarios / personal ============
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'employee'
                  CHECK (role IN ('owner','manager','employee')),
  position        TEXT,
  department_id   UUID,
  phone           TEXT,
  color           TEXT NOT NULL DEFAULT '#6366f1',
  weekly_hours    INT NOT NULL DEFAULT 40,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  invite_token    TEXT,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

-- ============ Refresh tokens (rotación + detección de reuso) ============
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  family      UUID NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  user_agent  TEXT,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_hash ON refresh_tokens(token_hash);

-- ============ Departamentos ============
CREATE TABLE IF NOT EXISTS departments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#0ea5e9',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS fk_users_department,
  ADD CONSTRAINT fk_users_department
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;

-- ============ Plantillas de turno ============
CREATE TABLE IF NOT EXISTS shift_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  break_minutes INT NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  color         TEXT NOT NULL DEFAULT '#6366f1',
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_templates_org ON shift_templates(org_id);

-- ============ Horarios (semanas) ============
CREATE TABLE IF NOT EXISTS schedules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  week_start   DATE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','published','archived')),
  published_at TIMESTAMPTZ,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, week_start)
);

-- ============ Turnos ============
-- user_id NULL = turno abierto (publicable y reclamable por personal)
CREATE TABLE IF NOT EXISTS shifts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  schedule_id   UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  break_minutes INT NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  notes         TEXT,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shifts_org_date ON shifts(org_id, date);
CREATE INDEX IF NOT EXISTS idx_shifts_user     ON shifts(user_id, date);
CREATE INDEX IF NOT EXISTS idx_shifts_schedule ON shifts(schedule_id);

-- Evita doble asignación del mismo empleado el mismo día/hora exacta
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_person_slot
  ON shifts(user_id, date, start_time)
  WHERE user_id IS NOT NULL;

-- ============ Solicitudes de ausencia ============
CREATE TABLE IF NOT EXISTS leave_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('vacation','sick','personal','other')),
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','approved','rejected')),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leave_org ON leave_requests(org_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_user ON leave_requests(user_id);

-- ============ Solicitudes de reclamación de turno abierto ============
CREATE TABLE IF NOT EXISTS shift_claims (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shift_id   UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shift_id, user_id)
);

-- ============ Disponibilidad semanal del empleado ============
CREATE TABLE IF NOT EXISTS availability (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekdays   JSONB NOT NULL DEFAULT '[1,1,1,1,1,0,0]',
  start_time TIME NOT NULL DEFAULT '09:00',
  end_time   TIME NOT NULL DEFAULT '17:00',
  notes      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- ============ Reglas de planificación por organización ============
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS rules JSONB NOT NULL
  DEFAULT '{"max_shifts_per_day":2,"min_rest_hours":8,"max_consecutive_days":6,"max_weekly_hours":null}';

-- ============ Cambios de turno entre personas ============
CREATE TABLE IF NOT EXISTS swap_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shift_id     UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','accepted','approved','rejected','declined','cancelled')),
  reviewed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_swap_org   ON swap_requests(org_id, status);
CREATE INDEX IF NOT EXISTS idx_swap_from  ON swap_requests(from_user_id);
CREATE INDEX IF NOT EXISTS idx_swap_to    ON swap_requests(to_user_id);

-- ============ Notificaciones in-app ============
CREATE TABLE IF NOT EXISTS notifications (
  id         BIGSERIAL PRIMARY KEY,
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);

-- ============ Auditoría ============
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  org_id      UUID,
  actor_id    UUID,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  details     JSONB,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(org_id, created_at DESC);

-- ============ Valor hora (coste por empleado, EnSaturno "valor hora flexible") ============
ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(8,2);

-- ============ Fichaje / control horario (Factorial, EnSaturno) ============
CREATE TABLE IF NOT EXISTS time_entries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date  DATE NOT NULL,
  clock_in   TIMESTAMPTZ NOT NULL,
  clock_out  TIMESTAMPTZ,
  source     TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','manual')),
  note       TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_time_user  ON time_entries(user_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_time_org   ON time_entries(org_id, work_date DESC);
-- Un solo fichaje abierto por persona
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_open ON time_entries(user_id) WHERE clock_out IS NULL;

-- ============ Patrones de semana / rotaciones (Turnyon "7x7,5x2", EnSaturno "semanas moldes") ============
CREATE TABLE IF NOT EXISTS week_patterns (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  days       JSONB NOT NULL, -- [[{name,start_time,end_time,break_minutes}], x7]
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pattern_org ON week_patterns(org_id);

-- ============ Festivos de la organización (Factorial: ausencias y festivos juntos) ============
CREATE TABLE IF NOT EXISTS holidays (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  date    DATE NOT NULL,
  name    TEXT NOT NULL,
  UNIQUE (org_id, date)
);
CREATE INDEX IF NOT EXISTS idx_holiday_org ON holidays(org_id, date);

-- ============ Preferencias del empleado: días bloqueados (Turnyon) ============
CREATE TABLE IF NOT EXISTS preferences (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  blocked_dates JSONB NOT NULL DEFAULT '[]',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ API keys para integraciones (EnSaturno) ============
CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_apikey_org ON api_keys(org_id);
