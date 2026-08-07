import { sql, jsonResponse, readJson } from "./_lib/db.js";
import { canWrite, forbidden, withUser } from "./_lib/auth.js";

export default async function handler(request, response) {
  return withUser(request, response, async (user) => {
    if (request.method !== "POST") return jsonResponse(response, { error: "Method not allowed" }, 405);
    if (!canWrite(user)) return forbidden(response);
    const settings = await readJson(request);
    for (const [key, value] of Object.entries(settings)) {
      await sql`
        insert into app_settings (key, value, updated_at)
        values (${key}, ${JSON.stringify(value)}, now())
        on conflict (key) do update set value = excluded.value, updated_at = now()
      `;
    }
    return jsonResponse(response, { ok: true });
  });
}
