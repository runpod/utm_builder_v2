import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { handle, json } from "@/server/http";
import { assertRateLimit, clientIp } from "@/server/rate-limit";
import { pocAuthEnabled } from "@/services/auth";
import { recordAudit } from "@/services/audit";
import { pocSignIn } from "@/services/poc-login";
import { createSessionCookieValue, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/services/oidc";

export const dynamic = "force-dynamic";

/** POC-only email sign-in; disabled unless AUTH_PROVIDER=poc. */
export async function POST(req: Request) {
  return handle(async () => {
    if (!pocAuthEnabled()) {
      return json({ error: "POC sign-in is not enabled." }, { status: 400 });
    }
    assertRateLimit(`poc-login:${clientIp(req)}`, 20);
    const { email } = (await req.json()) as { email?: string };
    if (!email) return json({ error: "email is required" }, { status: 400 });

    const db = await getDb();
    const actor = await pocSignIn(db, email);
    await recordAudit(db, actor, {
      action: "auth.signed_in",
      entityType: "user",
      entityId: actor.id,
      context: { mode: "poc" },
    });

    const jar = await cookies();
    jar.set(SESSION_COOKIE, createSessionCookieValue(actor.email), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return json({ ok: true, email: actor.email, role: actor.role });
  });
}
