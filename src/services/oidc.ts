/**
 * OIDC login provider (authorization-code flow, confidential client).
 *
 * Issuer-agnostic: works with Okta (Runpod's SSO), Google Workspace, or any
 * OIDC IdP via OIDC_ISSUER/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET. The id_token is
 * received directly from the issuer's token endpoint over TLS (client
 * authenticated with the client secret) and its claims are strictly validated
 * (iss/aud/exp/nonce). Identity email comes from the id_token when present,
 * otherwise from the issuer's userinfo endpoint (Okta returns a "thin"
 * id_token in the code flow), and is then checked for verification and the
 * allowed domain. Sessions are short-lived HMAC-signed cookies; roles always
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

/** Google-specific authorize parameters are only sent to Google. */
export function isGoogleIssuer(issuer: string): boolean {
  return /(^|\/\/)accounts\.google\.com\/?$/.test(issuer.trim());
}

export function oidcSettings(requestOrigin?: string): OidcSettings {
  const issuer = process.env.OIDC_ISSUER?.trim() || "https://accounts.google.com";
  const clientId = process.env.OIDC_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID?.trim() || "";
  const clientSecret =
    process.env.OIDC_CLIENT_SECRET?.trim() || process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
  if (!clientId || !clientSecret) {
    throw new AuthError(401, "SSO sign-in is not configured (OIDC client ID/secret missing).");
  }
  // APP_URL is authoritative; the request origin is accepted only outside
  // production so local dev works without configuration.
  const base =
    process.env.APP_URL?.trim() ||
    (process.env.NODE_ENV !== "production" ? requestOrigin : undefined);
  if (!base) throw new AuthError(401, "APP_URL must be configured for SSO sign-in.");
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

export interface DiscoveryDoc {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
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
  const valid: DiscoveryDoc = {
    authorization_endpoint: doc.authorization_endpoint,
    token_endpoint: doc.token_endpoint,
    ...(doc.userinfo_endpoint?.startsWith("https://")
      ? { userinfo_endpoint: doc.userinfo_endpoint }
      : {}),
  };
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
  /** Issuer URL; Google-only parameters are added only for Google. */
  issuer?: string;
  loginHintDomain?: string;
}): string {
  const url = new URL(args.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", args.state);
  url.searchParams.set("nonce", args.nonce);
  // `prompt=select_account` and `hd` are Google extensions. Okta rejects
  // unknown prompt values, so neither is sent to other issuers.
  if (args.issuer === undefined || isGoogleIssuer(args.issuer)) {
    url.searchParams.set("prompt", "select_account");
    if (args.loginHintDomain) url.searchParams.set("hd", args.loginHintDomain);
  }
  return url.toString();
}

export interface TokenExchangeResult {
  idToken: string;
  accessToken: string | null;
}

/**
 * Authorization-code exchange using client_secret_basic (the default token
 * endpoint auth method for Okta web apps; Google accepts it too).
 */
export async function exchangeCode(args: {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<TokenExchangeResult> {
  const basic = Buffer.from(
    `${encodeURIComponent(args.clientId)}:${encodeURIComponent(args.clientSecret)}`,
    "utf8",
  ).toString("base64");
  const response = await fetch(args.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: args.redirectUri,
    }),
  });
  if (!response.ok) throw new AuthError(401, `OIDC code exchange failed (${response.status}).`);
  const payload = (await response.json()) as { id_token?: string; access_token?: string };
  if (!payload.id_token) throw new AuthError(401, "OIDC token response did not include an id_token.");
  return { idToken: payload.id_token, accessToken: payload.access_token ?? null };
}

/** Backward-compatible wrapper returning only the id_token. */
export async function exchangeCodeForIdToken(
  args: Parameters<typeof exchangeCode>[0],
): Promise<string> {
  return (await exchangeCode(args)).idToken;
}

export interface IdTokenClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nonce?: string;
  sub?: string;
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

/** Verified-email + allowed-domain policy, shared by id_token and userinfo paths. */
export function assertEmailAllowed(
  rawEmail: string | undefined,
  emailVerified: boolean | string | undefined,
  allowedDomains: string[],
): string {
  if (emailVerified === false || emailVerified === "false") {
    throw new AuthError(401, "Email address is not verified with the identity provider.");
  }
  const email = rawEmail?.trim().toLowerCase() ?? "";
  const domain = email.split("@")[1] ?? "";
  if (!email || !domain) throw new AuthError(401, "Identity provider did not supply an email.");
  if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
    throw new AuthError(403, `Sign-in is restricted to: ${allowedDomains.join(", ")}.`);
  }
  return email;
}

export interface ValidatedIdentity {
  /** Lowercased email, or null only when `allowMissingEmail` was set and the token had none. */
  email: string | null;
  name: string;
  sub: string | null;
}

/**
 * Strict claim validation. The token arrived directly from the issuer's token
 * endpoint over TLS on a confidential-client exchange, which authenticates its
 * origin; these checks bind it to this app, this login attempt, and the
 * allowed workspace. With `allowMissingEmail`, an id_token without an email
 * claim (Okta's thin token) passes and the caller resolves email via userinfo.
 */
export function validateIdTokenClaims(
  claims: IdTokenClaims,
  expected: {
    issuer: string;
    clientId: string;
    nonce: string;
    allowedDomains: string[];
    nowSeconds?: number;
    allowMissingEmail?: boolean;
  },
): ValidatedIdentity {
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
  const sub = claims.sub?.trim() || null;
  if (!claims.email?.trim() && expected.allowMissingEmail) {
    return { email: null, name: claims.name?.trim() || "", sub };
  }
  const email = assertEmailAllowed(claims.email, claims.email_verified, expected.allowedDomains);
  return { email, name: claims.name?.trim() || email, sub };
}

export interface UserInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
}

/** Fetch the issuer's userinfo (used when the id_token omits email). */
export async function fetchUserInfo(userinfoEndpoint: string, accessToken: string): Promise<UserInfo> {
  const response = await fetch(userinfoEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!response.ok) throw new AuthError(401, `OIDC userinfo request failed (${response.status}).`);
  return (await response.json()) as UserInfo;
}

// ------------------------------------------------------- session cookie

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new AuthError(401, "SESSION_SECRET (32+ chars) must be configured for SSO sign-in.");
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
