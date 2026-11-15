/**
 * Typed application errors.
 *
 * Every error that may reach a client has a stable machine code and an HTTP
 * status. Internal details (stack traces, SQL, provider responses) are logged
 * server-side only.
 */

import { API_ERROR_CODES, type ApiErrorCode } from '@job-hunter/shared-types';

export class AppError extends Error {
  constructor(
    readonly code: ApiErrorCode | string,
    message: string,
    readonly statusCode: number,
    readonly details?: Record<string, string[]> | undefined,
    readonly expose = true,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  unauthorized: (message = 'You need to sign in to continue') =>
    new AppError(API_ERROR_CODES.unauthorized, message, 401),
  forbidden: (message = 'You do not have access to this resource') =>
    new AppError(API_ERROR_CODES.forbidden, message, 403),
  notFound: (message = 'Not found') => new AppError(API_ERROR_CODES.notFound, message, 404),
  conflict: (message: string) => new AppError(API_ERROR_CODES.conflict, message, 409),
  validation: (message: string, details?: Record<string, string[]>) =>
    new AppError(API_ERROR_CODES.validationFailed, message, 422, details),
  rateLimited: (message = 'Too many requests. Please wait and try again.') =>
    new AppError(API_ERROR_CODES.rateLimited, message, 429),
  payloadTooLarge: (message = 'That file is too large') =>
    new AppError(API_ERROR_CODES.payloadTooLarge, message, 413),
  unsupportedMedia: (message = 'That file type is not supported') =>
    new AppError(API_ERROR_CODES.unsupportedMediaType, message, 415),
  featureDisabled: (message: string) => new AppError(API_ERROR_CODES.featureDisabled, message, 403),
  aiUnavailable: (message = 'AI services are temporarily unavailable. Please try again shortly.') =>
    new AppError(API_ERROR_CODES.aiProviderUnavailable, message, 503),
  internal: (message = 'Something went wrong on our side') =>
    new AppError(API_ERROR_CODES.internal, message, 500, undefined, false),
};
