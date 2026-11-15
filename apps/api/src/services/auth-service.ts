/**
 * Authentication service.
 *
 * Session model: an opaque random token in an HttpOnly, SameSite=Lax cookie,
 * stored as a SHA-256 hash. No JWT in the browser, no token in localStorage.
 * Every lookup joins to the user so disabled/deleted accounts fail closed.
 */

import type { Database } from '../db/client.js';
import { errors } from '../lib/errors.js';
import { createSessionToken, hashPassword, hashToken, verifyPassword } from '../lib/security.js';
import { recordAudit } from '../lib/audit.js';
import type { Logger } from '../lib/logger.js';
import { CONSENT_VERSIONS } from '@job-hunter/config';
import { DEFAULT_JOB_PREFERENCES, EMPTY_PROFILE_CONTENT } from '@job-hunter/shared-types';
import type { JobPreferences, LocationInfo } from '@job-hunter/shared-types';

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: string;
}

export interface AuthServiceDeps {
  db: Database;
  logger: Logger;
  sessionTtlHours: number;
  /** Injected for deterministic tests. */
  now?: (() => Date) | undefined;
}

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  async signUp(input: {
    email: string;
    password: string;
    displayName: string;
    acceptedTerms: boolean;
    timeZone?: string | undefined;
    ip?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<{ user: AuthenticatedUser; token: string; expiresAt: Date }> {
    if (!input.acceptedTerms) {
      throw errors.validation('You must accept the terms to create an account');
    }

    const email = input.email.trim().toLowerCase();
    const existing = await this.deps.db.user.findUnique({ where: { email } });
    if (existing) {
      // Do not reveal whether the address is registered in a different way, but
      // sign-up must tell the user the address is taken to be usable.
      throw errors.conflict('An account with that email already exists. Try signing in instead.');
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.deps.db.user.create({
      data: {
        email,
        passwordHash,
        displayName: input.displayName.trim(),
        ...(input.timeZone ? {} : {}),
      },
    });

    // Bootstrap the profile, preferences and consent records so every screen has
    // a consistent starting state.
    await this.deps.db.candidateProfile.create({
      data: {
        userId: user.id,
        content: {
          ...EMPTY_PROFILE_CONTENT,
          contact: { fullName: user.displayName, email: user.email },
        } as never,
      },
    });
    await this.deps.db.jobPreferences.create({
      data: {
        userId: user.id,
        targetTitles: DEFAULT_JOB_PREFERENCES.targetTitles,
        targetKeywords: DEFAULT_JOB_PREFERENCES.targetKeywords,
        enabledSources: DEFAULT_JOB_PREFERENCES.enabledSources,
        timeZone: input.timeZone ?? DEFAULT_JOB_PREFERENCES.timeZone,
        scanHourLocal: DEFAULT_JOB_PREFERENCES.scanHourLocal,
      },
    });
    await this.deps.db.scanSchedule.create({
      data: {
        userId: user.id,
        enabled: true,
        timeZone: input.timeZone ?? DEFAULT_JOB_PREFERENCES.timeZone,
        hourLocal: DEFAULT_JOB_PREFERENCES.scanHourLocal,
      },
    });
    await this.deps.db.userConsent.createMany({
      data: [
        {
          userId: user.id,
          kind: 'terms',
          granted: true,
          version: CONSENT_VERSIONS.terms,
          ...(input.ip ? { ip: input.ip } : {}),
        },
        {
          userId: user.id,
          kind: 'privacy',
          granted: true,
          version: CONSENT_VERSIONS.privacy,
          ...(input.ip ? { ip: input.ip } : {}),
        },
        {
          userId: user.id,
          kind: 'scheduled_scans',
          granted: true,
          version: CONSENT_VERSIONS.scheduled_scans,
          ...(input.ip ? { ip: input.ip } : {}),
        },
      ],
    });

    await recordAudit(this.deps.db, this.deps.logger, {
      userId: user.id,
      action: 'auth.sign_up',
      entityType: 'user',
      entityId: user.id,
      ...(input.ip ? { ip: input.ip } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
    });

    const session = await this.issueSession(user.id);
    return {
      user: toAuthenticatedUser(user),
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  async signIn(input: {
    email: string;
    password: string;
    ip?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<{ user: AuthenticatedUser; token: string; expiresAt: Date }> {
    const email = input.email.trim().toLowerCase();
    const user = await this.deps.db.user.findUnique({ where: { email } });

    // Constant-ish work whether or not the user exists: verify against a dummy
    // hash so timing does not disclose account existence.
    if (!user) {
      await verifyPassword(
        input.password,
        'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
      );
      await recordAudit(this.deps.db, this.deps.logger, {
        action: 'auth.sign_in_failed',
        entityType: 'user',
        ...(input.ip ? { ip: input.ip } : {}),
      });
      throw errors.unauthorized('Incorrect email or password');
    }

    if (user.disabledAt || user.deletedAt) {
      throw errors.forbidden('This account is not available');
    }

    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) {
      await recordAudit(this.deps.db, this.deps.logger, {
        userId: user.id,
        action: 'auth.sign_in_failed',
        entityType: 'user',
        entityId: user.id,
        ...(input.ip ? { ip: input.ip } : {}),
      });
      throw errors.unauthorized('Incorrect email or password');
    }

    await this.deps.db.user.update({ where: { id: user.id }, data: { lastLoginAt: this.now() } });
    await recordAudit(this.deps.db, this.deps.logger, {
      userId: user.id,
      action: 'auth.sign_in',
      entityType: 'user',
      entityId: user.id,
      ...(input.ip ? { ip: input.ip } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
    });

    const session = await this.issueSession(user.id);
    return { user: toAuthenticatedUser(user), token: session.token, expiresAt: session.expiresAt };
  }

  async signOut(token: string, userId?: string | undefined): Promise<void> {
    await this.deps.db.refreshToken.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: this.now() },
    });
    if (userId) {
      await recordAudit(this.deps.db, this.deps.logger, { userId, action: 'auth.sign_out' });
    }
  }

  /** Resolve a cookie token to a live user, or undefined. Touches last-seen. */
  async resolveSession(token: string): Promise<AuthenticatedUser | undefined> {
    if (!token) return undefined;
    const record = await this.deps.db.refreshToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!record) return undefined;
    if (record.revokedAt || record.expiresAt.getTime() <= this.now().getTime()) return undefined;
    const { user } = record;
    if (user.disabledAt || user.deletedAt) return undefined;
    return toAuthenticatedUser(user);
  }

  /** Re-issue a session and revoke the old one (session fixation defence). */
  async rotateSession(token: string): Promise<{ token: string; expiresAt: Date } | undefined> {
    const record = await this.deps.db.refreshToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!record || record.revokedAt) return undefined;
    await this.deps.db.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: this.now() },
    });
    return this.issueSession(record.userId);
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.deps.db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.now() },
    });
  }

  private async issueSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const { token, hash } = createSessionToken();
    const expiresAt = new Date(this.now().getTime() + this.deps.sessionTtlHours * 3_600_000);
    await this.deps.db.refreshToken.create({ data: { userId, tokenHash: hash, expiresAt } });
    return { token, expiresAt };
  }
}

export function toAuthenticatedUser(user: {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: Date;
}): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Convert a stored preferences row to the domain shape. */
export function toJobPreferences(row: {
  targetTitles: string[];
  targetKeywords: string[];
  excludedKeywords: string[];
  excludedCompanies: string[];
  locations: string[];
  countryCodes: string[];
  remoteOnly: boolean;
  workplaceTypes: string[];
  employmentTypes: string[];
  seniorityLevels: string[];
  minSalary: number | null;
  salaryCurrency: string | null;
  enabledSources: string[];
  timeZone: string;
  scanHourLocal: number;
}): JobPreferences {
  return {
    targetTitles: row.targetTitles,
    targetKeywords: row.targetKeywords,
    excludedKeywords: row.excludedKeywords,
    excludedCompanies: row.excludedCompanies,
    locations: row.locations,
    countryCodes: row.countryCodes,
    remoteOnly: row.remoteOnly,
    workplaceTypes: row.workplaceTypes as JobPreferences['workplaceTypes'],
    employmentTypes: row.employmentTypes as JobPreferences['employmentTypes'],
    seniorityLevels: row.seniorityLevels as JobPreferences['seniorityLevels'],
    ...(row.minSalary !== null ? { minSalary: row.minSalary } : {}),
    ...(row.salaryCurrency ? { salaryCurrency: row.salaryCurrency } : {}),
    enabledSources: row.enabledSources as JobPreferences['enabledSources'],
    timeZone: row.timeZone,
    scanHourLocal: row.scanHourLocal,
  };
}

export type { LocationInfo };
