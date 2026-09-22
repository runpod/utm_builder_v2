"use client";

/**
 * Registry: search + filters over every governed link, with CSV export of
 * the current filter set (generated server-side by /api/export/links).
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge, CopyButton, Msg, Pager } from "../components";
import {
  api,
  errText,
  fmtDateTime,
  qs,
  type Campaign,
  type Initiative,
  type LinkSearchResult,
  type Preset,
  type Taxonomy,
} from "../lib";

interface Filters {
  q: string;
  status: string;
  platform: string;
  utmMedium: string;
  utmSource: string;
  campaignId: string;
  initiativeId: string;
  validationState: string;
  createdAfter: string;
  createdBefore: string;
}

const EMPTY_FILTERS: Filters = {
  q: "",
  status: "",
  platform: "",
  utmMedium: "",
  utmSource: "",
  campaignId: "",
  initiativeId: "",
  validationState: "",
  createdAfter: "",
  createdBefore: "",
};

export default function RegistryPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<LinkSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({ mediums: [], sources: [] });
  const [presets, setPresets] = useState<Preset[]>([]);

  // Seed filters from the URL (e.g. /registry?campaignId=rpc_…) on mount.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if ([...sp.keys()].length === 0) return;
    setFilters((cur) => {
      const next = { ...cur };
      for (const key of Object.keys(cur) as (keyof Filters)[]) {
        const v = sp.get(key);
        if (v) next[key] = v;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [cam, ini, tax, pre] = await Promise.all([
          api<{ campaigns: Campaign[] }>("/api/campaigns"),
          api<{ initiatives: Initiative[] }>("/api/initiatives"),
          api<Taxonomy>("/api/taxonomy"),
          api<{ presets: Preset[] }>("/api/presets"),
        ]);
        setCampaigns(cam.campaigns);
        setInitiatives(ini.initiatives);
        setTaxonomy(tax);
        setPresets(pre.presets);
      } catch (err) {
        setError(errText(err));
      }
    })();
  }, []);

  const query = qs({
    q: filters.q,
    status: filters.status,
    platform: filters.platform,
    utmMedium: filters.utmMedium,
    utmSource: filters.utmSource,
    campaignId: filters.campaignId,
    initiativeId: filters.initiativeId,
    validationState: filters.validationState,
    createdAfter: filters.createdAfter,
    createdBefore: filters.createdBefore,
    page,
    pageSize: 25,
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const d = await api<LinkSearchResult>(`/api/links${query}`);
        if (!cancelled) {
          setResult(d);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(errText(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query]);

  const setFilter = useCallback((key: keyof Filters, value: string) => {
    setFilters((cur) => ({ ...cur, [key]: value }));
    setPage(1);
  }, []);

  const exportQuery = qs({
    q: filters.q,
    status: filters.status,
    platform: filters.platform,
    utmMedium: filters.utmMedium,
    utmSource: filters.utmSource,
    campaignId: filters.campaignId,
    initiativeId: filters.initiativeId,
    validationState: filters.validationState,
    createdAfter: filters.createdAfter,
    createdBefore: filters.createdBefore,
  });

  return (
    <div>
      <h1>Registry</h1>
      <p className="page-sub">
        Every governed link ever issued. Search free text or paste any rp*_ ID.
      </p>

      <div className="card">
        <div className="field">
          <label htmlFor="registry-q">Search</label>
          <input
            id="registry-q"
            type="text"
            placeholder="Free text or an ID (rpl_…, rpc_…, rpi_…, rpb_…)"
            value={filters.q}
            onChange={(e) => setFilter("q", e.target.value)}
          />
        </div>
        <div className="filters">
          <div>
            <label htmlFor="f-status">Status</label>
            <select id="f-status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
              <option value="">Any</option>
              <option value="draft">Draft</option>
              <option value="issued">Issued</option>
              <option value="retired">Retired</option>
            </select>
          </div>
          <div>
            <label htmlFor="f-platform">Platform preset</label>
            <select id="f-platform" value={filters.platform} onChange={(e) => setFilter("platform", e.target.value)}>
              <option value="">Any</option>
              {presets.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-medium">Medium</label>
            <select id="f-medium" value={filters.utmMedium} onChange={(e) => setFilter("utmMedium", e.target.value)}>
              <option value="">Any</option>
              {taxonomy.mediums.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.slug}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-source">Source</label>
            <select id="f-source" value={filters.utmSource} onChange={(e) => setFilter("utmSource", e.target.value)}>
              <option value="">Any</option>
              {taxonomy.sources
                .filter((s) => !filters.utmMedium || s.mediumSlug === filters.utmMedium)
                .map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.slug}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-campaign">Campaign</label>
            <select id="f-campaign" value={filters.campaignId} onChange={(e) => setFilter("campaignId", e.target.value)}>
              <option value="">Any</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-initiative">Initiative</label>
            <select id="f-initiative" value={filters.initiativeId} onChange={(e) => setFilter("initiativeId", e.target.value)}>
              <option value="">Any</option>
              {initiatives.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-validation">Validation state</label>
            <select
              id="f-validation"
              value={filters.validationState}
              onChange={(e) => setFilter("validationState", e.target.value)}
            >
              <option value="">Any</option>
              <option value="unvalidated">Unvalidated</option>
              <option value="passed_syntactic">Passed (syntactic)</option>
              <option value="warnings">Warnings</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div>
            <label htmlFor="f-after">Created after</label>
            <input
              id="f-after"
              type="date"
              value={filters.createdAfter}
              onChange={(e) => setFilter("createdAfter", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="f-before">Created before</label>
            <input
              id="f-before"
              type="date"
              value={filters.createdBefore}
              onChange={(e) => setFilter("createdBefore", e.target.value)}
            />
          </div>
        </div>
        <div className="btn-row">
          <button type="button" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>
            Clear filters
          </button>
          <a className="btn" href={`/api/export/links${exportQuery}`}>
            Export CSV (current filters)
          </a>
          {loading ? <span className="hint" aria-live="polite">Searching…</span> : null}
        </div>
      </div>

      <Msg kind="error">{error}</Msg>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Final URL</th>
              <th>Campaign</th>
              <th>Source / Medium</th>
              <th>Status</th>
              <th>Validation</th>
              <th>Rev</th>
              <th>Generated by</th>
              <th className="nowrap">Created</th>
            </tr>
          </thead>
          <tbody>
            {(result?.rows ?? []).map(({ link, campaignName, creatorName, creatorEmail }) => (
              <tr
                key={link.id}
                className="clickable"
                tabIndex={0}
                role="link"
                aria-label={`Open link ${link.id}`}
                onClick={() => router.push(`/registry/links/${link.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") router.push(`/registry/links/${link.id}`);
                }}
              >
                <td>
                  <span className="url-cell mono small" title={link.finalUrl}>
                    {link.finalUrl}
                  </span>{" "}
                  <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <CopyButton text={link.finalUrl} />
                  </span>
                </td>
                <td>{campaignName ?? <span className="muted">—</span>}</td>
                <td className="nowrap">
                  <span className="mono small">
                    {link.utmSource} / {link.utmMedium}
                  </span>
                </td>
                <td>
                  <Badge value={link.status} />
                  {link.duplicateOverride ? (
                    <>
                      {" "}
                      <Badge value="warning">override</Badge>
                    </>
                  ) : null}
                </td>
                <td>
                  <Badge value={link.validationState} />
                </td>
                <td>{link.currentRevision}</td>
                <td className="small">
                  <span>{creatorName ?? creatorEmail ?? link.createdBy}</span>
                  {creatorName && creatorEmail ? <><br /><span className="muted">{creatorEmail}</span></> : null}
                </td>
                <td className="nowrap small">{fmtDateTime(link.createdAt)}</td>
              </tr>
            ))}
            {result && result.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  No links match the current filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {result ? (
        <Pager page={result.page} pageSize={result.pageSize} total={result.total} onPage={setPage} />
      ) : null}
    </div>
  );
}
