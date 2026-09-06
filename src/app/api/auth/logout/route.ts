import { cookies } from "next/headers";
import { handle, json } from "@/server/http";
import { SESSION_COOKIE } from "@/services/oidc";

export const dynamic = "force-dynamic";

export async function POST() {
  return handle(async () => {
    const jar = await cookies();
    jar.delete(SESSION_COOKIE);
    return json({ ok: true });
  });
}
