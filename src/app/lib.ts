/**
 * Shared client-side utilities for the UI: typed fetch helper, query-string
 * builder, and formatting. No business logic lives here — all validation,
 * normalization, and issuance goes through the APIs.
 */

// ------------------------------------------------------------- API types
// JSON-facing shapes (dates arrive as ISO strings).

export interface Session {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin" | "investigator";
}

export interface SessionCapabilities {
  canWrite: boolean;
  canIssue: boolean;
  canCreateCampaign: boolean;
  canCreateInitiative: boolean;
  canReadAudit: boolean;
  canAdminister: boolean;
}

export interface Finding {
  code: string;
  severity: "error" | "warning";
  field: string | null;
  message: string;
}

export interface Initiative {
  id: string;
  name: string;
  product: string | null;
  initiativeType: string | null;
  startDate: string | null;
  endDate: string | null;
  lifecycle: string;
  description: string | null;
  ownerId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  utmCampaign: string;
  initiativeId: string | null;
  product: string | null;
  campaignType: string | null;
  startDate: string | null;
  endDate: string | null;
  lifecycle: string;
  description: string | null;
  ownerId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignPickerGroups {
  recent: Campaign[];
  mine: Campaign[];
  initiative: Campaign[];
}

export interface CampaignDuplicateCandidate {
  id: string;
  name: string;
  utmCampaign: string;
  initiativeId: string | null;
  lifecycle: "planned" | "active" | "completed" | "archived";
}

export interface CampaignMapping {
  id: string;
  campaignId: string;
  system: string;
  externalType: string;
  externalId: string | null;
  externalName: string | null;
  syncState: "pending" | "syncing" | "synced" | "failed" | "dead" | "detached";
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export interface LinkRec {
  id: string;
  campaignId: string;
  initiativeId: string | null;
  batchId: string | null;
  destinationRaw: string;
  destinationNormalized: string;
  finalUrl: string;
  utmId: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string | null;
  utmTerm: string | null;
  rpInitiativeIdParam: string | null;
  rpLinkIdParam: string | null;
  platformPresetKey: string;
  duplicateOverride: boolean;
  status: "draft" | "issued" | "retired";
  currentRevision: number;
  configVersion: number;
  validationState: string;
  createdBy: string;
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LinkSearchRow {
  link: LinkRec;
  campaignName: string | null;
  initiativeName: string | null;
}

export interface LinkSearchResult {
  rows: LinkSearchRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DuplicateInfo {
  exact: { linkId: string; finalUrl: string } | null;
  near: { linkId: string; finalUrl: string; kind: string }[];
}

export interface PreviewResult {
  ok: boolean;
  validation: { ok: boolean; findings: Finding[] };
  duplicates: DuplicateInfo;
  normalizedDestination: string | null;
  finalUrlPreview: string | null;
  utm: {
    utm_id: string;
    utm_source: string;
    utm_medium: string;
    utm_campaign: string;
    utm_content: string | null;
    utm_term: string | null;
  } | null;
}

export interface IssueResult {
  link: LinkRec;
  validation: { ok: boolean; findings: Finding[] };
  duplicates: DuplicateInfo;
}

export interface LinkRevision {
  id: string;
  linkId: string;
  revisionNumber: number;
  snapshot: unknown;
  diff: Record<string, { before: unknown; after: unknown }> | null;
  reason: string | null;
  actorId: string;
  createdAt: string;
}

export interface ValidationRun {
  id: string;
  linkId: string;
  kind: string;
  passed: boolean;
  findings: Finding[];
  createdAt: string;
}

export interface TaxonomyMedium {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  status: "active" | "deprecated" | "disabled";
  sortOrder: number;
  version: number;
  updatedAt: string;
}

export interface TaxonomySource {
  id: string;
  slug: string;
  mediumSlug: string;
  label: string;
  description: string | null;
  aliases: string[];
  status: "active" | "deprecated" | "disabled";
  severity: string;
  sortOrder: number;
  version: number;
  updatedAt: string;
}

export interface Taxonomy {
  mediums: TaxonomyMedium[];
  sources: TaxonomySource[];
}

export interface Preset {
  id: string;
  key: string;
  name: string;
  outputType: string;
  defaults: Record<string, string>;
  supportedMacros: string[];
  requiredFields: string[];
  staticParams: Record<string, string>;
  verificationState: "draft" | "verified" | "deprecated";
  docsUrl: string | null;
  version: number;
}

export interface BatchRowResult {
  rowIndex: number;
  status: "issued" | "error" | "skipped_duplicate";
  linkId: string | null;
  finalUrl: string | null;
  errors: { code: string; message: string }[];
}

export interface BatchResult {
  batchId: string;
  status: "completed" | "completed_with_errors";
  rows: BatchRowResult[];
  succeeded: number;
  failed: number;
}

export interface AppConfig {
  publicParamPolicy: { rp_link_id: boolean; rp_initiative_id: boolean };
  bulkLimit: number;
  requiredFields: string[];
  duplicateOverrideRoles: string[];
  recommendedMaxUrlLength: number;
  featureFlags: Record<string, boolean>;
  configVersion: number;
}

export interface UserRec {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin" | "investigator";
  active: boolean;
  createdAt: string;
}

export interface DestinationPolicy {
  id: string;
  domain: string;
  kind: "approved" | "exception";
  notes: string | null;
  status: "active" | "disabled";
  version: number;
  updatedAt: string;
}

export interface OutboxEvent {
  id: string;
  type: string;
  status: "pending" | "processing" | "succeeded" | "failed" | "dead";
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  idempotencyKey: string;
  createdAt: string;
}

export interface ReconciliationRun {
  id: string;
  kind: string;
  triggeredBy: string;
  result: unknown;
  discrepancyCount: number;
  createdAt: string;
}

export interface Discrepancy {
  kind: string;
  entityType: string;
  entityId: string;
  detail: string;
}

export interface AuditEvent {
  id: string;
  ts: string;
  actorId: string;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  correlationId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  configVersion: number | null;
  context: unknown;
}

// --------------------------------------------------------- fetch helper

export class ApiError extends Error {
  status: number;
  code?: string;
  findings?: Finding[];
  existingLinkId?: string;
  existingUrl?: string;
  candidates?: CampaignDuplicateCandidate[];

  constructor(status: number, body: Record<string, unknown>) {
    super(
      typeof body.error === "string" && body.error
        ? body.error
        : `Request failed (HTTP ${status}).`,
    );
    this.name = "ApiError";
    this.status = status;
    if (typeof body.code === "string") this.code = body.code;
    if (Array.isArray(body.findings)) this.findings = body.findings as Finding[];
    if (typeof body.existingLinkId === "string") this.existingLinkId = body.existingLinkId;
    if (typeof body.existingUrl === "string") this.existingUrl = body.existingUrl;
    if (Array.isArray(body.candidates)) this.candidates = body.candidates as CampaignDuplicateCandidate[];
  }
}

/** Same-origin JSON fetch. Throws ApiError with the server's message on !ok. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) } });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text.slice(0, 300) };
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, (body ?? {}) as Record<string, unknown>);
  }
  return body as T;
}

/** Builds "?a=1&b=2" skipping empty values. Returns "" when nothing set. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// ------------------------------------------------------------ formatting

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Client-side CSV of already-returned API results (display concern only). */
export function toCsvText(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const v = cell === null || cell === undefined ? "" : String(cell);
          return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(","),
    )
    .join("\r\n");
}

export function downloadTextFile(filename: string, text: string, mime = "text/csv"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Minimal CSV parser for client-side display of an uploaded file (handles
 * quoted fields and escaped quotes). Issuance still goes through the API.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}
