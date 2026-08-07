import { sql, jsonResponse, readJson } from "./_lib/db.js";
import { canWrite, forbidden, withUser } from "./_lib/auth.js";

export default async function handler(request, response) {
  return withUser(request, response, async (user) => {
    if (!canWrite(user)) return forbidden(response);

    if (request.method === "DELETE") {
      const id = request.query?.id || new URL(request.url, "http://localhost").searchParams.get("id");
      if (!id) return jsonResponse(response, { error: "Missing id" }, 400);
      await sql`update work_orders set status = 'deleted' where id = ${id}`;
      return jsonResponse(response, { ok: true });
    }

    if (request.method !== "POST") return jsonResponse(response, { error: "Method not allowed" }, 405);
    const order = await readJson(request);
    await sql`
      insert into work_orders (
        id, machine_id, issue, priority, status, assigned_to, parts_needed,
        opened_at, scheduled_date, completed_at
      )
      values (
        ${order.id}, ${order.machine_id}, ${order.issue}, ${order.priority}, ${order.status},
        ${order.assigned_to}, ${order.parts_needed || []}, ${order.opened_at},
        ${order.scheduled_date}, ${order.completed_at}
      )
      on conflict (id) do update set
        machine_id = excluded.machine_id,
        issue = excluded.issue,
        priority = excluded.priority,
        status = excluded.status,
        assigned_to = excluded.assigned_to,
        parts_needed = excluded.parts_needed,
        opened_at = excluded.opened_at,
        scheduled_date = excluded.scheduled_date,
        completed_at = excluded.completed_at
    `;
    return jsonResponse(response, { ok: true });
  });
}
