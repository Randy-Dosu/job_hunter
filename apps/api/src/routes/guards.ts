/**
 * Route guards.
 *
 * `requireUser` is used in every private handler. Ownership is always enforced by
 * filtering on `userId` in the query itself — never by checking an id after load,
 * which is where cross-user leaks creep in.
 */

import type { FastifyRequest } from 'fastify';
import { errors } from '../lib/errors.js';

export interface RequestUser {
  userId: string;
  email: string;
  role: string;
}

export function requireUser(request: FastifyRequest): RequestUser {
  if (!request.auth) throw errors.unauthorized();
  return request.auth as RequestUser;
}

export function requireAdmin(request: FastifyRequest): RequestUser {
  const user = requireUser(request);
  if (user.role !== 'admin') throw errors.forbidden('Administrator access is required');
  return user;
}

/** Coarse feature gate used by browser assistance and notifications. */
export function requireFeature(enabled: boolean, name: string): void {
  if (!enabled) {
    throw errors.featureDisabled(`${name} is not enabled on this deployment.`);
  }
}
