/**
 * Proof-of-concept email sign-in.
 *
 * ONLY active when AUTH_PROVIDER=poc. Lets an invited colleague sign in by
 * typing their work email — no external IdP — so a gated POC deployment can be
 * exercised by several people who each get their own audited identity. This is
 * deliberately not production auth: access must be gated at the platform layer
 * (Vercel Deployment Protection / invited members). Swapping AUTH_PROVIDER to
 * "oidc"/"google" disables this path entirely with no other change.
 */
import type { Db } from "@/db/client";
import { AuthError, pocAuthEnabled, type SessionUser } from "./auth";
import { findOrProvisionUser } from "./user-provisioning";

function allowedDomains(): string[] {
  return (process.env.OIDC_ALLOWED_EMAIL_DOMAINS ?? "runpod.io")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Resolve (or, for the POC, provision) the user for an email sign-in.
 * First-time colleagues are created with the low-privilege "user" role so they
 * can try the tool; an administrator promotes anyone who needs more in /admin.
 */
export async function pocSignIn(db: Db, rawEmail: string): Promise<SessionUser> {
  if (!pocAuthEnabled()) throw new AuthError(401, "POC sign-in is not enabled.");
  const email = rawEmail.trim().toLowerCase();
  const domain = email.split("@")[1] ?? "";
  if (!email.includes("@") || !domain) throw new AuthError(401, "Enter a valid work email.");
  const domains = allowedDomains();
  if (domains.length > 0 && !domains.includes(domain)) {
    throw new AuthError(403, `POC sign-in is restricted to: ${domains.join(", ")}.`);
  }

  const result = await findOrProvisionUser(db, { email, provision: true, source: "poc" });
  if (result.status === "inactive") throw new AuthError(403, "This account is deactivated.");
  if (result.status !== "active") throw new AuthError(401, "Unable to resolve account.");
  return result.user;
}
