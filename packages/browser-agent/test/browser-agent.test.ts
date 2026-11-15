import { describe, expect, it } from 'vitest';
import {
  assertNoSubmitCapability,
  buildSessionPlan,
  createSession,
  detectChallenge,
  explainAllowlistDecision,
  extractFormFields,
  isExpired,
  isTerminal,
  isUrlAllowed,
  mapFormFields,
  NoSubmitAssistant,
  preflightSession,
  SITE_ALLOWLIST,
  transition,
  type AllowedSite,
} from '../src/index.js';
import type { ApprovedProfileData } from '@job-hunter/shared-types';

const zola: AllowedSite = {
  host: 'zola-systems.test',
  displayName: 'Zola Systems careers',
  complianceNote: 'The posting provides a public application form; filling is manual-user led.',
  adapterId: 'generic',
  enabled: true,
};

const dependencies = (
  overrides: Partial<{ featureEnabled: boolean; allowlist: AllowedSite[] }> = {},
) => ({
  featureEnabled: true,
  allowlist: [zola],
  ...overrides,
});

const PROFILE: ApprovedProfileData = {
  contact: {
    fullName: 'Ama Mensah',
    firstName: 'Ama',
    lastName: 'Mensah',
    email: 'ama@example.test',
    phone: '+233200000000',
    location: 'Kumasi, Ghana',
  },
  headline: 'Senior Backend Engineer',
  summary: 'Backend engineer focused on payment systems.',
  skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
  mostRecentRole: { title: 'Senior Backend Engineer', company: 'Kente Pay' },
  answers: {},
};

const FORM_HTML = `<!doctype html>
<html><head><title>Apply — Zola Systems</title></head>
<body>
  <h1 id="job-title">Senior Backend Engineer</h1>
  <form id="application" action="https://jobs.zola-systems.test/apply/1/submit" method="post">
    <label for="first_name">First name *</label>
    <input id="first_name" name="first_name" type="text" required />
    <label for="email">Email address</label>
    <input id="email" name="email" type="email" required />
    <label for="phone">Phone</label>
    <input id="phone" name="phone" type="tel" />
    <label for="password">Create a password</label>
    <input id="password" name="password" type="password" />
    <label for="resume">Resume / CV</label>
    <input id="resume" name="resume" type="file" />
    <label for="cover">Cover letter</label>
    <textarea id="cover" name="cover_letter"></textarea>
    <label for="country">Country</label>
    <select id="country" name="country">
      <option value="">Select…</option>
      <option value="GH">Ghana</option>
    </select>
    <label for="sponsor">Do you require visa sponsorship?</label>
    <select id="sponsor" name="sponsor"><option>Yes</option><option>No</option></select>
    <input type="hidden" name="csrf" value="abc123" />
    <label for="consent">I agree to the privacy policy</label>
    <input id="consent" name="consent" type="checkbox" />
    <button type="submit">Submit application</button>
  </form>
</body></html>`;

describe('allowlist gating', () => {
  it('ships with no sites enabled by default', () => {
    expect(SITE_ALLOWLIST).toEqual([]);
  });

  it('denies every site when the allowlist is empty', () => {
    const decision = isUrlAllowed('https://jobs.zola-systems.test/apply/1');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('not_allowlisted');
      expect(explainAllowlistDecision(decision)).toMatch(/not on the assisted-filling allowlist/i);
    }
  });

  it('allows https URLs on allowlisted hosts and subdomains only', () => {
    const allowlist = [zola];
    expect(isUrlAllowed('https://jobs.zola-systems.test/apply/1', allowlist).allowed).toBe(true);
    expect(isUrlAllowed('https://zola-systems.test/apply/1', allowlist).allowed).toBe(true);
    expect(isUrlAllowed('https://evil.test/apply/1', allowlist).allowed).toBe(false);
    // Suffix attack: the allowed host appearing as a label must not pass.
    expect(isUrlAllowed('https://zola-systems.test.evil.test/apply/1', allowlist).allowed).toBe(
      false,
    );
    // Lookalike domain.
    expect(isUrlAllowed('https://notzola-systems.test/apply/1', allowlist).allowed).toBe(false);
  });

  it('rejects insecure schemes and malformed URLs', () => {
    const allowlist = [zola];
    const insecure = isUrlAllowed('http://jobs.zola-systems.test/apply/1', allowlist);
    expect(insecure.allowed).toBe(false);
    if (!insecure.allowed) expect(insecure.reason).toBe('insecure_scheme');

    const invalid = isUrlAllowed('not a url', allowlist);
    expect(invalid.allowed).toBe(false);
    if (!invalid.allowed) expect(invalid.reason).toBe('invalid_url');
  });

  it('respects a disabled allowlist entry', () => {
    const decision = isUrlAllowed('https://zola-systems.test/apply/1', [
      { ...zola, enabled: false },
    ]);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('disabled');
  });
});

describe('preflightSession — guards before any browser work', () => {
  const base = {
    sessionId: 'sess-1',
    jobId: 'job-1',
    applicationUrl: 'https://zola-systems.test/apply/1',
    consent: true,
    profile: PROFILE,
  };

  it('is disabled when the feature flag is off, even with consent', () => {
    const result = preflightSession(base, dependencies({ featureEnabled: false }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.name).toBe('FeatureDisabledError');
  });

  it('requires explicit consent', () => {
    const result = preflightSession({ ...base, consent: false }, dependencies());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/confirm/i);
  });

  it('refuses a non-allowlisted site', () => {
    const result = preflightSession(
      { ...base, applicationUrl: 'https://evil.test/apply' },
      dependencies(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.name).toBe('SiteNotAllowedError');
  });

  it('accepts an allowlisted, consented request', () => {
    const result = preflightSession(base, dependencies());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.site.displayName).toBe('Zola Systems careers');
  });
});

describe('field detection and mapping', () => {
  const parsed = () => extractFormFields(FORM_HTML);

  it('extracts fields and skips hidden/submit inputs', () => {
    const names = parsed().map((field) => field.name);
    expect(names).toContain('first_name');
    expect(names).toContain('email');
    expect(names).not.toContain('csrf');
    expect(names).not.toContain('');
  });

  it('reads labels, required flags and select options', () => {
    const fields = parsed();
    const firstName = fields.find((field) => field.name === 'first_name');
    expect(firstName?.label).toMatch(/first name/i);
    expect(firstName?.required).toBe(true);
    expect(firstName?.sensitive).toBe(false);

    const country = fields.find((field) => field.name === 'country');
    expect(country?.tag).toBe('select');
    expect(country?.options).toEqual(expect.arrayContaining(['Ghana']));
  });

  it('marks legal/eligibility questions as sensitive', () => {
    const sponsor = parsed().find((field) => field.name === 'sponsor');
    expect(sponsor?.sensitive).toBe(true);
  });

  it('fills known contact fields from the approved profile', () => {
    const descriptor = mapFormFields(parsed(), PROFILE);
    const firstName = descriptor.fields.find((field) => field.label.startsWith('First name'));
    expect(firstName?.value).toBe('Ama');
    expect(firstName?.source).toBe('contact');
    expect(firstName?.confidence).toBe('high');

    const email = descriptor.fields.find((field) => field.label.startsWith('Email'));
    expect(email?.value).toBe('ama@example.test');
  });

  it('never proposes a value for password, file or legal fields', () => {
    const descriptor = mapFormFields(parsed(), PROFILE);
    // Password inputs are dropped entirely rather than proposed as blank fields.
    expect(descriptor.fields.map((field) => field.label)).not.toContain('Create a password');

    const file = descriptor.fields.find((field) => field.type === 'file');
    expect(file?.value).toBeNull();
    expect(file?.sensitive).toBe(true);
    expect(file?.skippedReason).toMatch(/upload the file yourself/i);

    const sponsor = descriptor.fields.find((field) => field.label.includes('visa sponsorship'));
    expect(sponsor?.value).toBeNull();
    expect(sponsor?.sensitive).toBe(true);
    expect(sponsor?.skippedReason).toMatch(/answer this yourself/i);
  });

  it('counts unresolved fields so the user knows what is left', () => {
    const descriptor = mapFormFields(parsed(), PROFILE);
    expect(descriptor.unresolvedFieldCount).toBeGreaterThan(0);
    expect(descriptor.unresolvedFieldCount).toBe(
      descriptor.fields.filter((field) => field.value === null).length,
    );
  });

  it('uses the answer bank for a previously answered question', () => {
    const descriptor = mapFormFields(parsed(), {
      ...PROFILE,
      answers: { 'Do you require visa sponsorship?': 'No' },
    });
    const sponsor = descriptor.fields.find((field) => field.label.includes('visa sponsorship'));
    // Legal questions stay user-answered even when an answer is on file: the
    // answer bank is shown as a suggestion, never auto-applied.
    expect(sponsor?.sensitive).toBe(true);
    expect(sponsor?.value).toBeNull();
  });

  it('detects CAPTCHA, login walls, access restrictions and non-forms', () => {
    expect(detectChallenge('<form><div class="g-recaptcha"></div></form>')).toBe('captcha');
    expect(detectChallenge('<form><input type="password" name="pw"></form>')).toBe('login');
    expect(detectChallenge('<html>Access denied</html>')).toBe('access_restriction');
    expect(detectChallenge('<html><p>Nothing here</p></html>')).toBe('unsupported');
    expect(detectChallenge(FORM_HTML)).toBeUndefined();
  });
});

describe('session plan — hard stop before submission', () => {
  it('always pauses for the user and never plans a submit action', () => {
    const plan = buildSessionPlan({
      sessionId: 'sess-1',
      jobId: 'job-1',
      applicationUrl: 'https://zola-systems.test/apply/1',
      html: FORM_HTML,
      profile: PROFILE,
    });
    expect(plan.status).toBe('paused_for_user');
    expect(plan.pauseReason).toBe('user_review');
    expect(JSON.stringify(plan)).not.toMatch(/"submit"/);
  });

  it('explains why it paused when a challenge is present', () => {
    const plan = buildSessionPlan({
      sessionId: 'sess-2',
      jobId: 'job-1',
      applicationUrl: 'https://zola-systems.test/apply/1',
      html: '<html><form><div class="hcaptcha"></div></form></html>',
      profile: PROFILE,
    });
    expect(plan.pauseReason).toBe('captcha');
  });

  it('pauses for login rather than guessing credentials', () => {
    const plan = buildSessionPlan({
      sessionId: 'sess-3',
      jobId: 'job-1',
      applicationUrl: 'https://zola-systems.test/apply/1',
      html: '<html><form><input type="password" name="pw" /></form></html>',
      profile: PROFILE,
    });
    expect(plan.pauseReason).toBe('login_required');
  });
});

describe('assistant surface', () => {
  const assistant = new NoSubmitAssistant('generic', dependencies());

  it('has no submission capability anywhere on its surface', () => {
    expect(() => assertNoSubmitCapability(assistant)).not.toThrow();
  });

  it('fails the guard if a submit method is ever added', () => {
    class Rogue {
      submit(): void {
        /* forbidden */
      }
    }
    expect(() => assertNoSubmitCapability(new Rogue())).toThrow(/forbidden submission capability/i);
  });

  it('cannot handle a non-allowlisted URL', () => {
    expect(assistant.canHandle('https://evil.test/apply')).toBe(false);
    expect(assistant.canHandle('https://zola-systems.test/apply/1')).toBe(true);
  });

  it('plans only paused sessions', () => {
    const form = assistant.describeForm(FORM_HTML, PROFILE);
    const plan = assistant.planSession({
      sessionId: 's',
      jobId: 'j',
      applicationUrl: 'https://zola-systems.test/apply/1',
      form,
    });
    expect(plan.status).toBe('paused_for_user');
    expect(form.fields.length).toBeGreaterThan(0);
  });

  it('is disabled entirely when the feature flag is off', () => {
    const off = new NoSubmitAssistant('generic', dependencies({ featureEnabled: false }));
    expect(off.canHandle('https://zola-systems.test/apply/1')).toBe(false);
  });
});

describe('session state machine', () => {
  const base = () =>
    createSession({
      id: 'sess-1',
      userId: 'user-1',
      jobId: 'job-1',
      applicationUrl: 'https://zola-systems.test/apply/1',
      now: new Date('2026-11-13T10:00:00Z'),
      ttlMinutes: 60,
    });

  it('starts pending consent and expires after the TTL', () => {
    const session = base();
    expect(session.status).toBe('pending_consent');
    expect(isExpired(session, new Date('2026-11-13T10:59:00Z'))).toBe(false);
    expect(isExpired(session, new Date('2026-11-13T11:01:00Z'))).toBe(true);
  });

  it('walks the documented happy path to completed', () => {
    const actorId = 'user-1';
    const clock = (minutes: number) =>
      new Date(new Date('2026-11-13T10:00:00Z').getTime() + minutes * 60_000);
    let session = transition(base(), 'active', { actorId, now: clock(1) });
    session = transition(session, 'paused_for_user', {
      actorId,
      pauseReason: 'user_review',
      now: clock(2),
    });
    expect(session.pauseReason).toBe('user_review');
    session = transition(session, 'completed', { actorId, now: clock(3) });
    expect(session.status).toBe('completed');
    expect(session.endedAt).toBeTruthy();
    expect(isTerminal(session.status)).toBe(true);
  });

  it('rejects skipping the consent and review steps', () => {
    const actorId = 'user-1';
    expect(() =>
      transition(base(), 'completed', { actorId, now: new Date('2026-11-13T10:01:00Z') }),
    ).toThrow(/Cannot move browser session/);
    const active = transition(base(), 'active', { actorId, now: new Date('2026-11-13T10:01:00Z') });
    expect(() =>
      transition(active, 'completed', { actorId, now: new Date('2026-11-13T10:02:00Z') }),
    ).toThrow(/Cannot move browser session/);
  });

  it('treats an expired session transition as expired', () => {
    const actorId = 'user-1';
    const stale = base();
    const result = transition(stale, 'active', { actorId, now: new Date('2026-11-13T12:00:00Z') });
    expect(result.status).toBe('expired');
  });

  it('refuses to act on another user’s session', () => {
    expect(() => transition(base(), 'active', { actorId: 'user-2' })).toThrow(
      /does not belong to you/,
    );
  });
});
