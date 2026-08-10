import { createRemoteJWKSet, jwtVerify } from "jose";
import { jsonResponse } from "./db.js";

const protectedWriteRoles = new Set(["admin", "supervisor"]);
const logWriteRoles = new Set(["admin", "supervisor", "technician"]);

function issuer() {
  return process.env.CLERK_ISSUER_URL || process.env.CLERK_JWT_ISSUER || "";
}

function jwksUrl() {
  if (process.env.CLERK_JWKS_URL) return process.env.CLERK_JWKS_URL;
  const value = issuer();
  return value ? `${value.replace(/\/$/, "")}/.well-known/jwks.json` : "";
}

function roleFromClaims(claims) {
  const email = claims.email || claims.primary_email_address || "";
  const adminEmails = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (email && adminEmails.includes(String(email).toLowerCase())) return "admin";
  return claims.role || claims.public_metadata?.role || claims.metadata?.role || process.env.DEFAULT_SIGNED_IN_ROLE || "admin";
}

export async function requireUser(request) {
  const authHeader = request.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("Unauthorized"), { status: 401 });

  const url = jwksUrl();
  if (!url) throw Object.assign(new Error("CLERK_JWKS_URL or CLERK_ISSUER_URL is required."), { status: 500 });

  const { payload } = await jwtVerify(token, createRemoteJWKSet(new URL(url)), {
    issuer: issuer() || undefined,
  });

  return {
    id: payload.sub,
    role: roleFromClaims(payload),
    claims: payload,
  };
}

export function canWrite(user, area = "standard") {
  if (user.role === "admin") return true;
  if (area === "logs") return logWriteRoles.has(user.role);
  return protectedWriteRoles.has(user.role);
}

export function forbidden(response) {
  return jsonResponse(response, { error: "Forbidden" }, 403);
}

export async function withUser(request, response, handler) {
  try {
    const user = await requireUser(request);
    return await handler(user);
  } catch (error) {
    return jsonResponse(response, { error: error.message || "Unauthorized" }, error.status || 500);
  }
}
