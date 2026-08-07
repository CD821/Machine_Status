import { readFile, writeFile } from "node:fs/promises";

const data = JSON.parse(await readFile(new URL("../data/equipment-data.json", import.meta.url), "utf8"));

function sql(value) {
  if (value === null || value === undefined || value === "") return "null";
  if (Array.isArray(value)) return `array[${value.map(sql).join(", ")}]::text[]`;
  if (typeof value === "object") return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

function dateTime(value) {
  if (!value) return "null";
  return sql(`${value}T12:00:00`);
}

const lines = [
  "-- Generated from data/equipment-data.json",
  "-- Run docs/supabase-schema.sql first.",
  "",
];

lines.push("insert into machines (id, name, category, location, model, serial_number, current_status, latest_note, last_updated, runtime_today_hours, utilization, oee, status_counts)");
lines.push("values");
lines.push(
  data.machines
    .map(
      (machine) =>
        `(${sql(machine.id)}, ${sql(machine.name)}, ${sql(machine.category)}, ${sql(machine.location)}, ${sql(machine.model)}, ${sql(machine.serialNumber)}, ${sql(machine.currentStatus)}, ${sql(machine.latestNote)}, ${dateTime(machine.lastUpdated)}, ${machine.runtimeTodayHours || 0}, ${machine.utilization || 0}, ${machine.oee || 0}, ${sql(machine.statusCounts || {})})`,
    )
    .join(",\n"),
);
lines.push("on conflict (id) do update set name = excluded.name, category = excluded.category, location = excluded.location, model = excluded.model, serial_number = excluded.serial_number, current_status = excluded.current_status, latest_note = excluded.latest_note, last_updated = excluded.last_updated, runtime_today_hours = excluded.runtime_today_hours, utilization = excluded.utilization, oee = excluded.oee, status_counts = excluded.status_counts;");
lines.push("");

lines.push("insert into app_settings (key, value) values");
lines.push(`('technicians', ${sql(data.technicians || [])}),`);
lines.push(`('issueTypes', ${sql(data.issueTypes || [])}),`);
lines.push(`('statusLabels', ${sql({})})`);
lines.push("on conflict (key) do update set value = excluded.value, updated_at = now();");
lines.push("");

const logRows = data.updates.slice(-1000);
if (logRows.length) {
  lines.push("insert into maintenance_logs (machine_id, status, notes, logged_at, source)");
  lines.push("values");
  lines.push(
    logRows
      .map((log) => `(${sql(log.machineId)}, ${sql(log.status)}, ${sql(log.note || "")}, ${dateTime(log.date)}, ${sql(log.source || "Equipment Status.xlsx")})`)
      .join(",\n"),
  );
  lines.push(";");
}

await writeFile(new URL("../docs/supabase-seed.sql", import.meta.url), `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote docs/supabase-seed.sql with ${data.machines.length} machines and ${logRows.length} logs.`);
