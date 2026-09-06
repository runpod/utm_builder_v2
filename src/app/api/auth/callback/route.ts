import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { safeEqual } from "@/core/tokens";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { assertRateLimit, clientIp } from "@/server/rate-limit";
import { AuthError } from "@/services/auth";
import { recordAudit } from "@/services/audit";
import {
  createSessionCookieValue,
  decodeJwtPayload,
  discover,
  exchangeCodeForIdToken,
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

/** Complete the Google/OIDC sign-in flow. Unknown emails are rejected. */
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
    const { token_endpoint } = await discover(settings.issuer);
    const idToken = await exchangeCodeForIdToken({
      tokenEndpoint: token_endpoint,
      code,
      redirectUri: settings.redirectUri,
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
    });
    const { email } = validateIdTokenClaims(decodeJwtPayload(idToken), {
      issuer: settings.issuer,
      clientId: settings.clientId,
      nonce: stored.nonce,
      allowedDomains: settings.allowedDomains,
    });

    // No auto-provisioning: sign-in requires an existing active account.
    const db = await getDb();
    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!row?.active) return failure(origin, "no_account");

    const actor = { id: row.id, email: row.email, name: row.name, role: row.role };
    await recordAudit(db, actor, {
      action: "auth.signed_in",
      entityType: "user",
      entityId: row.id,
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
