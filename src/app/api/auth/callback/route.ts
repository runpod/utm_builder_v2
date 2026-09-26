import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeEqual } from "@/core/tokens";
import { getDb } from "@/db/client";
import { assertRateLimit, clientIp } from "@/server/rate-limit";
import { AuthError } from "@/services/auth";
import { recordAudit } from "@/services/audit";
import { findOrProvisionUser, oidcAutoProvisionEnabled } from "@/services/user-provisioning";
import {
  assertEmailAllowed,
  createSessionCookieValue,
  decodeJwtPayload,
  discover,
  exchangeCode,
  fetchUserInfo,
  OIDC_STATE_COOKIE,
  oidcSettings,
  parseStateCookie,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  validateIdTokenClaims,
} from "@/services/oidc";

export const dynamic = "force-dynamic";

function failure(origin: string, code: string): NextResponse {
  // Redirect with a coarse error code only — no IdP payloads or emails.
  return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(code)}`, origin));
}

/** Complete the Okta/Google/OIDC sign-in flow. Unknown emails are rejected. */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const jar = await cookies();
  try {
    const provider = process.env.AUTH_PROVIDER ?? "dev";
    if (provider !== "google" && provider !== "oidc") return failure(origin, "disabled");
    assertRateLimit(`oidc-callback:${clientIp(req)}`, 30);

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const stored = parseStateCookie(jar.get(OIDC_STATE_COOKIE)?.value);
    jar.delete(OIDC_STATE_COOKIE);
    if (!code || !state || !stored || !safeEqual(state, stored.state)) {
      return failure(origin, "state_mismatch");
    }

    const settings = oidcSettings(origin);
    const discovery = await discover(settings.issuer);
    const { idToken, accessToken } = await exchangeCode({
      tokenEndpoint: discovery.token_endpoint,
      code,
      redirectUri: settings.redirectUri,
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
    });
    const identity = validateIdTokenClaims(decodeJwtPayload(idToken), {
      issuer: settings.issuer,
      clientId: settings.clientId,
      nonce: stored.nonce,
      allowedDomains: settings.allowedDomains,
      allowMissingEmail: true,
    });

    // Okta's code-flow id_token is "thin" and may omit email; resolve it from
    // userinfo, bound to the same subject the id_token authenticated.
    let email = identity.email;
    let userInfoName: string | null = null;
    if (!email) {
      if (!discovery.userinfo_endpoint || !accessToken) {
        throw new AuthError(401, "Identity provider did not supply an email.");
      }
      const info = await fetchUserInfo(discovery.userinfo_endpoint, accessToken);
      if (!identity.sub || !info.sub || !safeEqual(info.sub, identity.sub)) {
        throw new AuthError(401, "userinfo subject does not match the id_token.");
      }
      email = assertEmailAllowed(info.email, info.email_verified, settings.allowedDomains);
      userInfoName = info.name?.trim() || null;
    }

    // Resolve the account. With OIDC_AUTO_PROVISION=true (policy: the IdP's app
    // assignment is the access gate), first-time sign-ins are created as `user`;
    // otherwise an existing active row is required. Deactivated accounts never
    // sign back in.
    const db = await getDb();
    const resolved = await findOrProvisionUser(db, {
      email,
      displayName: identity.name || userInfoName,
      provision: oidcAutoProvisionEnabled(),
      source: "oidc",
      context: { issuer: settings.issuer },
    });
    if (resolved.status !== "active") return failure(origin, "no_account");
    const actor = resolved.user;
    await recordAudit(db, actor, {
      action: "auth.signed_in",
      entityType: "user",
      entityId: actor.id,
      context: { provider: settings.issuer },
    });

    const response = NextResponse.redirect(new URL("/", origin));
    response.cookies.set(SESSION_COOKIE, createSessionCookieValue(email), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return response;
  } catch (err) {
    if (err instanceof AuthError && err.status === 403) return failure(origin, "domain_not_allowed");
    console.error(
      JSON.stringify({
        event: "oidc.callback_error",
        name: err instanceof Error ? err.name : typeof err,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return failure(origin, "signin_failed");
  }
}
