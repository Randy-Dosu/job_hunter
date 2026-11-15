/**
 * Structured JSON logger with redaction.
 *
 * Security requirement: logs must never contain passwords, tokens, cookies,
 * API keys or full CV text. Redaction happens here, at the single choke point.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'newpassword',
  'currentpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'tokenhash',
  'authorization',
  'cookie',
  'set-cookie',
  'apikey',
  'api_key',
  'secret',
  'jwt_secret',
  'service_role_key',
  'resume',
  'resumetext',
  'cvtext',
  'content',
]);

const MAX_STRING = 500;

export interface LogContext {
  requestId?: string | undefined;
  userId?: string | undefined;
  route?: string | undefined;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(bindings: LogContext): Logger;
}

export function createLogger(
  options: { level?: LogLevel | undefined; bindings?: LogContext | undefined } = {},
): Logger {
  const level = options.level ?? 'info';
  const bindings = options.bindings ?? {};

  const emit = (logLevel: LogLevel, message: string, context?: LogContext): void => {
    if (LEVEL_ORDER[logLevel] < LEVEL_ORDER[level]) return;
    const payload = {
      level: logLevel,
      time: new Date().toISOString(),
      msg: redactValue(message),
      ...(redact(merge(bindings, context ?? {})) as Record<string, unknown>),
    };
    const line = JSON.stringify(payload);
    if (logLevel === 'error') console.error(line);
    else if (logLevel === 'warn') console.warn(line);
    else console.log(line);
  };

  return {
    debug: (message, context) => emit('debug', message, context),
    info: (message, context) => emit('info', message, context),
    warn: (message, context) => emit('warn', message, context),
    error: (message, context) => emit('error', message, context),
    child: (childBindings) => createLogger({ level, bindings: merge(bindings, childBindings) }),
  };
}

function merge(a: LogContext, b: LogContext): LogContext {
  return { ...a, ...b };
}

export function redact(input: unknown, depth = 0): unknown {
  if (input === null || input === undefined) return input;
  if (depth > 4) return '[depth-limit]';
  if (typeof input === 'string') return redactValue(input);
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (input instanceof Error) {
    return { name: input.name, message: redactValue(input.message) };
  }
  if (Array.isArray(input)) return input.slice(0, 20).map((item) => redact(item, depth + 1));
  if (typeof input === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        result[key] = '[redacted]';
        continue;
      }
      result[key] = redact(value, depth + 1);
    }
    return result;
  }
  return String(input);
}

/** Trim long strings and scrub anything that looks like a secret. */
function redactValue(value: string): string {
  return value
    .replace(/(bearer\s+)[a-z0-9._-]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|token|secret|password)=)[^\s&]+/gi, '$1[redacted]')
    .replace(/\b(sk|pk)_(live|test)_[a-z0-9]+/gi, '[redacted-key]')
    .replace(/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, '[redacted-jwt]')
    .slice(0, MAX_STRING);
}

export const nullLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => nullLogger,
};
