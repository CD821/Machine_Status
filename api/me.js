import { jsonResponse } from "./_lib/db.js";
import { withUser } from "./_lib/auth.js";

export default async function handler(request, response) {
  return withUser(request, response, async (user) => {
    return jsonResponse(response, {
      id: user.id,
      role: user.role,
    });
  });
}
