import { campaignInputSchema } from "@/contracts/public-api";
import { getDb } from "@/db/client";
import { requireUser } from "@/services/auth";
import {
  createCampaign,
  listCampaignPickerGroups,
  listCampaigns,
  searchCampaigns,
} from "@/services/campaigns";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const actor = await requireUser();
    const db = await getDb();
    const url = new URL(req.url);
    const query = url.searchParams.get("q")?.trim();
    if (query) return json({ campaigns: await searchCampaigns(db, query) });
    if (url.searchParams.get("view") === "picker") {
      const initiativeId = url.searchParams.get("initiativeId")?.trim() || undefined;
      return json({ groups: await listCampaignPickerGroups(db, actor, initiativeId) });
    }
    return json({ campaigns: await listCampaigns(db) });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireUser();
    const db = await getDb();
    const input = campaignInputSchema.parse(await req.json());
    const campaign = await createCampaign(db, actor, input);
    return json({ campaign }, { status: 201 });
  });
}
