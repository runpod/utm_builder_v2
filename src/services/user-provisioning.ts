/**
 * Shared user resolution for sign-in providers.
 *
 * Every login path (Okta/OIDC, Google, POC) resolves the authenticated email to
 * a `users` row here. Provisioning is a policy decision made by the caller:
 * when enabled, a first-time sign-in creates a low-privilege `user` row
 * (audited); admin/investigator remain explicit promotions in /admin.
 * Deactivated accounts are never resurrected by signing in again.
 */
import { eq } from "drizzle-orm";
import { newId } from "@/core/ids";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { recordAudit } from "./audit";
import type { SessionUser } from "./auth";

export type ProvisionSource = "poc" | "oidc";

export interface ResolveUserInput {
  email: string; // already validated + lowercased by the caller
  displayName?: string | null;
  /** Create a `user` row when none exists. */
  provision: boolean;
  source: ProvisionSource;
  /** Extra audit context (e.g. issuer). Never include secrets. */
  context?: Record<string, unknown>;
}

export type ResolveUserResult =
  | { status: "active"; user: SessionUser; provisioned: boolean }
  | { status: "inactive"; user: null }
  | { status: "missing"; user: null };

export function defaultDisplayName(email: string): string {
  return email.split("@")[0].replace(/[._-]+/g, " ");
}

export async function findOrProvisionUser(db: Db, input: ResolveUserInput): Promise<ResolveUserResult> {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    if (!existing.active) return { status: "inactive", user: null };
    return {
      status: "active",
      provisioned: false,
      user: { id: existing.id, email: existing.email, name: existing.name, role: existing.role },
    };
  }
  if (!input.provision) return { status: "missing", user: null };

  const name = input.displayName?.trim() || defaultDisplayName(email);
  const [row] = await db
    .insert(users)
    .values({ id: newId("user"), email, name, role: "user", active: true })
    .returning();
  const user: SessionUser = { id: row.id, email: row.email, name: row.name, role: row.role };
  await recordAudit(db, user, {
    action: `auth.${input.source}_provisioned`,
    entityType: "user",
    entityId: row.id,
    after: { email: row.email, role: row.role },
    context: { mode: input.source, ...(input.context ?? {}) },
  });
  return { status: "active", provisioned: true, user };
}

/** True when Okta/OIDC first-time sign-ins should be auto-provisioned as `user`. */
export function oidcAutoProvisionEnabled(): boolean {
  return process.env.OIDC_AUTO_PROVISION === "true";
}
