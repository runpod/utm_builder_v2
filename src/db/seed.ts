/**
 * Idempotent seed: initial taxonomy, platform presets, destination policy,
 * app settings, config version, and local-development identities.
 *
 * Everything seeded here is editable in /admin afterwards — none of it is
 * hard-coded into UI or generation logic.
 */
import { newId, prefixedUlid } from "@/core/ids";
import type { Db } from "./client";
import {
  appSettings,
  configVersions,
  destinationPolicies,
  gtmBulkTemplates,
  gtmCatalogRecords,
  platformPresets,
  taxonomyMediums,
  taxonomySources,
  users,
} from "./schema";

const TAXONOMY: Record<string, string[]> = {
  paid: [
    "google-ads",
    "bing-ads",
    "linkedin-paid",
    "twitter-paid",
    "reddit-paid",
    "facebook-paid",
    "google-display",
    "programmatic",
    "partner-sponsored",
  ],
  organic: [
    "linkedin-organic",
    "twitter-organic",
    "reddit-organic",
    "github",
    "blog",
    "youtube",
    "documentation",
  ],
  email: ["hubspot-email", "transactional-email", "sales-email", "product-email"],
  referral: [
    "hackernews",
    "producthunt",
    "discord-community",
    "techcrunch",
    "venturebeat",
    "medium",
    "partner-referral",
    "integration",
  ],
  event: ["conference", "webinar", "virtual-conference", "hackathon"],
  program: ["nvidia-startup-program", "microsoft-startups", "aws-activate", "yc-startup-school"],
  product: ["console-banner", "dashboard-widget", "usage-threshold"],
  support: ["support-portal", "intercom-bot"],
};

// Aliases preserved for known rename churn (notably Meta/Facebook/Instagram).
const SOURCE_ALIASES: Record<string, string[]> = {
  "facebook-paid": ["meta-paid", "instagram-paid", "fb-paid", "meta"],
  "twitter-paid": ["x-paid"],
  "twitter-organic": ["x-organic"],
};

interface PresetSeed {
  key: string;
  name: string;
  outputType: string;
  defaults: Record<string, string>;
  supportedMacros: string[];
  requiredFields: string[];
  verificationState: "draft" | "verified";
  docsUrl: string | null;
}

const PRESETS: PresetSeed[] = [
  {
    key: "generic",
    name: "Generic URL",
    outputType: "url",
    defaults: {},
    supportedMacros: [],
    requiredFields: [],
    verificationState: "verified",
    docsUrl: null,
  },
  {
    key: "google_ads",
    name: "Google Ads",
    outputType: "url",
    defaults: { utm_medium: "paid", utm_source: "google-ads" },
    supportedMacros: ["keyword", "creative", "matchtype", "device", "adgroupid", "campaignid", "gclid"],
    requiredFields: ["utm_content"],
    verificationState: "draft",
    docsUrl: "https://support.google.com/google-ads/answer/6305348",
  },
  {
    key: "linkedin",
    name: "LinkedIn Ads",
    outputType: "url",
    defaults: { utm_medium: "paid", utm_source: "linkedin-paid" },
    supportedMacros: [],
    requiredFields: ["utm_content"],
    verificationState: "draft",
    docsUrl: "https://www.linkedin.com/help/lms/answer/a418880",
  },
  {
    key: "x_organic",
    name: "X (Twitter) — Organic",
    outputType: "url",
    defaults: { utm_medium: "organic", utm_source: "twitter-organic" },
    supportedMacros: [],
    requiredFields: [],
    verificationState: "draft",
    docsUrl: null,
  },
  {
    key: "x_paid",
    name: "X (Twitter) Ads",
    outputType: "url",
    defaults: { utm_medium: "paid", utm_source: "twitter-paid" },
    supportedMacros: [],
    requiredFields: ["utm_content"],
    verificationState: "draft",
    docsUrl: "https://business.x.com/en/help/campaign-measurement-and-analytics",
  },
  {
    key: "meta",
    name: "Meta Ads",
    outputType: "url",
    defaults: { utm_medium: "paid", utm_source: "facebook-paid" },
    supportedMacros: ["ad.id", "adset.id", "campaign.id", "ad.name", "adset.name", "campaign.name", "placement", "site_source_name"],
    requiredFields: ["utm_content"],
    verificationState: "draft",
    docsUrl: "https://www.facebook.com/business/help/2360940870872492",
  },
  {
    key: "reddit",
    name: "Reddit Ads",
    outputType: "url",
    defaults: { utm_medium: "paid", utm_source: "reddit-paid" },
    supportedMacros: [],
    requiredFields: [],
    verificationState: "draft",
    docsUrl: "https://business.reddithelp.com/",
  },
  {
    key: "cm360",
    name: "Campaign Manager 360",
    outputType: "tracking_template",
    defaults: { utm_medium: "paid", utm_source: "programmatic" },
    supportedMacros: ["%epid!", "%esid!", "%ecid!", "%eaid!", "%ebuy!"],
    requiredFields: [],
    verificationState: "draft",
    docsUrl: "https://support.google.com/campaignmanager/",
  },
  {
    key: "hubspot_email",
    name: "HubSpot / Email",
    outputType: "email_link",
    defaults: { utm_medium: "email", utm_source: "hubspot-email" },
    supportedMacros: [],
    requiredFields: ["utm_content"],
    verificationState: "draft",
    docsUrl: "https://knowledge.hubspot.com/",
  },
  {
    key: "event_qr",
    name: "Event / QR code",
    outputType: "qr_target",
    defaults: { utm_medium: "event" },
    supportedMacros: [],
    requiredFields: [],
    verificationState: "verified",
    docsUrl: null,
  },
];

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  // Administrator-controlled public inclusion of generated identifiers.
  public_param_policy: { rp_link_id: true, rp_initiative_id: false },
  bulk_limit: 200,
  required_fields: [], // extra required link fields, e.g. ["utm_content"]
  duplicate_override_roles: ["admin"],
  recommended_max_url_length: 900,
  feature_flags: {},
};

const GTM_DICTIONARY_SEED = [
  {
    recordType: "data_field" as const,
    key: "utm_id",
    name: "utm_id",
    summary: "Immutable Runpod campaign identifier (rpc_ ULID) exposed on governed campaign URLs.",
    attributes: { dataType: "string", example: "rpc_01J…", authority: "UTM registry", groupingLevel: "campaign" },
  },
  {
    recordType: "data_field" as const,
    key: "utm_campaign",
    name: "utm_campaign",
    summary: "Human-readable canonical campaign slug used for interpretation and convenient filtering.",
    attributes: { dataType: "string", authority: "UTM registry", groupingLevel: "campaign" },
  },
  {
    recordType: "data_field" as const,
    key: "utm_source",
    name: "utm_source",
    summary: "Governed traffic-source value selected from the active UTM taxonomy.",
    attributes: { dataType: "string", authority: "UTM taxonomy", groupingLevel: "source" },
  },
  {
    recordType: "data_field" as const,
    key: "utm_medium",
    name: "utm_medium",
    summary: "Governed channel classification associated with a source in the active UTM taxonomy.",
    attributes: { dataType: "string", authority: "UTM taxonomy", groupingLevel: "channel" },
  },
  {
    recordType: "data_field" as const,
    key: "rp_link_id",
    name: "rp_link_id",
    summary: "Immutable Runpod identifier for one issued destination-plus-UTM combination.",
    attributes: { dataType: "string", example: "rpl_01J…", authority: "UTM registry", groupingLevel: "link" },
  },
  {
    recordType: "data_field" as const,
    key: "rp_initiative_id",
    name: "rp_initiative_id",
    summary: "Optional immutable identifier grouping campaigns under a launch or broader GTM motion.",
    attributes: { dataType: "string", example: "rpi_01J…", authority: "UTM registry", groupingLevel: "initiative" },
  },
];

const GTM_BULK_TEMPLATE_SEED = [
  {
    key: "runpod_change_review",
    name: "Runpod governed mass-change review",
    platformKey: "runpod",
    objectType: "catalog_record",
    operation: "review_update",
    columns: [
      { key: "record_key", label: "Record key", required: true },
      { key: "action", label: "Action", required: true, allowedValues: ["create", "update", "deactivate"] },
      { key: "field", label: "Field", required: true },
      { key: "current_value", label: "Current value" },
      { key: "proposed_value", label: "Proposed value", required: true },
      { key: "reason", label: "Reason", required: true },
    ],
    examples: [{ record_key: "google_ads", action: "update", field: "owner", current_value: "", proposed_value: "growth_marketing", reason: "Operating model update" }],
    maxRows: 5000,
    verificationState: "verified" as const,
    availabilityNotes: "Internal review format; imports should create proposals rather than bypassing approval.",
    docsUrl: null,
  },
  {
    key: "google_ads_editor_url_updates",
    name: "Google Ads Editor URL updates",
    platformKey: "google_ads",
    objectType: "ad",
    operation: "update_urls",
    columns: [
      { key: "campaign", label: "Campaign", required: true },
      { key: "ad_group", label: "Ad group", required: true },
      { key: "final_url", label: "Final URL", required: true },
      { key: "tracking_template", label: "Tracking template" },
      { key: "custom_parameter", label: "Custom parameter" },
    ],
    examples: [],
    maxRows: 10000,
    verificationState: "draft" as const,
    availabilityNotes: "Generate, then import and review as proposed changes in Google Ads Editor. Confirm headers against the current account export before use.",
    docsUrl: "https://support.google.com/google-ads/editor/answer/30564?hl=en",
  },
  {
    key: "linkedin_campaign_manager_url_updates",
    name: "LinkedIn Campaign Manager bulk URL updates",
    platformKey: "linkedin_ads",
    objectType: "creative",
    operation: "update_urls",
    columns: [
      { key: "campaign_group_id", label: "Campaign Group ID", required: true },
      { key: "campaign_id", label: "Campaign ID", required: true },
      { key: "creative_id", label: "Creative ID", required: true },
      { key: "destination_url", label: "Destination URL", required: true },
    ],
    examples: [],
    maxRows: 5000,
    verificationState: "draft" as const,
    availabilityNotes: "LinkedIn bulk CSV functionality is limited to eligible managed accounts; begin from an account export.",
    docsUrl: "https://www.linkedin.com/help/lms/answer/a497878",
  },
  {
    key: "cm360_campaign_spreadsheet_urls",
    name: "Campaign Manager 360 spreadsheet URL updates",
    platformKey: "cm360",
    objectType: "placement_or_ad",
    operation: "update_urls",
    columns: [
      { key: "campaign_id", label: "Campaign ID", required: true },
      { key: "placement_id", label: "Placement ID" },
      { key: "ad_id", label: "Ad ID" },
      { key: "landing_page_url", label: "Landing Page URL", required: true },
    ],
    examples: [],
    maxRows: 10000,
    verificationState: "draft" as const,
    availabilityNotes: "Use a current CM360 campaign spreadsheet as the authoritative column topology.",
    docsUrl: "https://support.google.com/campaignmanager/answer/2704625?hl=en",
  },
  {
    key: "hubspot_campaign_record_updates",
    name: "HubSpot campaign record updates",
    platformKey: "hubspot",
    objectType: "campaign_record",
    operation: "update_records",
    columns: [
      { key: "record_id", label: "Record ID", required: true },
      { key: "campaign_name", label: "Campaign name" },
      { key: "campaign_status", label: "Campaign status" },
      { key: "start_date", label: "Start date" },
      { key: "end_date", label: "End date" },
    ],
    examples: [],
    maxRows: 10000,
    verificationState: "draft" as const,
    availabilityNotes: "Use HubSpot's unique record ID to update rather than accidentally create a duplicate record.",
    docsUrl: "https://knowledge.hubspot.com/import-and-export/import-records-for-a-single-object",
  },
  {
    key: "meta_ads_url_change_plan",
    name: "Meta Ads URL change plan",
    platformKey: "meta_ads",
    objectType: "ad",
    operation: "update_urls",
    columns: [
      { key: "campaign_id", label: "Campaign ID", required: true },
      { key: "ad_set_id", label: "Ad set ID", required: true },
      { key: "ad_id", label: "Ad ID", required: true },
      { key: "website_url", label: "Website URL", required: true },
      { key: "url_parameters", label: "URL parameters" },
    ],
    examples: [],
    maxRows: 5000,
    verificationState: "draft" as const,
    availabilityNotes: "Planning/validation format only until Runpod confirms the current supported Meta import workflow and headers.",
    docsUrl: null,
  },
  {
    key: "reddit_ads_url_change_plan",
    name: "Reddit Ads URL change plan",
    platformKey: "reddit_ads",
    objectType: "ad",
    operation: "update_urls",
    columns: [
      { key: "campaign_id", label: "Campaign ID", required: true },
      { key: "ad_group_id", label: "Ad group ID", required: true },
      { key: "ad_id", label: "Ad ID", required: true },
      { key: "destination_url", label: "Destination URL", required: true },
    ],
    examples: [],
    maxRows: 5000,
    verificationState: "draft" as const,
    availabilityNotes: "Planning/validation format only until Runpod confirms a supported Reddit Ads bulk-import workflow and current headers.",
    docsUrl: null,
  },
];

async function ensureGtmSeed(db: Db): Promise<void> {
  await db.insert(gtmCatalogRecords).values(
    GTM_DICTIONARY_SEED.map((record) => ({
      id: prefixedUlid("gdr"),
      ...record,
      verificationState: "verified" as const,
      lastVerifiedAt: new Date(),
      createdBy: "system",
      updatedBy: "system",
    })),
  ).onConflictDoNothing();
  await db.insert(gtmBulkTemplates).values(
    GTM_BULK_TEMPLATE_SEED.map((template) => ({
      id: prefixedUlid("gbt"),
      format: "csv" as const,
      defaults: {},
      validations: {},
      lifecycle: "active" as const,
      createdBy: "system",
      updatedBy: "system",
      ...template,
    })),
  ).onConflictDoNothing();
}

export async function ensureSeed(db: Db): Promise<void> {
  const existing = await db.select().from(configVersions);
  if (existing.length > 0) {
    await ensureGtmSeed(db);
    return;
  }

  await db.insert(configVersions).values({ id: 1, version: 1 });

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.insert(appSettings).values({ key, value, version: 1 });
  }

  let order = 0;
  for (const [medium, sources] of Object.entries(TAXONOMY)) {
    await db.insert(taxonomyMediums).values({
      id: prefixedUlid("med"),
      slug: medium,
      label: medium.charAt(0).toUpperCase() + medium.slice(1),
      sortOrder: order++,
    });
    let srcOrder = 0;
    for (const source of sources) {
      await db.insert(taxonomySources).values({
        id: prefixedUlid("src"),
        slug: source,
        mediumSlug: medium,
        label: source,
        aliases: SOURCE_ALIASES[source] ?? [],
        sortOrder: srcOrder++,
      });
    }
  }

  for (const preset of PRESETS) {
    await db.insert(platformPresets).values({
      id: prefixedUlid("pre"),
      key: preset.key,
      name: preset.name,
      outputType: preset.outputType,
      defaults: preset.defaults,
      supportedMacros: preset.supportedMacros,
      requiredFields: preset.requiredFields,
      staticParams: {},
      validationRules: {},
      verificationState: preset.verificationState,
      docsUrl: preset.docsUrl,
    });
  }

  await db.insert(destinationPolicies).values([
    { id: prefixedUlid("dst"), domain: "runpod.io", kind: "approved" },
    { id: prefixedUlid("dst"), domain: "runpod.ai", kind: "approved" },
    { id: prefixedUlid("dst"), domain: "docs.runpod.io", kind: "approved" },
  ]);

  // Local-development identities only; production uses the SSO provider.
  await db.insert(users).values([
    {
      id: newId("user"),
      email: "dev-admin@runpod.io",
      name: "Dev Admin",
      role: "admin",
    },
    {
      id: newId("user"),
      email: "dev-user@runpod.io",
      name: "Dev User",
      role: "user",
    },
    {
      id: newId("user"),
      email: "dev-investigator@runpod.io",
      name: "Dev Investigator",
      role: "investigator",
    },
  ]);

  await ensureGtmSeed(db);
}
