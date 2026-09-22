"use client";

/**
 * Shared client components: Nav (with dev identity switcher), Badge,
 * CopyButton, status messages, validation finding lists, and pagination.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, errText, type Finding, type Session, type SessionCapabilities } from "./lib";

// ------------------------------------------------------------ useSession

const NO_CAPABILITIES: SessionCapabilities = {
  canWrite: false,
  canIssue: false,
  canCreateCampaign: false,
  canCreateInitiative: false,
  canReadAudit: false,
  canAdminister: false,
};

export function useSession(): {
  session: Session | null;
  capabilities: SessionCapabilities;
  authProvider: string;
  loading: boolean;
} {
  const [session, setSession] = useState<Session | null>(null);
  const [capabilities, setCapabilities] = useState<SessionCapabilities>(NO_CAPABILITIES);
  const [authProvider, setAuthProvider] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    api<{ session: Session | null; capabilities: SessionCapabilities; authProvider: string }>("/api/session")
      .then((d) => {
        if (!cancelled) {
          setSession(d.session);
          setCapabilities(d.capabilities);
          setAuthProvider(d.authProvider);
        }
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { session, capabilities, authProvider, loading };
}

// ------------------------------------------------------------------- Nav

const NAV_ITEMS: [string, string, keyof SessionCapabilities | null][] = [
  ["/", "Builder", null],
  ["/bulk", "Bulk", "canWrite"],
  ["/registry", "Registry", null],
  ["/initiatives", "Initiatives", null],
  ["/settings/access-tokens", "API access", null],
  ["/admin", "Admin", "canAdminister"],
  ["/admin/audit", "Audit", "canReadAudit"],
];

const DEV_IDENTITIES = [
  "dev-admin@runpod.io",
  "dev-user@runpod.io",
  "dev-investigator@runpod.io",
];

export function Nav() {
  const pathname = usePathname() ?? "/";
  const { session, capabilities, authProvider, loading } = useSession();
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState("");

  // Longest matching prefix wins so /admin/audit doesn't also light up /admin.
  const activeHref = NAV_ITEMS.reduce<string>((best, [href]) => {
    const matches = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    return matches && href.length > best.length ? href : best;
  }, "");

  const switchIdentity = useCallback(async (email: string) => {
    if (!email) return;
    setSwitching(true);
    setSwitchError("");
    try {
      await api("/api/session", { method: "POST", body: JSON.stringify({ email }) });
      window.location.reload();
    } catch (err) {
      setSwitchError(errText(err));
      setSwitching(false);
    }
  }, []);

  const resetIdentity = useCallback(async () => {
    setSwitching(true);
    setSwitchError("");
    try {
      await api("/api/session", { method: "DELETE" });
      window.location.reload();
    } catch (err) {
      setSwitchError(errText(err));
      setSwitching(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setSwitching(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/";
    }
  }, []);

  const isOidc = authProvider === "google" || authProvider === "oidc";
  const isPoc = authProvider === "poc";
  const [pocEmail, setPocEmail] = useState("");
  const pocSignIn = useCallback(async () => {
    if (!pocEmail.trim()) return;
    setSwitching(true);
    setSwitchError("");
    try {
      await api("/api/auth/poc-login", { method: "POST", body: JSON.stringify({ email: pocEmail.trim() }) });
      window.location.reload();
    } catch (err) {
      setSwitchError(errText(err));
      setSwitching(false);
    }
  }, [pocEmail]);
  // Surface coarse sign-in errors passed back from the OIDC callback.
  const authErrorCode =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("auth_error")
      : null;
  const authErrorText =
    authErrorCode === "no_account"
      ? "Your Google account is not provisioned in the UTM registry. Ask an administrator to add you."
      : authErrorCode === "domain_not_allowed"
        ? "Sign-in is restricted to Runpod work accounts."
        : authErrorCode
          ? "Sign-in failed. Try again or contact an administrator."
          : "";

  const visibleNavItems = NAV_ITEMS.filter(([, , capability]) => !capability || capabilities[capability]);

  const identities = session && !DEV_IDENTITIES.includes(session.email)
    ? [session.email, ...DEV_IDENTITIES]
    : DEV_IDENTITIES;

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link href="/" className="nav-brand">
          Runpod UTM Registry
        </Link>
        {visibleNavItems.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className={`nav-link${href === activeHref ? " active" : ""}`}
            aria-current={href === activeHref ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
        <span className="nav-spacer" />
        <div className="identity">
          {loading ? (
            <span aria-live="polite">Loading identity…</span>
          ) : session && (isOidc || isPoc) ? (
            <>
              <span className="role-chip">{session.role}</span>
              <span>{session.email}</span>
              <button type="button" className="btn-small" disabled={switching} onClick={() => void signOut()}>
                Sign out
              </button>
            </>
          ) : session ? (
            <>
              <span className="role-chip">{session.role}</span>
              <label htmlFor="identity-switcher" className="hint" style={{ margin: 0 }}>
                Identity
              </label>
              <select
                id="identity-switcher"
                value={session.email}
                disabled={switching}
                onChange={(e) => void switchIdentity(e.target.value)}
              >
                {identities.map((email) => (
                  <option key={email} value={email}>
                    {email}
                  </option>
                ))}
              </select>
            </>
          ) : isOidc ? (
            <>
              {authErrorText ? (
                <span role="alert" className="small" style={{ color: "var(--err)" }}>
                  {authErrorText}
                </span>
              ) : null}
              <a className="btn-small" href="/api/auth/login">
                Sign in with Google
              </a>
            </>
          ) : isPoc ? (
            <>
              <span className="hint" style={{ margin: 0 }}>POC — sign in</span>
              <input
                type="email"
                aria-label="Work email"
                placeholder="you@runpod.io"
                value={pocEmail}
                disabled={switching}
                onChange={(e) => setPocEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void pocSignIn();
                }}
              />
              <button type="button" className="btn-small" disabled={switching} onClick={() => void pocSignIn()}>
                Sign in
              </button>
            </>
          ) : authProvider === "dev" ? (
            <>
              <span>No session.</span>
              <button
                type="button"
                className="btn-small"
                disabled={switching}
                onClick={() => void resetIdentity()}
              >
                Reset local identity
              </button>
            </>
          ) : (
            <span>No authenticated session.</span>
          )}
          {switchError ? (
            <span role="alert" className="small" style={{ color: "var(--err)" }}>
              {switchError}
            </span>
          ) : null}
        </div>
      </div>
    </header>
  );
}

// ----------------------------------------------------------------- Badge

const BADGE_TONES: Record<string, string> = {
  issued: "ok",
  synced: "ok",
  succeeded: "ok",
  verified: "ok",
  active: "ok",
  approved: "ok",
  passed_syntactic: "ok",
  completed: "ok",
  passed: "ok",
  draft: "muted",
  pending: "muted",
  planned: "muted",
  unvalidated: "muted",
  retired: "muted",
  disabled: "muted",
  archived: "muted",
  inactive: "muted",
  processing: "info",
  syncing: "info",
  info: "info",
  exception: "warn",
  warnings: "warn",
  warning: "warn",
  completed_with_errors: "warn",
  deprecated: "warn",
  skipped_duplicate: "warn",
  detached: "warn",
  failed: "err",
  dead: "err",
  error: "err",
};

export function Badge({ value, children }: { value: string; children?: ReactNode }) {
  const tone = BADGE_TONES[value] ?? "muted";
  return <span className={`badge badge-${tone}`}>{children ?? value.replace(/_/g, " ")}</span>;
}

// ------------------------------------------------------------ CopyButton

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API unavailable (e.g. insecure context): fall back.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [text]);
  return (
    <button type="button" className="btn-small" onClick={() => void copy()}>
      <span aria-live="polite">{copied ? "Copied" : label ?? "Copy"}</span>
    </button>
  );
}

// -------------------------------------------------------------- messages

export function Msg({
  kind,
  children,
}: {
  kind: "error" | "success" | "info";
  children: ReactNode;
}) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div
      className={`msg msg-${kind}`}
      role={kind === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {children}
    </div>
  );
}

export function FindingList({ findings }: { findings: Finding[] }) {
  if (!findings.length) return null;
  return (
    <ul className="findings" aria-live="polite">
      {findings.map((f, i) => (
        <li key={`${f.code}-${f.field ?? ""}-${i}`} className={`finding-${f.severity}`}>
          <strong>{f.severity === "error" ? "Error" : "Warning"}</strong>
          {f.field ? <span className="mono"> [{f.field}]</span> : null} {f.message}
        </li>
      ))}
    </ul>
  );
}

// ----------------------------------------------------------------- Pager

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <button type="button" className="btn-small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Previous
      </button>
      <span aria-live="polite">
        Page {page} of {pages} ({total} total)
      </span>
      <button
        type="button"
        className="btn-small"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next →
      </button>
    </div>
  );
}

// ---------------------------------------------------------- JSON details

export function JsonDetails({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  return (
    <details className="json-details">
      <summary>{label}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
