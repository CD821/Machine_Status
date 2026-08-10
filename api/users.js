import { jsonResponse } from "./_lib/db.js";
import { canWrite, forbidden, withUser } from "./_lib/auth.js";

export default async function handler(request, response) {
  return withUser(request, response, async (user) => {
    if (request.method !== "GET") return jsonResponse(response, { error: "Method not allowed" }, 405);
    if (!canWrite(user)) return forbidden(response);
    const secret = process.env.CLERK_SECRET_KEY;
    if (!secret) return jsonResponse(response, { users: [] });

    const clerkResponse = await fetch("https://api.clerk.com/v1/users?limit=100&order_by=-created_at", {
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
    });
    if (!clerkResponse.ok) return jsonResponse(response, { users: [] });

    const payload = await clerkResponse.json();
    const users = (payload.data || []).map((item) => {
      const email = item.email_addresses?.find((emailItem) => emailItem.id === item.primary_email_address_id)?.email_address || item.email_addresses?.[0]?.email_address || "";
      const name = [item.first_name, item.last_name].filter(Boolean).join(" ") || item.username || email || "User";
      return {
        id: item.id,
        name,
        email,
        role: item.public_metadata?.role || item.private_metadata?.role || item.unsafe_metadata?.role || "",
      };
    });
    return jsonResponse(response, { users });
  });
}
