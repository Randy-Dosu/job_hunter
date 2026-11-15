/** HTTP envelope shared by the API and the web client. */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Field-level details for validation failures. */
    details?: Record<string, string[]> | undefined;
    requestId?: string | undefined;
  };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  time: string;
  checks: { name: string; ok: boolean; detail?: string | undefined }[];
}

/** Error codes used by the API; the UI maps them to friendly copy. */
export const API_ERROR_CODES = {
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  notFound: 'not_found',
  validationFailed: 'validation_failed',
  conflict: 'conflict',
  rateLimited: 'rate_limited',
  payloadTooLarge: 'payload_too_large',
  unsupportedMediaType: 'unsupported_media_type',
  aiProviderUnavailable: 'ai_provider_unavailable',
  aiInvalidOutput: 'ai_invalid_output',
  featureDisabled: 'feature_disabled',
  internal: 'internal_error',
} as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];
