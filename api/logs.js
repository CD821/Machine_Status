import { sql, jsonResponse, readJson } from "./_lib/db.js";
import { canWrite, forbidden, withUser } from "./_lib/auth.js";

export default async function handler(request, response) {
  return withUser(request, response, async (user) => {
    if (request.method !== "POST") return jsonResponse(response, { error: "Method not allowed" }, 405);
    if (!canWrite(user, "logs")) return forbidden(response);
    const log = await readJson(request);
    await sql`
      insert into maintenance_logs (
        machine_id, status, issue_type, notes, technician, down_at, up_at,
        duration_minutes, source
      )
      values (
        ${log.machine_id}, ${log.status}, ${log.issue_type}, ${log.notes}, ${log.technician},
        ${log.down_at}, ${log.up_at}, ${log.duration_minutes}, ${log.source || "App"}
      )
    `;
    return jsonResponse(response, { ok: true });
  });
}
