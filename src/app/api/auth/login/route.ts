import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { handle } from "@/server/http";
import { assertRateLimit, clientIp } from "@/server/rate-limit";
import {
  buildAuthorizationUrl,
  discover,
  newStateAndNonce,
  OIDC_STATE_COOKIE,
  oidcSettings,
} from "@/services/oidc";

export const dynamic = "force-dynamic";

/** Start the Google/OIDC sign-in flow. */
export async function GET(req: Request) {
  return handle(async () => {
    const provider = process.env.AUTH_PROVIDER ?? "dev";
    if (provider !== "google" && provider !== "oidc") {
      return NextResponse.json(
        { error: "OIDC sign-in is not enabled. Set AUTH_PROVIDER=google." },
        { status: 400 },
      );
    }
    assertRateLimit(`oidc-login:${clientIp(req)}`, 30);
    const settings = oidcSettings(new URL(req.url).origin);
    const { authorization_endpoint } = await discover(settings.issuer);
    const { state, nonce, cookieValue } = newStateAndNonce();
    const redirect = NextResponse.redirect(
      buildAuthorizationUrl({
        authorizationEndpoint: authorization_endpoint,
        clientId: settings.clientId,
        redirectUri: settings.redirectUri,
        state,
        nonce,
        loginHintDomain: settings.allowedDomains[0],
      }),
    );
    const jar = await cookies();
    jar.set(OIDC_STATE_COOKIE, cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth",
      maxAge: 600,
    });
    return redirect;
  });
}
