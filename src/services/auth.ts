/**
 * Authentication provider abstraction.
 *
 * Runpod SSO is not yet approved/configured, so V2 ships with:
 *  - "dev" provider: cookie-selected identity from the seeded users table.
 *    Local development only; it refuses to run in production.
 *  - "sso" provider: verifies a short-lived HMAC-signed principal from an
 *    approved identity-aware proxy (see docs/deployment-vercel.md), then maps
 *    it to `users`; roles are always read server-side from the database.
 *
 * There are no client-only role checks anywhere: every mutation route calls
 * requireUser/requireRole on the server.
 */
import { createHmac } from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { apiAccessTokens, users } from "@/db/schema";
import { safeEqual, sha256 } from "@/core/tokens";

export type Role = "user" | "admin" | "investigator";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface SessionCapabilities {
  canWrite: boolean;
  canIssue: boolean;
  canCreateCampaign: boolean;
  canCreateInitiative: boolean;
  canReadAudit: boolean;
  canAdminister: boolean;
}

export type ApiScope =
  | "utm:read"
  | "utm:preview"
  | "utm:issue"
  | "utm:campaigns:write"
  | "utm:initiatives:write"
  | "gtm:read"
  | "gtm:templates";

export interface ApiSessionUser extends SessionUser {
  authMethod: "bearer";
  tokenId: string;
  scopes: ApiScope[];
}

export const DEV_IDENTITY_COOKIE = "rp_dev_identity";

export class AuthError extends Error {
  constructor(
    public status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

async function devProvider(): Promise<SessionUser | null> {
  // No escape hatch: the dev provider can never run in a production build.
  if (process.env.NODE_ENV === "production") {
    throw new AuthError(
      401,
      "Dev auth provider is disabled in production. Configure AUTH_PROVIDER=sso.",
    );
  }
  const jar = await cookies();
  const email = jar.get(DEV_IDENTITY_COOKIE)?.value ?? "dev-admin@runpod.io";
  const db = await getDb();
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const row = rows[0];
  if (!row || !row.active) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export function verifySsoPrincipal(input: {
  email: string | null;
  timestamp: string | null;
  signature: string | null;
  secret?: string;
  nowSeconds?: number;
}): string {
  if (!input.secret) throw new AuthError(401, "SSO verification is not configured.");
  const email = input.email?.trim().toLowerCase() ?? "";
  const timestamp = input.timestamp ?? "";
  const seconds = Number(timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!email || !email.includes("@") || !Number.isFinite(seconds) || Math.abs(now - seconds) > 300) {
    throw new AuthError(401, "SSO principal is missing or expired.");
  }
  const expected = `v1=${createHmac("sha256", input.secret)
    .update(`${timestamp}\n${email}`)
    .digest("hex")}`;
  if (!input.signature || !safeEqual(input.signature, expected)) {
    throw new AuthError(401, "SSO principal signature is invalid.");
  }
  return email;
}

async function ssoProvider(req?: Request): Promise<SessionUser | null> {
  const incoming = req?.headers ?? (await headers());
  const email = verifySsoPrincipal({
    email: incoming.get("x-runpod-auth-email"),
    timestamp: incoming.get("x-runpod-auth-timestamp"),
    signature: incoming.get("x-runpod-auth-signature"),
    secret: process.env.SSO_HEADER_SECRET,
  });
  const db = await getDb();
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row?.active) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

async function bearerProvider(req: Request): Promise<ApiSessionUser | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const raw = header.slice("Bearer ".length).trim();
  if (!raw) throw new AuthError(401, "Bearer token is missing.");
  const db = await getDb();
  const rows = await db
    .select({ token: apiAccessTokens, user: users })
    .from(apiAccessTokens)
    .innerJoin(users, eq(apiAccessTokens.userId, users.id))
    .where(
      and(
        eq(apiAccessTokens.tokenHash, sha256(raw)),
        isNull(apiAccessTokens.revokedAt),
        gt(apiAccessTokens.expiresAt, new Date()),
        eq(users.active, true),
      ),
    )
    .limit(1);
  const match = rows[0];
  if (!match) throw new AuthError(401, "Bearer token is invalid, expired, or revoked.");
  await db
    .update(apiAccessTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiAccessTokens.id, match.token.id));
  return {
    id: match.user.id,
    email: match.user.email,
    name: match.user.name,
    role: match.user.role,
    authMethod: "bearer",
    tokenId: match.token.id,
    scopes: (match.token.scopes as ApiScope[]) ?? [],
  };
}

/**
 * POC login provider: same signed-session-cookie verification as OIDC, but the
 * cookie is minted by a simple email sign-in (see /api/auth/poc-login) instead
 * of Google. Intended only for gated proof-of-concept deployments; switching
 * AUTH_PROVIDER to "google" restores real IdP sign-in with no other change.
 */
export function pocAuthEnabled(): boolean {
  return (process.env.AUTH_PROVIDER ?? "dev") === "poc";
}

/** Google/OIDC provider: verified HMAC session cookie → users row. */
async function oidcSessionProvider(req?: Request): Promise<SessionUser | null> {
  const { SESSION_COOKIE, verifySessionCookieValue } = await import("./oidc");
  let cookieValue: string | undefined;
  if (req) {
    const raw = req.headers.get("cookie") ?? "";
    cookieValue = raw
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1);
    if (cookieValue) cookieValue = decodeURIComponent(cookieValue);
  } else {
    const jar = await cookies();
    cookieValue = jar.get(SESSION_COOKIE)?.value;
  }
  const email = verifySessionCookieValue(cookieValue);
  if (!email) return null;
  const db = await getDb();
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row?.active) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function getSession(req?: Request): Promise<SessionUser | ApiSessionUser | null> {
  if (req?.headers.get("authorization")) return bearerProvider(req);
  const provider = process.env.AUTH_PROVIDER ?? "dev";
  if (provider === "google" || provider === "oidc" || provider === "poc") {
    return oidcSessionProvider(req);
  }
  if (provider === "sso") return ssoProvider(req);
  if (provider === "dev") return devProvider();
  throw new AuthError(401, "AUTH_PROVIDER is invalid. Use dev, google, oidc, poc, or sso.");
}

export function capabilitiesFor(actor: SessionUser | null): SessionCapabilities {
  const allowedByRole = Boolean(actor && actor.role !== "investigator");
  const scopes = actor && "authMethod" in actor
    ? new Set((actor as ApiSessionUser).scopes)
    : null;
  const canIssue = allowedByRole && (!scopes || scopes.has("utm:issue"));
  const canCreateCampaign = allowedByRole && (!scopes || scopes.has("utm:campaigns:write"));
  const canCreateInitiative = allowedByRole && (!scopes || scopes.has("utm:initiatives:write"));
  const canWrite = canIssue || canCreateCampaign || canCreateInitiative;
  return {
    canWrite,
    canIssue,
    canCreateCampaign,
    canCreateInitiative,
    canReadAudit: Boolean(actor && CAN_READ_AUDIT.includes(actor.role)),
    canAdminister: actor?.role === "admin",
  };
}

export function canManage(
  actor: SessionUser,
  record: { createdBy?: string | null; ownerId?: string | null },
): boolean {
  return actor.role !== "investigator" && (
    actor.role === "admin" || record.createdBy === actor.id || record.ownerId === actor.id
  );
}

export async function requireUser(req?: Request): Promise<SessionUser | ApiSessionUser> {
  const session = await getSession(req);
  if (!session) throw new AuthError(401, "Not authenticated.");
  return session;
}

export async function requireApiScope(req: Request, ...required: ApiScope[]): Promise<SessionUser | ApiSessionUser> {
  const session = await requireUser(req);
  if (!("authMethod" in session)) return session; // authenticated first-party web session
  const missing = required.filter((scope) => !session.scopes.includes(scope));
  if (missing.length) throw new AuthError(403, `Token is missing scope: ${missing.join(", ")}.`);
  return session;
}

/** Machine-facing endpoints must never fall back to a browser cookie session. */
export async function requireBearerApiScope(
  req: Request,
  ...required: ApiScope[]
): Promise<ApiSessionUser> {
  const session = await requireApiScope(req, ...required);
  if (!("authMethod" in session)) {
    throw new AuthError(401, "A bearer access token is required.");
  }
  return session;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const session = await requireUser();
  if (!roles.includes(session.role)) {
    throw new AuthError(403, `This action requires role: ${roles.join(" or ")}.`);
  }
  return session;
}

/** Investigators and admins may read audit data; only admins mutate config. */
export const CAN_READ_AUDIT: Role[] = ["admin", "investigator"];

/**
 * Registry write gate, enforced inside the shared services so every client
 * (web, /api/v1, Slack, MCP, extension) inherits it: investigators are
 * read-only, exactly as the role documentation promises.
 */
export function assertCanWrite(actor: SessionUser): void {
  if (actor.role === "investigator") {
    throw new AuthError(403, "Investigator accounts are read-only and cannot make changes.");
  }
}

/**
 * Ownership gate for mutating an existing record: the creator, the record's
 * owner, or an administrator. Applied to link revise/retire and
 * campaign/initiative metadata updates.
 */
export function assertCanManage(
  actor: SessionUser,
  record: { createdBy?: string | null; ownerId?: string | null },
  what: string,
): void {
  assertCanWrite(actor);
  if (canManage(actor, record)) return;
  throw new AuthError(
    403,
    `Only the creator, the owner, or an administrator can modify this ${what}.`,
  );
}

/**
 * True only when explicitly opted in outside production (or under test).
 * Gates the dev-time fail-open fallbacks (unset Slack workspace allowlist,
 * unset extension-ID allowlist) so an internet-exposed dev-mode instance is
 * not open by default.
 */
export function insecureDevFallbacksAllowed(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.NODE_ENV === "test" || process.env.ALLOW_INSECURE_DEV === "true";
}
