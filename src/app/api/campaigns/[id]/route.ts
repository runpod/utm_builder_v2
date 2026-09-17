import { campaignUpdateSchema } from "@/contracts/public-api";
import { getDb } from "@/db/client";
import { canManage, requireUser } from "@/services/auth";
import { campaignDetail, updateCampaign } from "@/services/campaigns";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    const { id } = await params;
    const db = await getDb();
    const detail = await campaignDetail(db, id);
    if (!detail) return json({ error: "Campaign not found." }, { status: 404 });
    return json({
      ...detail,
      permissions: {
        canManage: canManage(actor, {
          createdBy: detail.campaign.createdBy,
          ownerId: detail.campaign.ownerId,
        }),
        canTransferOwnership: actor.role === "admin",
      },
    });
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    const { id } = await params;
    const db = await getDb();
    const { reason, ...patch } = campaignUpdateSchema.parse(await req.json());
    const campaign = await updateCampaign(db, actor, id, patch, reason ?? null);
    return json({ campaign });
  });
}
