import { sql, jsonResponse, readJson } from "./_lib/db.js";
import { canWrite, forbidden, withUser } from "./_lib/auth.js";

export default async function handler(request, response) {
  return withUser(request, response, async (user) => {
    if (request.method !== "POST") return jsonResponse(response, { error: "Method not allowed" }, 405);
    if (!canWrite(user)) return forbidden(response);
    const machine = await readJson(request);
    await sql`
      insert into machines (
        id, name, category, location, model, serial_number, current_status, latest_note,
        last_updated, runtime_today_hours, utilization, oee, image_url, status_counts
      )
      values (
        ${machine.id}, ${machine.name}, ${machine.category}, ${machine.location}, ${machine.model},
        ${machine.serial_number}, ${machine.current_status}, ${machine.latest_note},
        ${machine.last_updated}, ${machine.runtime_today_hours || 0}, ${machine.utilization || 0},
        ${machine.oee || 0}, ${machine.image_url}, ${JSON.stringify(machine.status_counts || {})}
      )
      on conflict (id) do update set
        name = excluded.name,
        category = excluded.category,
        location = excluded.location,
        model = excluded.model,
        serial_number = excluded.serial_number,
        current_status = excluded.current_status,
        latest_note = excluded.latest_note,
        last_updated = excluded.last_updated,
        runtime_today_hours = excluded.runtime_today_hours,
        utilization = excluded.utilization,
        oee = excluded.oee,
        image_url = excluded.image_url,
        status_counts = excluded.status_counts
    `;
    return jsonResponse(response, { ok: true });
  });
}
