/**
 * Site allowlist.
 *
 * The assistant only ever runs against hosts listed here. Adding a host is a
 * deliberate act that requires a compliance review note — this module refuses to
 * resolve a host without one, and an empty allowlist means the whole feature is
 * off (the default in this repository).
 */

export interface AllowedSite {
  /** Registrable domain we permit. Subdomains are covered by `*`. */
  host: string;
  displayName: string;
  /** Why automation is permitted (e.g. the ATS provides a documented apply flow). */
  complianceNote: string;
  /** Adapter that understands this site's form markup. */
  adapterId: string;
  enabled: boolean;
}

/**
 * Intentionally empty: browser assistance ships *off*. Enabling a site requires
 * recording the review in docs/source-compliance-register.md first, then adding
 * the entry here with the same note.
 */
export const SITE_ALLOWLIST: AllowedSite[] = [];

export type AllowlistDecision =
  | { allowed: true; site: AllowedSite }
  | { allowed: false; reason: 'not_allowlisted' | 'disabled' | 'invalid_url' | 'insecure_scheme' };

/** Return the registrable-ish host used for matching (strips www and ports). */
export function hostKeyOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return undefined;
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

export function matchHost(host: string, allowedHost: string): boolean {
  const allowed = allowedHost.toLowerCase().replace(/^www\./, '');
  return host === allowed || host.endsWith(`.${allowed}`);
}

export function isUrlAllowed(
  url: string,
  allowlist: readonly AllowedSite[] = SITE_ALLOWLIST,
): AllowlistDecision {
  const host = hostKeyOf(url);
  if (!host) {
    // Distinguish http (insecure) from malformed for better error copy.
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return { allowed: false, reason: 'insecure_scheme' };
    } catch {
      /* fallthrough */
    }
    return { allowed: false, reason: 'invalid_url' };
  }

  const site = allowlist.find((entry) => matchHost(host, entry.host));
  if (!site) return { allowed: false, reason: 'not_allowlisted' };
  if (!site.enabled) return { allowed: false, reason: 'disabled' };
  return { allowed: true, site };
}

/** Human-readable message for the UI when a URL cannot be assisted. */
export function explainAllowlistDecision(decision: AllowlistDecision): string {
  if (decision.allowed) return `Assisted filling is available for ${decision.site.displayName}.`;
  switch (decision.reason) {
    case 'not_allowlisted':
      return 'This site is not on the assisted-filling allowlist. You can still apply manually and track it here.';
    case 'disabled':
      return 'Assisted filling is temporarily disabled for this site.';
    case 'insecure_scheme':
      return 'Only secure (https) application pages can be assisted.';
    case 'invalid_url':
      return 'That application URL could not be read.';
  }
}
