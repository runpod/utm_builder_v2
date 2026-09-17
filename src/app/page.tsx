"use client";

/**
 * Single-link builder. Everything material — normalization, validation,
 * duplicate detection, URL assembly, ID minting — happens server-side via
 * /api/links/preview and /api/links. This page only collects input and
 * renders what the API returns.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, CopyButton, FindingList, Msg, useSession } from "./components";
import {
  api,
  ApiError,
  errText,
  qs,
  type Campaign,
  type CampaignDuplicateCandidate,
  type CampaignPickerGroups,
  type Finding,
  type Initiative,
  type IssueResult,
  type Preset,
  type PreviewResult,
  type Taxonomy,
} from "./lib";

const EMPTY_CAMPAIGN_GROUPS: CampaignPickerGroups = {
  recent: [],
  mine: [],
  initiative: [],
};

function mergeCampaigns(...lists: Campaign[][]): Campaign[] {
  const byId = new Map<string, Campaign>();
  for (const campaign of lists.flat()) byId.set(campaign.id, campaign);
  return [...byId.values()];
}

export default function BuilderPage() {
  const { session, capabilities } = useSession();
  const isAdmin = session?.role === "admin";
  const canWrite = capabilities.canWrite;

  // Reference data
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [campaignGroups, setCampaignGroups] = useState<CampaignPickerGroups>(EMPTY_CAMPAIGN_GROUPS);
  const [knownCampaigns, setKnownCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignSearchOpen, setCampaignSearchOpen] = useState(false);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [campaignSearchResults, setCampaignSearchResults] = useState<Campaign[]>([]);
  const [campaignSearchLoading, setCampaignSearchLoading] = useState(false);
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({ mediums: [], sources: [] });
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loadError, setLoadError] = useState("");

  // Form state
  const [destination, setDestination] = useState("");
  const [initiativeId, setInitiativeId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [presetKey, setPresetKey] = useState("generic");
  const [medium, setMedium] = useState("");
  const [source, setSource] = useState("");
  const [content, setContent] = useState("");
  const [term, setTerm] = useState("");

  // Inline create forms
  const [showNewInitiative, setShowNewInitiative] = useState(false);
  const [newInitiativeName, setNewInitiativeName] = useState("");
  const [newInitiativeErr, setNewInitiativeErr] = useState("");
  const [creatingInitiative, setCreatingInitiative] = useState(false);

  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignSlug, setNewCampaignSlug] = useState("");
  const [newCampaignErr, setNewCampaignErr] = useState("");
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [campaignDuplicates, setCampaignDuplicates] = useState<CampaignDuplicateCandidate[]>([]);
  const [campaignDuplicateReason, setCampaignDuplicateReason] = useState("");
  const [showCampaignAssignment, setShowCampaignAssignment] = useState(false);
  const [campaignAssignmentInitiativeId, setCampaignAssignmentInitiativeId] = useState("");
  const [campaignAssignmentReason, setCampaignAssignmentReason] = useState("");
  const [campaignAssignmentError, setCampaignAssignmentError] = useState("");
  const [campaignAssignmentNotice, setCampaignAssignmentNotice] = useState("");
  const [savingCampaignAssignment, setSavingCampaignAssignment] = useState(false);

  // Preview state
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const previewSeq = useRef(0);

  // Submission state
  const [submitting, setSubmitting] = useState<"" | "draft" | "issued">("");
  const [submitError, setSubmitError] = useState("");
  const [submitFindings, setSubmitFindings] = useState<Finding[]>([]);
  const [issued, setIssued] = useState<IssueResult | null>(null);

  // Duplicate handling state
  const [overrideReason, setOverrideReason] = useState("");
  const [reuseStatus, setReuseStatus] = useState("");
  const [reusedUrl, setReusedUrl] = useState("");

  const campaignLoadSeq = useRef(0);
  const loadCampaignGroups = useCallback(async (selectedInitiativeId: string) => {
    const seq = ++campaignLoadSeq.current;
    setCampaignsLoading(true);
    try {
      const d = await api<{ groups: CampaignPickerGroups }>(
        `/api/campaigns${qs({ view: "picker", initiativeId: selectedInitiativeId })}`,
      );
      if (campaignLoadSeq.current !== seq) return;
      setCampaignGroups(d.groups);
      setKnownCampaigns((cur) =>
        mergeCampaigns(cur, d.groups.recent, d.groups.mine, d.groups.initiative),
      );
    } catch (err) {
      if (campaignLoadSeq.current === seq) setLoadError(errText(err));
    } finally {
      if (campaignLoadSeq.current === seq) setCampaignsLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [ini, tax, pre] = await Promise.all([
          api<{ initiatives: Initiative[] }>("/api/initiatives"),
          api<Taxonomy>("/api/taxonomy"),
          api<{ presets: Preset[] }>("/api/presets"),
        ]);
        setInitiatives(ini.initiatives);
        setTaxonomy(tax);
        setPresets(pre.presets);
      } catch (err) {
        setLoadError(errText(err));
      }
    })();
  }, []);

  useEffect(() => {
    void loadCampaignGroups(initiativeId);
  }, [initiativeId, loadCampaignGroups]);

  useEffect(() => {
    if (!campaignSearchOpen || !campaignSearch.trim()) {
      setCampaignSearchResults([]);
      setCampaignSearchLoading(false);
      return;
    }
    let cancelled = false;
    setCampaignSearchResults([]);
    setCampaignSearchLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const d = await api<{ campaigns: Campaign[] }>(
          `/api/campaigns${qs({ q: campaignSearch.trim() })}`,
        );
        if (!cancelled) {
          setCampaignSearchResults(d.campaigns);
          setKnownCampaigns((cur) => mergeCampaigns(cur, d.campaigns));
        }
      } catch (err) {
        if (!cancelled) setLoadError(errText(err));
      } finally {
        if (!cancelled) setCampaignSearchLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [campaignSearch, campaignSearchOpen]);

  const selectedPreset = presets.find((p) => p.key === presetKey) ?? null;
  const selectedCampaign = knownCampaigns.find((campaign) => campaign.id === campaignId) ?? null;
  const selectedInitiative = initiatives.find((initiative) => initiative.id === initiativeId) ?? null;
  const selectedCampaignInitiative = initiatives.find(
    (initiative) => initiative.id === selectedCampaign?.initiativeId,
  ) ?? null;
  const campaignInitiativeMismatch = Boolean(
    initiativeId && selectedCampaign && selectedCampaign.initiativeId !== initiativeId,
  );
  const canManageSelectedCampaign = Boolean(
    session &&
      selectedCampaign &&
      session.role !== "investigator" &&
      (session.role === "admin" ||
        selectedCampaign.createdBy === session.id ||
        selectedCampaign.ownerId === session.id),
  );
  const campaignOptionGroups = useMemo(() => {
    const searching = campaignSearchOpen && Boolean(campaignSearch.trim());
    const source = searching
      ? [{ label: "Search all campaigns", campaigns: campaignSearchResults }]
      : [
          { label: "Recent campaigns", campaigns: campaignGroups.recent },
          { label: "My campaigns", campaigns: campaignGroups.mine },
          ...(initiativeId
            ? [{ label: "This initiative", campaigns: campaignGroups.initiative }]
            : []),
        ];
    const seen = new Set<string>();
    const groups = source.map((group) => ({
      ...group,
      campaigns: group.campaigns.filter((campaign) => {
        if (seen.has(campaign.id)) return false;
        seen.add(campaign.id);
        return true;
      }),
    }));
    if (selectedCampaign && !seen.has(selectedCampaign.id)) {
      groups.unshift({ label: "Selected campaign", campaigns: [selectedCampaign] });
    }
    return groups;
  }, [campaignGroups, campaignSearch, campaignSearchOpen, campaignSearchResults, initiativeId, selectedCampaign]);
  const activeMediums = taxonomy.mediums.filter((m) => m.status === "active");
  const visibleSources = taxonomy.sources.filter(
    (s) => s.status === "active" && (!medium || s.mediumSlug === medium),
  );

  // Preset defaults fill empty medium/source (the server applies the same
  // rule; this just makes the choice visible before preview).
  const applyPreset = useCallback(
    (key: string) => {
      setPresetKey(key);
      const preset = presets.find((p) => p.key === key);
      if (!preset) return;
      const defaults = preset.defaults ?? {};
      if (defaults.utm_medium) setMedium((cur) => cur || defaults.utm_medium);
      if (defaults.utm_source) setSource((cur) => cur || defaults.utm_source);
    },
    [presets],
  );

  // Debounced live preview via the API. Never computed client-side.
  useEffect(() => {
    setIssued(null);
    setSubmitError("");
    setSubmitFindings([]);
    setReusedUrl("");
    setReuseStatus("");
    const seq = ++previewSeq.current;
    if (!destination.trim() || campaignInitiativeMismatch) {
      setPreview(null);
      setPreviewError("");
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const result = await api<PreviewResult>("/api/links/preview", {
          method: "POST",
          body: JSON.stringify({
            destination,
            campaignId,
            presetKey: presetKey || undefined,
            utmSource: source,
            utmMedium: medium,
            utmContent: content || undefined,
            utmTerm: term || undefined,
          }),
        });
        if (previewSeq.current !== seq) return;
        setPreview(result);
        setPreviewError("");
      } catch (err) {
        if (previewSeq.current !== seq) return;
        setPreview(null);
        setPreviewError(errText(err));
      } finally {
        if (previewSeq.current === seq) setPreviewLoading(false);
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [destination, campaignId, presetKey, source, medium, content, term, campaignInitiativeMismatch]);

  const createInitiative = useCallback(async () => {
    if (!newInitiativeName.trim()) {
      setNewInitiativeErr("Name is required.");
      return;
    }
    setCreatingInitiative(true);
    setNewInitiativeErr("");
    try {
      const d = await api<{ initiative: Initiative }>("/api/initiatives", {
        method: "POST",
        body: JSON.stringify({ name: newInitiativeName.trim() }),
      });
      setInitiatives((cur) => [...cur, d.initiative]);
      setInitiativeId(d.initiative.id);
      setCampaignId((currentCampaignId) => {
        if (!currentCampaignId) return "";
        return knownCampaigns.find((campaign) => campaign.id === currentCampaignId)?.initiativeId ===
          d.initiative.id
          ? currentCampaignId
          : "";
      });
      setNewInitiativeName("");
      setShowNewInitiative(false);
    } catch (err) {
      setNewInitiativeErr(errText(err));
    } finally {
      setCreatingInitiative(false);
    }
  }, [knownCampaigns, newInitiativeName]);

  const createCampaign = useCallback(async (withOverride = false) => {
    if (!newCampaignName.trim()) {
      setNewCampaignErr("Campaign name is required.");
      return;
    }
    setCreatingCampaign(true);
    setNewCampaignErr("");
    if (!withOverride) setCampaignDuplicates([]);
    try {
      const d = await api<{ campaign: Campaign }>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: newCampaignName.trim(),
          utmCampaign: newCampaignSlug.trim() || undefined,
          initiativeId: initiativeId || undefined,
          ...(withOverride
            ? { duplicateAction: "override", duplicateReason: campaignDuplicateReason }
            : {}),
        }),
      });
      setKnownCampaigns((cur) => mergeCampaigns(cur, [d.campaign]));
      await loadCampaignGroups(initiativeId);
      setCampaignId(d.campaign.id);
      setNewCampaignName("");
      setNewCampaignSlug("");
      setCampaignDuplicates([]);
      setCampaignDuplicateReason("");
      setShowNewCampaign(false);
    } catch (err) {
      setNewCampaignErr(errText(err));
      if (err instanceof ApiError && err.code === "campaign_duplicate") {
        setCampaignDuplicates(err.candidates ?? []);
      }
    } finally {
      setCreatingCampaign(false);
    }
  }, [newCampaignName, newCampaignSlug, initiativeId, campaignDuplicateReason, loadCampaignGroups]);

  const chooseInitiative = useCallback((nextInitiativeId: string) => {
    setInitiativeId(nextInitiativeId);
    setShowCampaignAssignment(false);
    setCampaignAssignmentError("");
    setCampaignAssignmentNotice("");
  }, []);

  const chooseCampaign = useCallback((nextCampaignId: string) => {
    setCampaignId(nextCampaignId);
    setShowCampaignAssignment(false);
    setCampaignAssignmentError("");
    setCampaignAssignmentNotice("");
  }, []);

  const useCampaignInitiative = useCallback(() => {
    if (!selectedCampaign) return;
    setInitiativeId(selectedCampaign.initiativeId ?? "");
    setShowCampaignAssignment(false);
    setCampaignAssignmentError("");
    setCampaignAssignmentNotice("");
  }, [selectedCampaign]);

  const openCampaignAssignment = useCallback(() => {
    if (!selectedCampaign) return;
    setCampaignAssignmentInitiativeId(
      campaignInitiativeMismatch ? initiativeId : selectedCampaign.initiativeId ?? "",
    );
    setCampaignAssignmentReason("");
    setCampaignAssignmentError("");
    setCampaignAssignmentNotice("");
    setShowCampaignAssignment(true);
  }, [campaignInitiativeMismatch, initiativeId, selectedCampaign]);

  const saveCampaignAssignment = useCallback(async () => {
    if (!selectedCampaign || !campaignAssignmentReason.trim()) return;
    setSavingCampaignAssignment(true);
    setCampaignAssignmentError("");
    setCampaignAssignmentNotice("");
    try {
      const result = await api<{ campaign: Campaign }>(`/api/campaigns/${selectedCampaign.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          initiativeId: campaignAssignmentInitiativeId || null,
          reason: campaignAssignmentReason.trim(),
        }),
      });
      setKnownCampaigns((current) => mergeCampaigns(current, [result.campaign]));
      setInitiativeId(result.campaign.initiativeId ?? "");
      await loadCampaignGroups(result.campaign.initiativeId ?? "");
      const assignedInitiative = initiatives.find(
        (initiative) => initiative.id === result.campaign.initiativeId,
      );
      setCampaignAssignmentNotice(
        `Campaign assignment updated to ${assignedInitiative?.name ?? "Standalone"}.`,
      );
      setCampaignAssignmentReason("");
      setShowCampaignAssignment(false);
    } catch (err) {
      setCampaignAssignmentError(errText(err));
    } finally {
      setSavingCampaignAssignment(false);
    }
  }, [
    campaignAssignmentInitiativeId,
    campaignAssignmentReason,
    initiatives,
    loadCampaignGroups,
    selectedCampaign,
  ]);

  const submit = useCallback(
    async (status: "draft" | "issued", withOverride = false) => {
      if (campaignInitiativeMismatch) {
        setSubmitError("Resolve the campaign's initiative assignment before continuing.");
        return;
      }
      setSubmitting(status);
      setSubmitError("");
      setSubmitFindings([]);
      setIssued(null);
      try {
        const result = await api<IssueResult>("/api/links", {
          method: "POST",
          body: JSON.stringify({
            destination,
            campaignId,
            presetKey: presetKey || undefined,
            utmSource: source,
            utmMedium: medium,
            utmContent: content || undefined,
            utmTerm: term || undefined,
            status,
            ...(withOverride
              ? { duplicateAction: "override", duplicateReason: overrideReason }
              : {}),
          }),
        });
        setIssued(result);
      } catch (err) {
        if (err instanceof ApiError) {
          setSubmitError(err.message);
          if (err.findings) setSubmitFindings(err.findings);
        } else {
          setSubmitError(errText(err));
        }
      } finally {
        setSubmitting("");
      }
    },
    [destination, campaignId, presetKey, source, medium, content, term, overrideReason, campaignInitiativeMismatch],
  );

  const reuseExisting = useCallback(async (linkId: string, finalUrl: string) => {
    setReuseStatus("Recording reuse…");
    try {
      await api(`/api/links/${linkId}/reuse`, { method: "POST" });
      setReusedUrl(finalUrl);
      setReuseStatus("Reuse recorded. Use the existing link below.");
    } catch (err) {
      setReuseStatus(errText(err));
    }
  }, []);

  const exact = preview?.duplicates.exact ?? null;

  return (
    <div>
      <h1>Link Builder</h1>
      <p className="page-sub">
        Build one governed campaign link. The registry validates, deduplicates, and issues it.
      </p>
      <Msg kind="error">{loadError}</Msg>

      <div className="two-col">
        <div className="card">
          <h2>Link details</h2>

          <div className="field">
            <label htmlFor="destination">Destination URL</label>
            <input
              id="destination"
              type="url"
              placeholder="https://www.runpod.io/serverless"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="initiative">
              Initiative <span className="hint">(optional grouping)</span>
            </label>
            <select
              id="initiative"
              value={initiativeId}
              onChange={(e) => chooseInitiative(e.target.value)}
            >
              <option value="">All initiatives</option>
              {initiatives.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            {capabilities.canCreateInitiative ? (
              <button
                type="button"
                className="btn-link small"
                onClick={() => setShowNewInitiative((v) => !v)}
              >
                {showNewInitiative ? "Cancel new initiative" : "+ Create initiative"}
              </button>
            ) : null}
            {showNewInitiative ? (
              <div className="inline-form">
                <div className="field">
                  <label htmlFor="new-initiative-name">New initiative name</label>
                  <input
                    id="new-initiative-name"
                    type="text"
                    value={newInitiativeName}
                    onChange={(e) => setNewInitiativeName(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="btn-primary btn-small"
                  disabled={creatingInitiative}
                  onClick={() => void createInitiative()}
                >
                  {creatingInitiative ? "Creating…" : "Create initiative"}
                </button>
                <Msg kind="error">{newInitiativeErr}</Msg>
              </div>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="campaign">Campaign</label>
            <select
              id="campaign"
              value={campaignId}
              disabled={campaignsLoading && campaignOptionGroups.every((group) => group.campaigns.length === 0)}
              onChange={(e) => chooseCampaign(e.target.value)}
              aria-describedby="campaign-help"
            >
              <option value="">Select a campaign…</option>
              {campaignOptionGroups.map((group) =>
                group.campaigns.length ? (
                  <optgroup key={group.label} label={group.label}>
                    {group.campaigns.map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.name} ({campaign.utmCampaign})
                        {campaign.lifecycle === "completed" || campaign.lifecycle === "archived"
                          ? ` — ${campaign.lifecycle}`
                          : ""}
                      </option>
                    ))}
                  </optgroup>
                ) : null,
              )}
            </select>
            <p id="campaign-help" className="hint" style={{ margin: "0.2rem 0 0" }}>
              {campaignsLoading
                ? "Loading active and upcoming campaigns…"
                : "Showing active and upcoming campaigns. Completed and archived campaigns remain searchable."}
            </p>
            {campaignSearchOpen ? (
              <div className="campaign-search">
                <input
                  id="campaign-search"
                  type="search"
                  aria-label="Search all campaigns"
                  placeholder="Search name, slug, or campaign ID…"
                  value={campaignSearch}
                  autoFocus
                  onChange={(e) => setCampaignSearch(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-small"
                  onClick={() => setCampaignSearchOpen(false)}
                >
                  Close search
                </button>
                <span className="hint" aria-live="polite">
                  {campaignSearchLoading
                    ? "Searching…"
                    : campaignSearch.trim() && campaignSearchResults.length === 0
                      ? "No matching campaigns."
                      : ""}
                </span>
              </div>
            ) : (
              <button
                type="button"
                className="btn-link small"
                onClick={() => setCampaignSearchOpen(true)}
              >
                Search all campaigns…
              </button>
            )}
            {capabilities.canCreateCampaign ? (
              <button
                type="button"
                className="btn-link small"
                onClick={() => setShowNewCampaign((v) => !v)}
              >
                {showNewCampaign ? "Cancel new campaign" : "+ Create campaign"}
              </button>
            ) : null}
            {selectedCampaign ? (
              <>
                {campaignInitiativeMismatch ? (
                  <div className="duplicate-warning">
                    <p><strong>Campaign is assigned elsewhere</strong></p>
                    <p>
                      {selectedCampaign.name} is assigned to{" "}
                      <strong>{selectedCampaignInitiative?.name ?? "Standalone"}</strong>, not{" "}
                      <strong>{selectedInitiative?.name ?? "the selected initiative"}</strong>.
                      Choose its current assignment or explicitly reassign the campaign before continuing.
                    </p>
                    <div className="btn-row">
                      <button type="button" className="btn-small" onClick={useCampaignInitiative}>
                        {selectedCampaign.initiativeId
                          ? `Use ${selectedCampaignInitiative?.name ?? "campaign initiative"}`
                          : "Use as standalone"}
                      </button>
                      {canManageSelectedCampaign ? (
                        <button type="button" className="btn-small" onClick={openCampaignAssignment}>
                          Change initiative assignment
                        </button>
                      ) : null}
                    </div>
                    {!canManageSelectedCampaign ? (
                      <p className="small">
                        Only the campaign creator, owner, or an administrator can change this assignment.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="small" style={{ margin: "0.4rem 0 0" }}>
                    Assigned to: <strong>{selectedCampaignInitiative?.name ?? "Standalone"}</strong>
                    {canManageSelectedCampaign ? (
                      <>
                        {" · "}
                        <button type="button" className="btn-link small" onClick={openCampaignAssignment}>
                          Change assignment
                        </button>
                      </>
                    ) : null}
                  </p>
                )}
                <Msg kind="success">{campaignAssignmentNotice}</Msg>
                {showCampaignAssignment && canManageSelectedCampaign ? (
                  <div className="inline-form">
                    <div className="field">
                      <label htmlFor="campaign-assignment-initiative">New initiative assignment</label>
                      <select
                        id="campaign-assignment-initiative"
                        value={campaignAssignmentInitiativeId}
                        onChange={(event) => setCampaignAssignmentInitiativeId(event.target.value)}
                      >
                        <option value="">Standalone (no initiative)</option>
                        {initiatives.map((initiative) => (
                          <option key={initiative.id} value={initiative.id}>{initiative.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="campaign-assignment-reason">Reason (required and audited)</label>
                      <input
                        id="campaign-assignment-reason"
                        value={campaignAssignmentReason}
                        onChange={(event) => setCampaignAssignmentReason(event.target.value)}
                        placeholder="Why is this campaign moving?"
                      />
                    </div>
                    <p className="hint">
                      Future links will use the new initiative. Existing links keep their recorded initiative.
                    </p>
                    <div className="btn-row">
                      <button
                        type="button"
                        className="btn-primary btn-small"
                        disabled={
                          savingCampaignAssignment ||
                          !campaignAssignmentReason.trim() ||
                          (campaignAssignmentInitiativeId || null) === selectedCampaign.initiativeId
                        }
                        onClick={() => void saveCampaignAssignment()}
                      >
                        {savingCampaignAssignment ? "Saving…" : "Save assignment"}
                      </button>
                      <button
                        type="button"
                        className="btn-small"
                        disabled={savingCampaignAssignment}
                        onClick={() => {
                          setShowCampaignAssignment(false);
                          setCampaignAssignmentError("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                    <Msg kind="error">{campaignAssignmentError}</Msg>
                  </div>
                ) : null}
              </>
            ) : null}
            {showNewCampaign ? (
              <div className="inline-form">
                <div className="field">
                  <label htmlFor="new-campaign-name">New campaign name</label>
                  <input
                    id="new-campaign-name"
                    type="text"
                    value={newCampaignName}
                    onChange={(e) => setNewCampaignName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="new-campaign-slug">
                    utm_campaign slug <span className="hint">(optional — defaults from name)</span>
                  </label>
                  <input
                    id="new-campaign-slug"
                    type="text"
                    value={newCampaignSlug}
                    onChange={(e) => setNewCampaignSlug(e.target.value)}
                  />
                </div>
                <p className="hint">
                  {initiativeId
                    ? "Will be attached to the selected initiative."
                    : "No initiative selected — the campaign will be standalone."}
                </p>
                <button
                  type="button"
                  className="btn-primary btn-small"
                  disabled={creatingCampaign}
                  onClick={() => void createCampaign()}
                >
                  {creatingCampaign ? "Creating…" : "Create campaign"}
                </button>
                <Msg kind="error">{newCampaignErr}</Msg>
                {campaignDuplicates.length ? (
                  <div className="duplicate-warning">
                    <p><strong>Possible existing campaign</strong></p>
                    <ul>
                      {campaignDuplicates.map((candidate) => (
                        <li key={candidate.id}>
                          {candidate.name} ({candidate.utmCampaign}) — {candidate.id}
                        </li>
                      ))}
                    </ul>
                    {isAdmin ? (
                      <>
                        <div className="field">
                          <label htmlFor="campaign-duplicate-reason">Why is a separate campaign required?</label>
                          <input
                            id="campaign-duplicate-reason"
                            type="text"
                            value={campaignDuplicateReason}
                            onChange={(e) => setCampaignDuplicateReason(e.target.value)}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-secondary btn-small"
                          disabled={creatingCampaign || !campaignDuplicateReason.trim()}
                          onClick={() => void createCampaign(true)}
                        >
                          Create separately with audited override
                        </button>
                      </>
                    ) : (
                      <p className="small">Reuse the existing campaign or ask an administrator to approve an exception.</p>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="preset">Platform preset</label>
            <select id="preset" value={presetKey} onChange={(e) => applyPreset(e.target.value)}>
              {presets.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name} ({p.key})
                </option>
              ))}
            </select>
            {selectedPreset ? (
              <p className="small" style={{ margin: "0.25rem 0 0" }}>
                <Badge value={selectedPreset.verificationState} />{" "}
                {Object.keys(selectedPreset.defaults ?? {}).length ? (
                  <span className="muted">
                    Defaults:{" "}
                    {Object.entries(selectedPreset.defaults)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(", ")}{" "}
                    (applied when the field is empty)
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="medium">utm_medium</label>
              <select
                id="medium"
                value={medium}
                onChange={(e) => {
                  setMedium(e.target.value);
                  setSource("");
                }}
              >
                <option value="">Select medium…</option>
                {activeMediums.map((m) => (
                  <option key={m.slug} value={m.slug}>
                    {m.label} ({m.slug})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="source">utm_source</label>
              <select id="source" value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">Select source…</option>
                {visibleSources.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.label} ({s.slug})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="content">
                utm_content <span className="hint">(variant / placement)</span>
              </label>
              <input
                id="content"
                type="text"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="term">
                utm_term <span className="hint">(paid keyword)</span>
              </label>
              <input id="term" type="text" value={term} onChange={(e) => setTerm(e.target.value)} />
            </div>
          </div>

          <div className="btn-row">
            <button
              type="button"
              disabled={
                !canWrite ||
                submitting !== "" ||
                !destination.trim() ||
                !campaignId ||
                campaignInitiativeMismatch
              }
              onClick={() => void submit("draft")}
            >
              {submitting === "draft" ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={
                !capabilities.canIssue ||
                submitting !== "" ||
                !destination.trim() ||
                !campaignId ||
                campaignInitiativeMismatch
              }
              onClick={() => void submit("issued")}
            >
              {submitting === "issued" ? "Issuing…" : "Issue link"}
            </button>
          </div>

          {!canWrite ? (
            <Msg kind="info">Read-only access: you can preview and copy governed URLs, but you cannot create or modify registry records.</Msg>
          ) : null}

          <Msg kind="error">{submitError}</Msg>
          <FindingList findings={submitFindings} />

          {issued ? (
            <Msg kind="success">
              <strong>{issued.link.status === "draft" ? "Draft saved." : "Link issued."}</strong>
              <div className="final-url mono">{issued.link.finalUrl}</div>
              <div className="btn-row">
                <CopyButton text={issued.link.finalUrl} label="Copy URL" />
                <span className="mono small">{issued.link.id}</span>
                <CopyButton text={issued.link.id} label="Copy ID" />
                <Link href={`/registry/links/${issued.link.id}`}>Open in registry →</Link>
              </div>
            </Msg>
          ) : null}
        </div>

        <div className="card" aria-live="polite">
          <h2>
            Live preview{" "}
            {previewLoading ? <span className="hint">(checking with the registry…)</span> : null}
          </h2>
          <Msg kind="error">{previewError}</Msg>
          {!destination.trim() ? (
            <p className="muted">Enter a destination URL to see validation and the final URL.</p>
          ) : null}
          {preview ? (
            <>
              <h3>Normalized destination</h3>
              <p className="mono small">{preview.normalizedDestination ?? "—"}</p>

              <h3>Final URL preview</h3>
              {preview.finalUrlPreview ? (
                <>
                  <div className="final-url mono">{preview.finalUrlPreview}</div>
                  <p className="hint">
                    rpl_PREVIEW is a placeholder — the real link ID is minted only at issuance.
                  </p>
                </>
              ) : (
                <p className="muted">Select a campaign to generate the URL preview.</p>
              )}

              {preview.utm ? (
                <>
                  <h3>Generated UTM parameters</h3>
                  <div className="table-wrap">
                    <table>
                      <tbody>
                        {Object.entries(preview.utm).map(([k, v]) => (
                          <tr key={k}>
                            <th scope="row" className="mono">
                              {k}
                            </th>
                            <td className="mono">{v ?? <span className="muted">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}

              <h3>Validation</h3>
              {preview.validation.findings.length === 0 ? (
                <Msg kind="success">All checks passed.</Msg>
              ) : (
                <FindingList findings={preview.validation.findings} />
              )}

              {exact ? (
                <div>
                  <h3>Exact duplicate</h3>
                  <Msg kind="error">
                    An identical governed link already exists:{" "}
                    <Link href={`/registry/links/${exact.linkId}`} className="mono">
                      {exact.linkId}
                    </Link>
                  </Msg>
                  <div className="final-url mono">{exact.finalUrl}</div>
                  <div className="btn-row">
                    {canWrite ? (
                      <button
                        type="button"
                        onClick={() => void reuseExisting(exact.linkId, exact.finalUrl)}
                      >
                        Reuse existing link
                      </button>
                    ) : null}
                    <CopyButton text={exact.finalUrl} label="Copy existing URL" />
                  </div>
                  <Msg kind="info">{reuseStatus}</Msg>
                  {reusedUrl ? (
                    <Msg kind="success">
                      <div className="final-url mono">{reusedUrl}</div>
                      <CopyButton text={reusedUrl} label="Copy URL" />
                    </Msg>
                  ) : null}
                  {isAdmin ? (
                    <div className="inline-form">
                      <div className="field">
                        <label htmlFor="override-reason">
                          Admin override — reason <span className="hint">(required, audited)</span>
                        </label>
                        <textarea
                          id="override-reason"
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn-danger btn-small"
                        disabled={!overrideReason.trim() || submitting !== ""}
                        onClick={() => void submit("issued", true)}
                      >
                        Issue anyway (override duplicate)
                      </button>
                    </div>
                  ) : (
                    <p className="hint">
                      Only authorized roles can override an exact duplicate. Reuse the existing
                      link instead.
                    </p>
                  )}
                </div>
              ) : null}

              {preview.duplicates.near.length > 0 ? (
                <div>
                  <h3>Near duplicates</h3>
                  <ul className="findings">
                    {preview.duplicates.near.map((n) => (
                      <li key={n.linkId} className="finding-warning">
                        <Link href={`/registry/links/${n.linkId}`} className="mono">
                          {n.linkId}
                        </Link>{" "}
                        ({n.kind}) <span className="mono small">{n.finalUrl}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
