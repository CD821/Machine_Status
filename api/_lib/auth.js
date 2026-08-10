import { createRemoteJWKSet, jwtVerify } from "jose";
import { jsonResponse, sql } from "./db.js";

const protectedWriteRoles = new Set(["admin", "supervisor"]);
const logWriteRoles = new Set(["admin", "supervisor", "technician"]);
const assetWriteRoles = new Set(["admin", "supervisor", "technician"]);
const ticketWriteRoles = new Set(["admin", "supervisor", "technician"]);
const knownRoles = new Set(["admin", "supervisor", "technician", "viewer"]);

function issuer() {
  return process.env.CLERK_ISSUER_URL || process.env.CLERK_JWT_ISSUER || "";
}

function jwksUrl() {
  if (process.env.CLERK_JWKS_URL) return process.env.CLERK_JWKS_URL;
  const value = issuer();
  return value ? `${value.replace(/\/$/, "")}/.well-known/jwks.json` : "";
}

function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return knownRoles.has(role) ? role : "";
}

function emailFromClaims(claims) {
  return claims.email || claims.primary_email_address || claims.email_address || "";
}

function isAdminEmail(email) {
  const adminEmails = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(email && adminEmails.includes(String(email).toLowerCase()));
}

function roleFromClaims(claims) {
  if (isAdminEmail(emailFromClaims(claims))) return "admin";
  return normalizeRole(
    claims.role ||
      claims.public_metadata?.role ||
      claims.private_metadata?.role ||
      claims.unsafe_metadata?.role ||
      claims.metadata?.role,
  );
}

async function userRoleAssignments() {
  try {
    const rows = await sql`select value from app_settings where key = 'userRoles' limit 1`;
    return rows[0]?.value && typeof rows[0].value === "object" ? rows[0].value : {};
  } catch {
    return {};
  }
}

function roleFromAssignments(assignments, userId, email = "") {
  return normalizeRole(assignments[userId]) || normalizeRole(assignments[String(email || "").toLowerCase()]);
}

async function roleFromClerkUser(userId, assignments = {}) {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret || !userId) return "";
  const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) return "";
  const user = await response.json();
  const email = user.email_addresses?.find((item) => item.id === user.primary_email_address_id)?.email_address || user.email_addresses?.[0]?.email_address || "";
  if (isAdminEmail(email)) return "admin";
  return roleFromAssignments(assignments, userId, email) || normalizeRole(user.public_metadata?.role || user.private_metadata?.role || user.unsafe_metadata?.role);
}

async function roleForUser(claims) {
  const assignments = await userRoleAssignments();
  const email = emailFromClaims(claims);
  if (isAdminEmail(email)) return "admin";
  return roleFromAssignments(assignments, claims.sub, email) || roleFromClaims(claims) || (await roleFromClerkUser(claims.sub, assignments)) || normalizeRole(process.env.DEFAULT_SIGNED_IN_ROLE) || "viewer";
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
    role: await roleForUser(payload),
    claims: payload,
  };
}

export function canWrite(user, area = "standard") {
  if (user.role === "admin") return true;
  if (area === "logs") return logWriteRoles.has(user.role);
  if (area === "assets") return assetWriteRoles.has(user.role);
  if (area === "tickets") return ticketWriteRoles.has(user.role);
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
