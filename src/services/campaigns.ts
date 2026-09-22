/**
 * Campaigns: the canonical reporting unit. rpc_<ULID> is generated once at
 * creation, carried publicly in utm_id, and never changes on rename/edit.
 * Campaigns are created only explicitly — never implicitly from a typed name.
 */
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { isValidId, newId } from "@/core/ids";
import { canonicalUtmValue, looseUtmValue } from "@/core/url";
import type { Db } from "@/db/client";
import { campaigns, externalCampaignMappings, initiatives } from "@/db/schema";
import { prefixedUlid } from "@/core/ids";
import { recordAudit } from "./audit";
import { assertCanManage, assertCanWrite, type SessionUser } from "./auth";
import { enqueueOutboxEvent } from "./outbox";
import { resolveRecordOwner } from "./users";

export interface CampaignInput {
  name: string;
  ownerId?: string;
  utmCampaign?: string; // defaults to canonicalized name
  initiativeId?: string | null;
  product?: string | null;
  campaignType?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
  duplicateAction?: "override" | null;
  duplicateReason?: string | null;
}

export interface CampaignDuplicateCandidate {
  id: string;
  name: string;
  utmCampaign: string;
  initiativeId: string | null;
  lifecycle: "planned" | "active" | "completed" | "archived";
}

export class CampaignDuplicateError extends Error {
  constructor(public readonly candidates: CampaignDuplicateCandidate[]) {
    super("A semantically equivalent campaign already exists. Reuse it or have an administrator record a justified override.");
    this.name = "CampaignDuplicateError";
  }
}

function semanticCampaignKey(value: string): string {
  return looseUtmValue(value).replace(/-/g, "");
}

/** Deterministic, deliberately conservative check for punctuation/spacing variants. */
export async function findCampaignDuplicates(db: Db, input: Pick<CampaignInput, "name" | "utmCampaign">) {
  const requestedKeys = new Set([
    semanticCampaignKey(input.name),
    semanticCampaignKey(input.utmCampaign?.trim() || input.name),
  ]);
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      utmCampaign: campaigns.utmCampaign,
      initiativeId: campaigns.initiativeId,
      lifecycle: campaigns.lifecycle,
    })
    .from(campaigns);
  return rows.filter((row) =>
    row.lifecycle !== "archived" &&
    (requestedKeys.has(semanticCampaignKey(row.name)) ||
      requestedKeys.has(semanticCampaignKey(row.utmCampaign))),
  );
}

export async function createCampaign(db: Db, actor: SessionUser, input: CampaignInput) {
  assertCanWrite(actor);
  const name = input.name?.trim();
  if (!name) throw new Error("Campaign name is required.");
  const utmCampaign = canonicalUtmValue(input.utmCampaign?.trim() || name);
  const ownerId = await resolveRecordOwner(db, actor, input.ownerId);
  const duplicateCandidates = await findCampaignDuplicates(db, { name, utmCampaign });
  if (duplicateCandidates.length > 0 && input.duplicateAction !== "override") {
    throw new CampaignDuplicateError(duplicateCandidates);
  }
  const duplicateReason = input.duplicateReason?.trim() || null;
  if (input.duplicateAction === "override") {
    if (duplicateCandidates.length === 0) {
      throw new Error("A campaign duplicate override may only be used when a duplicate candidate exists.");
    }
    if (actor.role !== "admin") throw new Error("Only an administrator may override a campaign duplicate warning.");
    if (!duplicateReason) throw new Error("A reason is required to override a campaign duplicate warning.");
  }
  if (input.initiativeId) {
    if (!isValidId("initiative", input.initiativeId)) throw new Error("Invalid initiative ID.");
    const found = await db
      .select({ id: initiatives.id })
      .from(initiatives)
      .where(eq(initiatives.id, input.initiativeId));
    if (found.length === 0) throw new Error("Initiative not found.");
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(campaigns)
      .values({
        id: newId("campaign"),
        name,
        utmCampaign,
        initiativeId: input.initiativeId ?? null,
        ownerId,
        product: input.product ?? null,
        campaignType: input.campaignType ?? null,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        description: input.description ?? null,
        createdBy: actor.id,
      })
      .returning();

    // External mapping shells + async sync via the outbox. A HubSpot outage
    // cannot roll back this transaction's registry writes — sync is queued.
    const [mapping] = await tx
      .insert(externalCampaignMappings)
      .values({
        id: prefixedUlid("map"),
        campaignId: row.id,
        system: "hubspot",
        externalType: "campaign",
        syncState: "pending",
      })
      .returning();
    await enqueueOutboxEvent(tx, {
      type: "hubspot.campaign.sync",
      payload: { campaignId: row.id, mappingId: mapping.id, name: row.name },
      idempotencyKey: `hubspot.campaign.sync:${row.id}`,
    });
    await enqueueOutboxEvent(tx, {
      type: "warehouse.snapshot.campaign",
      payload: { campaignId: row.id },
      idempotencyKey: `warehouse.snapshot.campaign:${row.id}:v1`,
    });

    await recordAudit(tx, actor, {
      action: "campaign.created",
      entityType: "campaign",
      entityId: row.id,
      after: row,
    });
    if (duplicateCandidates.length > 0) {
      await recordAudit(tx, actor, {
        action: "campaign.duplicate_override",
        entityType: "campaign",
        entityId: row.id,
        after: row,
        reason: duplicateReason,
        context: { candidateIds: duplicateCandidates.map((candidate) => candidate.id) },
      });
    }
    return row;
  });
}

export async function updateCampaign(
  db: Db,
  actor: SessionUser,
  id: string,
  patch: Partial<Omit<CampaignInput, "utmCampaign" | "duplicateAction" | "duplicateReason">> & {
    lifecycle?: "planned" | "active" | "completed" | "archived";
  },
  reason: string | null,
) {
  if (!isValidId("campaign", id)) throw new Error("Invalid campaign ID.");
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(campaigns).where(eq(campaigns.id, id));
    const before = existing[0];
    if (!before) throw new Error("Campaign not found.");
    assertCanManage(actor, { createdBy: before.createdBy, ownerId: before.ownerId }, "campaign");
    const ownerId = patch.ownerId !== undefined
      ? await resolveRecordOwner(tx as Db, actor, patch.ownerId, before.ownerId ?? before.createdBy)
      : before.ownerId;
    const initiativeId = patch.initiativeId !== undefined
      ? patch.initiativeId?.trim() || null
      : before.initiativeId;
    const initiativeChanged = initiativeId !== before.initiativeId;
    if (initiativeId) {
      if (!isValidId("initiative", initiativeId)) throw new Error("Invalid initiative ID.");
      const target = await tx
        .select({ id: initiatives.id })
        .from(initiatives)
        .where(eq(initiatives.id, initiativeId));
      if (target.length === 0) throw new Error("Initiative not found.");
    }
    if (ownerId !== before.ownerId && !reason?.trim()) {
      throw new Error("A reason is required to transfer campaign ownership.");
    }
    if (initiativeChanged && !reason?.trim()) {
      throw new Error("A reason is required to change a campaign's initiative assignment.");
    }
    // The canonical ID and utm_campaign slug are immutable after creation;
    // metadata (name, owner, dates, lifecycle) may change freely.
    const [row] = await tx
      .update(campaigns)
      .set({
        name: patch.name?.trim() || before.name,
        initiativeId,
        ownerId,
        product: patch.product !== undefined ? patch.product : before.product,
        campaignType: patch.campaignType !== undefined ? patch.campaignType : before.campaignType,
        startDate: patch.startDate !== undefined ? (patch.startDate ? new Date(patch.startDate) : null) : before.startDate,
        endDate: patch.endDate !== undefined ? (patch.endDate ? new Date(patch.endDate) : null) : before.endDate,
        description: patch.description !== undefined ? patch.description : before.description,
        lifecycle: patch.lifecycle ?? before.lifecycle,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, id))
      .returning();
    await enqueueOutboxEvent(tx, {
      type: "warehouse.snapshot.campaign",
      payload: { campaignId: row.id },
      idempotencyKey: `warehouse.snapshot.campaign:${row.id}:${row.updatedAt.toISOString()}`,
    });
    await recordAudit(tx, actor, {
      action: ownerId !== before.ownerId
        ? "campaign.owner_transferred"
        : initiativeChanged
          ? "campaign.initiative_reassigned"
          : "campaign.updated",
      entityType: "campaign",
      entityId: id,
      before,
      after: row,
      reason,
    });
    return row;
  });
}

export async function listCampaigns(db: Db) {
  return db.select().from(campaigns).orderBy(asc(campaigns.name));
}

export interface CampaignPickerGroups {
  recent: (typeof campaigns.$inferSelect)[];
  mine: (typeof campaigns.$inferSelect)[];
  initiative: (typeof campaigns.$inferSelect)[];
}

/**
 * Small, useful default sets for campaign pickers. Completed and archived
 * campaigns stay out of the default view but remain available through search.
 */
export async function listCampaignPickerGroups(
  db: Db,
  actor: SessionUser,
  initiativeId?: string,
): Promise<CampaignPickerGroups> {
  const currentLifecycle = or(eq(campaigns.lifecycle, "planned"), eq(campaigns.lifecycle, "active"))!;
  const [recent, mine, initiative] = await Promise.all([
    db
      .select()
      .from(campaigns)
      .where(currentLifecycle)
      .orderBy(desc(campaigns.updatedAt))
      .limit(8),
    db
      .select()
      .from(campaigns)
      .where(and(currentLifecycle, eq(campaigns.ownerId, actor.id)))
      .orderBy(asc(campaigns.name))
      .limit(20),
    initiativeId
      ? db
          .select()
          .from(campaigns)
          .where(and(currentLifecycle, eq(campaigns.initiativeId, initiativeId)))
          .orderBy(asc(campaigns.name))
          .limit(20)
      : Promise.resolve([]),
  ]);
  return { recent, mine, initiative };
}

/** Global, bounded fallback search, including completed/archived records. */
export async function searchCampaigns(db: Db, query: string) {
  const q = query.trim();
  if (!q) return [];
  const like = `%${q}%`;
  return db
    .select()
    .from(campaigns)
    .where(
      or(
        ilike(campaigns.id, like),
        ilike(campaigns.name, like),
        ilike(campaigns.utmCampaign, like),
      ),
    )
    .orderBy(desc(campaigns.updatedAt))
    .limit(20);
}

export async function campaignDetail(db: Db, id: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!campaign) return null;
  const mappings = await db
    .select()
    .from(externalCampaignMappings)
    .where(eq(externalCampaignMappings.campaignId, id));
  return { campaign, mappings };
}
