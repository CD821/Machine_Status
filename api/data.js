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
    lastUpdated: String(row.last_updated || row.created_at || "").slice(0, 10),
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
  return {
    id: row.id,
    machineId: row.machine_id,
    machine: machine?.name || "Machine",
    date: String(dateSource || "").slice(0, 10),
    status: row.status,
    downAt: row.down_at ? String(row.down_at).slice(0, 16) : "",
    upAt: row.up_at ? String(row.up_at).slice(0, 16) : "",
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
    opened: String(row.opened_at || "").slice(0, 10),
    scheduledDate: String(row.scheduled_date || row.opened_at || "").slice(0, 10),
    completedAt: row.completed_at ? String(row.completed_at).slice(0, 10) : "",
    partsNeeded: row.parts_needed || [],
  };
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
    lastCompleted: row.last_completed_at ? String(row.last_completed_at).slice(0, 10) : "",
  };
}
