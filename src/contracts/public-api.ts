import { z } from "zod";

export const initiativeInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  ownerId: z.string().trim().min(1).optional(),
  product: z.string().trim().max(160).nullish(),
  initiativeType: z.string().trim().max(80).nullish(),
  startDate: z.string().datetime().or(z.string().date()).nullish(),
  endDate: z.string().datetime().or(z.string().date()).nullish(),
  description: z.string().trim().max(2000).nullish(),
});

export const campaignInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  ownerId: z.string().trim().min(1).optional(),
  utmCampaign: z.string().trim().max(100).optional(),
  initiativeId: z.string().trim().nullish(),
  product: z.string().trim().max(160).nullish(),
  campaignType: z.string().trim().max(80).nullish(),
  startDate: z.string().datetime().or(z.string().date()).nullish(),
  endDate: z.string().datetime().or(z.string().date()).nullish(),
  description: z.string().trim().max(2000).nullish(),
  duplicateAction: z.enum(["override"]).nullish(),
  duplicateReason: z.string().trim().max(1000).nullish(),
});

export const campaignUpdateSchema = campaignInputSchema
  .omit({ utmCampaign: true, duplicateAction: true, duplicateReason: true })
  .partial()
  .extend({
    lifecycle: z.enum(["planned", "active", "completed", "archived"]).optional(),
    reason: z.string().trim().max(1000).nullish(),
  })
  .strict();

export const linkRequestSchema = z.object({
  destination: z.string().trim().min(1).max(4000),
  campaignId: z.string().trim().min(1),
  presetKey: z.string().trim().max(80).optional(),
  utmSource: z.string().trim().max(160).default(""),
  utmMedium: z.string().trim().max(160).default(""),
  utmContent: z.string().trim().max(300).nullish(),
  utmTerm: z.string().trim().max(300).nullish(),
  status: z.enum(["draft", "issued"]).optional(),
  duplicateAction: z.enum(["override"]).nullish(),
  duplicateReason: z.string().trim().max(1000).nullish(),
});

export const batchRequestSchema = z.object({
  source: z.enum(["grid", "paste", "csv"]).default("grid"),
  rows: z.array(linkRequestSchema.omit({ status: true })).min(1).max(200),
});

export const tokenCreateSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  scopes: z.array(z.string()).max(10).optional(),
  expiresInDays: z.number().int().min(1).max(90).optional(),
  clientType: z.enum(["mcp", "api"]).optional(),
});
