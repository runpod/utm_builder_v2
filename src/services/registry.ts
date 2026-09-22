/**
 * Registry search and CSV export over issued campaigns and links.
 */
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { toCsv } from "@/core/csv";
import { idKindOf } from "@/core/ids";
import type { Db } from "@/db/client";
import { campaigns, initiatives, links, users } from "@/db/schema";

export interface RegistrySearch {
  q?: string; // free text across URL, destination, IDs, UTM fields
  campaignId?: string;
  initiativeId?: string;
  batchId?: string;
  status?: "draft" | "issued" | "retired";
  validationState?: string;
  platform?: string;
  createdBy?: string;
  utmSource?: string;
  utmMedium?: string;
  duplicateOverride?: boolean;
  createdAfter?: string;
  createdBefore?: string;
  page?: number;
  pageSize?: number;
}

export async function searchLinks(db: Db, params: RegistrySearch) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 25));

  const conditions: SQL[] = [];
  if (params.q?.trim()) {
    const q = params.q.trim();
    // Direct ID lookup (any rp*_ id) or free-text across the governed fields.
    if (idKindOf(q)) {
      conditions.push(
        or(
          eq(links.id, q),
          eq(links.campaignId, q),
          eq(links.initiativeId, q),
          eq(links.batchId, q),
          eq(links.utmId, q),
        )!,
      );
    } else {
      const like = `%${q}%`;
      conditions.push(
        or(
          ilike(links.finalUrl, like),
          ilike(links.destinationNormalized, like),
          ilike(links.utmCampaign, like),
          ilike(links.utmSource, like),
          ilike(links.utmMedium, like),
          ilike(links.utmContent, like),
          ilike(links.utmTerm, like),
        )!,
      );
    }
  }
  if (params.campaignId) conditions.push(eq(links.campaignId, params.campaignId));
  if (params.initiativeId) conditions.push(eq(links.initiativeId, params.initiativeId));
  if (params.batchId) conditions.push(eq(links.batchId, params.batchId));
  if (params.status) conditions.push(eq(links.status, params.status));
  if (params.validationState)
    conditions.push(eq(links.validationState, params.validationState as never));
  if (params.platform) conditions.push(eq(links.platformPresetKey, params.platform));
  if (params.createdBy) conditions.push(eq(links.createdBy, params.createdBy));
  if (params.utmSource) conditions.push(eq(links.utmSource, params.utmSource));
  if (params.utmMedium) conditions.push(eq(links.utmMedium, params.utmMedium));
  if (params.duplicateOverride !== undefined)
    conditions.push(eq(links.duplicateOverride, params.duplicateOverride));
  if (params.createdAfter)
    conditions.push(sql`${links.createdAt} >= ${new Date(params.createdAfter)}`);
  if (params.createdBefore)
    conditions.push(sql`${links.createdAt} <= ${new Date(params.createdBefore)}`);

  const where = conditions.length ? and(...conditions) : undefined;
  const rows = await db
    .select({
      link: links,
      campaignName: campaigns.name,
      initiativeName: initiatives.name,
      creatorName: users.name,
      creatorEmail: users.email,
    })
    .from(links)
    .leftJoin(campaigns, eq(links.campaignId, campaigns.id))
    .leftJoin(initiatives, eq(links.initiativeId, initiatives.id))
    .leftJoin(users, eq(links.createdBy, users.id))
    .where(where)
    .orderBy(desc(links.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(links)
    .where(where);

  return { rows, total: count, page, pageSize };
}

export const LINK_EXPORT_COLUMNS = [
  "link_id",
  "batch_id",
  "campaign_id",
  "campaign_name",
  "initiative_id",
  "status",
  "final_url",
  "destination",
  "utm_id",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "rp_link_id_param",
  "rp_initiative_id_param",
  "platform",
  "validation_state",
  "duplicate_override",
  "revision",
  "config_version",
  "created_by",
  "generated_by_name",
  "generated_by_email",
  "created_at",
];

export async function exportLinksCsv(db: Db, params: RegistrySearch): Promise<string> {
  const { rows } = await searchLinks(db, { ...params, page: 1, pageSize: 200 });
  const body = rows.map(({ link, campaignName, creatorName, creatorEmail }) => [
    link.id,
    link.batchId,
    link.campaignId,
    campaignName,
    link.initiativeId,
    link.status,
    link.finalUrl,
    link.destinationNormalized,
    link.utmId,
    link.utmSource,
    link.utmMedium,
    link.utmCampaign,
    link.utmContent,
    link.utmTerm,
    link.rpLinkIdParam,
    link.rpInitiativeIdParam,
    link.platformPresetKey,
    link.validationState,
    String(link.duplicateOverride),
    String(link.currentRevision),
    String(link.configVersion),
    link.createdBy,
    creatorName,
    creatorEmail,
    link.createdAt.toISOString(),
  ]);
  return toCsv([LINK_EXPORT_COLUMNS, ...body]);
}
