/**
 * Browser session state machine + audit trail.
 *
 * Sessions are user-owned, expire, and record only minimal action metadata —
 * never page content, form values or cookies.
 */

import type {
  BrowserActionType,
  BrowserPauseReason,
  BrowserSessionStatus,
} from '@job-hunter/shared-types';

export interface BrowserSessionState {
  id: string;
  userId: string;
  jobId: string;
  applicationUrl: string;
  status: BrowserSessionStatus;
  pauseReason?: BrowserPauseReason | undefined;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  endedAt?: string | undefined;
  /** Minimal event log: action + timestamp + short note. No page content. */
  events: Array<{ action: BrowserActionType; at: string; detail?: string | undefined }>;
}

const ALLOWED_TRANSITIONS: Record<BrowserSessionStatus, BrowserSessionStatus[]> = {
  pending_consent: ['active', 'cancelled', 'expired'],
  active: ['paused_for_user', 'blocked', 'cancelled', 'expired'],
  paused_for_user: ['active', 'completed', 'cancelled', 'expired'],
  blocked: ['cancelled', 'expired'],
  completed: [],
  cancelled: [],
  expired: [],
};

export class SessionTransitionError extends Error {
  constructor(from: BrowserSessionStatus, to: BrowserSessionStatus) {
    super(`Cannot move browser session from ${from} to ${to}`);
    this.name = 'SessionTransitionError';
  }
}

export class SessionOwnershipError extends Error {
  constructor() {
    super('This browser session does not belong to you');
    this.name = 'SessionOwnershipError';
  }
}

export function createSession(input: {
  id: string;
  userId: string;
  jobId: string;
  applicationUrl: string;
  now?: Date | undefined;
  ttlMinutes?: number | undefined;
}): BrowserSessionState {
  const now = input.now ?? new Date();
  const ttl = (input.ttlMinutes ?? 60) * 60_000;
  return {
    id: input.id,
    userId: input.userId,
    jobId: input.jobId,
    applicationUrl: input.applicationUrl,
    status: 'pending_consent',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl).toISOString(),
    events: [],
  };
}

export function transition(
  session: BrowserSessionState,
  to: BrowserSessionStatus,
  options: {
    now?: Date | undefined;
    pauseReason?: BrowserPauseReason | undefined;
    actorId: string;
  },
): BrowserSessionState {
  if (session.userId !== options.actorId) throw new SessionOwnershipError();
  const now = options.now ?? new Date();
  if (isExpired(session, now) && to !== 'expired' && to !== 'cancelled') {
    return { ...session, status: 'expired', updatedAt: now.toISOString() };
  }
  if (!ALLOWED_TRANSITIONS[session.status].includes(to)) {
    throw new SessionTransitionError(session.status, to);
  }
  const event = eventForTransition(session.status, to);
  return {
    ...session,
    status: to,
    updatedAt: now.toISOString(),
    ...(to === 'paused_for_user' && options.pauseReason
      ? { pauseReason: options.pauseReason }
      : {}),
    ...(to === 'completed' || to === 'cancelled' || to === 'expired'
      ? { endedAt: now.toISOString() }
      : {}),
    events: [
      ...session.events,
      {
        action: event,
        at: now.toISOString(),
        ...(options.pauseReason ? { detail: options.pauseReason } : {}),
      },
    ],
  };
}

export function isExpired(session: BrowserSessionState, now = new Date()): boolean {
  return new Date(session.expiresAt).getTime() <= now.getTime();
}

/** Terminal states cannot be resumed; the UI hides the resume action. */
export function isTerminal(status: BrowserSessionStatus): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'expired';
}

/**
 * The audit action for a transition. The pause reason is recorded separately on
 * the event (see `transition`), so it is not needed here.
 */
function eventForTransition(
  from: BrowserSessionStatus,
  to: BrowserSessionStatus,
): BrowserActionType {
  if (to === 'active') return from === 'pending_consent' ? 'session_started' : 'resumed';
  if (to === 'paused_for_user') return 'paused';
  if (to === 'completed' || to === 'cancelled' || to === 'expired') return 'session_ended';
  if (to === 'blocked') return 'paused';
  return 'handed_off';
}

/** Session records returned to the client never include anything but metadata. */
export function toClientSession(session: BrowserSessionState): Omit<
  BrowserSessionState,
  'userId'
> & {
  canResume: boolean;
} {
  const { userId: _userId, ...rest } = session;
  return { ...rest, canResume: session.status === 'paused_for_user' && !isExpired(session) };
}
