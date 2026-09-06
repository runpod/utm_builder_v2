/**
 * OIDC login provider (authorization-code flow, confidential client).
 *
 * Defaults to Google (everyone at Runpod has a Google Workspace account), but
 * is issuer-agnostic: point OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET at Okta or any
 * other IdP and nothing else changes. The id_token is received directly from
 * the issuer's token endpoint over TLS (authenticated with the client secret),
 * and its claims are strictly validated (iss/aud/exp/nonce/email_verified/
 * allowed domain). Sessions are short-lived HMAC-signed cookies; roles always
 * come from the `users` table server-side. Sign-in never auto-provisions a
 * user — unknown emails are rejected.
 */
import { createHmac, randomBytes } from "node:crypto";
import { safeEqual } from "@/core/tokens";
import { AuthError } from "./auth";

export const SESSION_COOKIE = "rp_session";
export const OIDC_STATE_COOKIE = "rp_oidc_state";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface OidcSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowedDomains: string[];
}

export function oidcSettings(requestOrigin?: string): OidcSettings {
  const issuer = process.env.OIDC_ISSUER?.trim() || "https://accounts.google.com";
  const clientId = process.env.OIDC_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID?.trim() || "";
  const clientSecret =
    process.env.OIDC_CLIENT_SECRET?.trim() || process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
  if (!clientId || !clientSecret) {
    throw new AuthError(401, "Google/OIDC sign-in is not configured (client ID/secret missing).");
  }
  // APP_URL is authoritative; the request origin is accepted only outside
  // production so local dev works without configuration.
  const base =
    process.env.APP_URL?.trim() ||
    (process.env.NODE_ENV !== "production" ? requestOrigin : undefined);
  if (!base) throw new AuthError(401, "APP_URL must be configured for OIDC sign-in.");
  const allowedDomains = (process.env.OIDC_ALLOWED_EMAIL_DOMAINS ?? "runpod.io")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri: new URL("/api/auth/callback", base).toString(),
    allowedDomains,
  };
}

interface DiscoveryDoc {
  authorization_endpoint: string;
  token_endpoint: string;
}

const discoveryCache = new Map<string, { doc: DiscoveryDoc; fetchedAt: number }>();

export async function discover(issuer: string): Promise<DiscoveryDoc> {
  const cached = discoveryCache.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < 60 * 60 * 1000) return cached.doc;
  const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`OIDC discovery failed (${response.status}).`);
  const doc = (await response.json()) as Partial<DiscoveryDoc>;
  if (
    !doc.authorization_endpoint?.startsWith("https://") ||
    !doc.token_endpoint?.startsWith("https://")
  ) {
    throw new Error("OIDC discovery document is missing HTTPS endpoints.");
  }
  const valid = { authorization_endpoint: doc.authorization_endpoint, token_endpoint: doc.token_endpoint };
  discoveryCache.set(issuer, { doc: valid, fetchedAt: Date.now() });
  return valid;
}

export function newStateAndNonce(): { state: string; nonce: string; cookieValue: string } {
  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  return { state, nonce, cookieValue: `${state}.${nonce}` };
}

export function parseStateCookie(value: string | undefined): { state: string; nonce: string } | null {
  if (!value) return null;
  const [state, nonce] = value.split(".");
  return state && nonce ? { state, nonce } : null;
}

export function buildAuthorizationUrl(args: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  loginHintDomain?: string;
}): string {
  const url = new URL(args.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", args.state);
  url.searchParams.set("nonce", args.nonce);
  url.searchParams.set("prompt", "select_account");
  // Google-only workspace hint; other issuers ignore unknown params.
  if (args.loginHintDomain) url.searchParams.set("hd", args.loginHintDomain);
  return url.toString();
}

export async function exchangeCodeForIdToken(args: {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const response = await fetch(args.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: args.redirectUri,
      client_id: args.clientId,
      client_secret: args.clientSecret,
    }),
  });
  if (!response.ok) throw new AuthError(401, `OIDC code exchange failed (${response.status}).`);
  const payload = (await response.json()) as { id_token?: string };
  if (!payload.id_token) throw new AuthError(401, "OIDC token response did not include an id_token.");
  return payload.id_token;
}

export interface IdTokenClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  hd?: string;
}

export function decodeJwtPayload(jwt: string): IdTokenClaims {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new AuthError(401, "id_token is not a JWT.");
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as IdTokenClaims;
  } catch {
    throw new AuthError(401, "id_token payload could not be decoded.");
  }
}

/**
 * Strict claim validation. The token arrived directly from the issuer's token
 * endpoint over TLS on a confidential-client exchange, which authenticates its
 * origin; these checks bind it to this app, this login attempt, and the
 * allowed workspace.
 */
export function validateIdTokenClaims(
  claims: IdTokenClaims,
  expected: { issuer: string; clientId: string; nonce: string; allowedDomains: string[]; nowSeconds?: number },
): { email: string; name: string } {
  const now = expected.nowSeconds ?? Math.floor(Date.now() / 1000);
  const issuerHost = expected.issuer.replace(/^https:\/\//, "").replace(/\/$/, "");
  const issClean = (claims.iss ?? "").replace(/^https:\/\//, "").replace(/\/$/, "");
  if (issClean !== issuerHost) throw new AuthError(401, "id_token issuer mismatch.");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(expected.clientId)) throw new AuthError(401, "id_token audience mismatch.");
  if (typeof claims.exp !== "number" || claims.exp <= now) {
    throw new AuthError(401, "id_token is expired.");
  }
  if (!claims.nonce || !safeEqual(claims.nonce, expected.nonce)) {
    throw new AuthError(401, "id_token nonce mismatch.");
  }
  if (claims.email_verified === false || claims.email_verified === "false") {
    throw new AuthError(401, "Email address is not verified with the identity provider.");
  }
  const email = claims.email?.trim().toLowerCase() ?? "";
  const domain = email.split("@")[1] ?? "";
  if (!email || !domain) throw new AuthError(401, "id_token does not include an email.");
  if (expected.allowedDomains.length > 0 && !expected.allowedDomains.includes(domain)) {
    throw new AuthError(403, `Sign-in is restricted to: ${expected.allowedDomains.join(", ")}.`);
  }
  return { email, name: claims.name?.trim() || email };
}

// ------------------------------------------------------- session cookie

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new AuthError(401, "SESSION_SECRET (32+ chars) must be configured for OIDC sign-in.");
  }
  return secret;
}

function signSession(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function createSessionCookieValue(
  email: string,
  opts: { nowSeconds?: number; secret?: string } = {},
): string {
  const secret = opts.secret ?? sessionSecret();
  const expires = (opts.nowSeconds ?? Math.floor(Date.now() / 1000)) + SESSION_TTL_SECONDS;
  const body = `v1.${expires}.${Buffer.from(email.toLowerCase(), "utf8").toString("base64url")}`;
  return `${body}.${signSession(body, secret)}`;
}

export function verifySessionCookieValue(
  value: string | undefined,
  opts: { nowSeconds?: number; secret?: string } = {},
): string | null {
  if (!value) return null;
  const secret = opts.secret ?? sessionSecret();
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [version, expiresRaw, emailB64, signature] = parts;
  const body = `${version}.${expiresRaw}.${emailB64}`;
  if (!safeEqual(signature, signSession(body, secret))) return null;
  const expires = Number(expiresRaw);
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(expires) || expires <= now) return null;
  try {
    const email = Buffer.from(emailB64, "base64url").toString("utf8");
    return email.includes("@") ? email : null;
  } catch {
    return null;
  }
}
