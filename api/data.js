import { sql, jsonResponse } from "./_lib/db.js";
import { withUser } from "./_lib/auth.js";

export default async function handler(request, response) {
  return withUser(request, response, async () => {
    const [machines, logs, workOrders, pmSchedules, settingsRows] = await Promise.all([
      sql`select * from machines order by name asc`,
      sql`select * from maintenance_logs order by logged_at asc`,
      sql`select * from work_orders where status <> 'deleted' order by opened_at desc`,
      sql`select * from pm_schedules order by due_date asc`,
      sql`select key, value from app_settings`,
    ]);

    const machineMap = new Map(machines.map((machine) => [machine.id, machine]));
    const settings = Object.fromEntries(settingsRows.map((row) => [row.key, row.value]));

    return jsonResponse(response, {
      sourceWorkbook: "Neon",
      generatedAt: new Date().toISOString(),
      machines: machines.map(machineFromDb),
      updates: logs.map((row) => logFromDb(row, machineMap)),
      workOrders: workOrders.map((row) => workOrderFromDb(row, machineMap)),
      pmSchedule: pmSchedules.map((row) => pmFromDb(row, machineMap)),
      technicians: settings.technicians || [],
      issueTypes: settings.issueTypes || [],
      statusLabels: settings.statusLabels || {},
      userRoles: settings.userRoles || {},
    });
  });
}

function machineFromDb(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    location: row.location || "",
    model: row.model || "",
    serialNumber: row.serial_number || "",
    currentStatus: row.current_status || "unknown",
    lastUpdated: dateOnly(row.last_updated || row.created_at),
    latestNote: row.latest_note || "",
    runtimeTodayHours: Number(row.runtime_today_hours || 0),
    utilization: Number(row.utilization || 0),
    oee: Number(row.oee || 0),
    imageUrl: row.image_url || "",
    statusCounts: row.status_counts || {},
  };
}

function logFromDb(row, machineMap) {
  const machine = machineMap.get(row.machine_id);
  const dateSource = row.down_at || row.up_at || row.logged_at;
  const downAt = dateTimeValue(row.down_at);
  const upAt = dateTimeValue(row.up_at);
  return {
    id: row.id,
    machineId: row.machine_id,
    machine: machine?.name || "Machine",
    date: dateOnly(dateSource),
    status: row.status,
    downAt,
    upAt,
    durationMinutes: row.duration_minutes,
    note: row.notes || "",
    source: row.source || "Neon",
  };
}

function workOrderFromDb(row, machineMap) {
  const machine = machineMap.get(row.machine_id);
  return {
    id: row.id,
    machineId: row.machine_id,
    machine: machine?.name || "Machine",
    issue: row.issue,
    priority: row.priority,
    status: row.status,
    technician: row.assigned_to || "",
    opened: dateOnly(row.opened_at),
    scheduledDate: dateOnly(row.scheduled_date || row.opened_at),
    completedAt: dateOnly(row.completed_at),
    partsNeeded: row.parts_needed || [],
  };
}

function dateOnly(value) {
  if (!value) return "";
  if (value instanceof Date) return shopDateParts(value).date;
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso && !/[zZ]|[+-]\d{2}:?\d{2}\s*$/.test(raw)) return `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw.slice(0, 10) : shopDateParts(parsed).date;
}

function dateTimeValue(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  const raw = String(value).trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}\s*$/.test(raw)) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T\s](\d{1,2}):(\d{2})/);
  if (iso) {
    const [, year, month, day, hour, minute] = iso;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${minute}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function shopDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}` };
}

function pmFromDb(row, machineMap) {
  const machine = machineMap.get(row.machine_id);
  return {
    id: row.id,
    machineId: row.machine_id,
    machine: machine?.name || "Machine",
    task: row.task,
    frequency: row.frequency,
    dueDate: row.due_date,
    dueInHours: row.due_in_hours || 0,
    technician: row.assigned_to || "",
    status: row.status || "scheduled",
    lastCompleted: dateOnly(row.last_completed_at),
  };
}
