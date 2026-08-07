create extension if not exists pgcrypto;

do $$ begin
  create type work_order_priority as enum ('low', 'medium', 'high', 'urgent');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type work_order_status as enum ('open', 'scheduled', 'completed', 'cancelled', 'deleted');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type pm_status as enum ('scheduled', 'due-soon', 'overdue', 'completed');
exception when duplicate_object then null;
end $$;

create table if not exists machines (
  id text primary key,
  name text not null,
  category text not null,
  location text,
  model text,
  serial_number text,
  current_status text not null default 'unknown',
  latest_note text,
  last_updated timestamptz default now(),
  runtime_today_hours numeric not null default 0,
  utilization numeric not null default 0,
  oee numeric not null default 0,
  image_url text,
  status_counts jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists maintenance_logs (
  id uuid primary key default gen_random_uuid(),
  machine_id text not null references machines(id) on delete cascade,
  status text not null,
  issue_type text,
  notes text not null,
  technician text,
  down_at timestamptz,
  up_at timestamptz,
  duration_minutes integer,
  parts_used text[] not null default '{}',
  photo_urls text[] not null default '{}',
  logged_at timestamptz not null default now(),
  source text
);

create table if not exists downtime_incidents (
  id uuid primary key default gen_random_uuid(),
  machine_id text not null references machines(id) on delete cascade,
  down_at timestamptz not null,
  up_at timestamptz,
  status text not null default 'open',
  issue_type text,
  priority work_order_priority not null default 'medium',
  down_notes text,
  resolution_notes text,
  technician text,
  parts_used text[] not null default '{}',
  duration_minutes integer generated always as (
    case
      when up_at is null then null
      else round(extract(epoch from (up_at - down_at)) / 60)::integer
    end
  ) stored,
  created_at timestamptz not null default now()
);

create table if not exists work_orders (
  id text primary key,
  machine_id text not null references machines(id) on delete cascade,
  issue text not null,
  priority work_order_priority not null default 'medium',
  status work_order_status not null default 'open',
  assigned_to text,
  parts_needed text[] not null default '{}',
  opened_at timestamptz not null default now(),
  scheduled_date date,
  completed_at timestamptz
);

create table if not exists pm_schedules (
  id text primary key,
  machine_id text not null references machines(id) on delete cascade,
  task text not null,
  frequency text not null,
  due_date date,
  due_in_hours integer,
  assigned_to text,
  status pm_status not null default 'scheduled',
  last_completed_at timestamptz
);

create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists maintenance_logs_machine_logged_at_idx
  on maintenance_logs (machine_id, logged_at desc);

create index if not exists downtime_incidents_machine_down_at_idx
  on downtime_incidents (machine_id, down_at desc);

create index if not exists work_orders_machine_status_idx
  on work_orders (machine_id, status);

create index if not exists pm_schedules_due_date_idx
  on pm_schedules (due_date, status);
