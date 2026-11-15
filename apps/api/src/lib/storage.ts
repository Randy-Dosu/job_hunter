/**
 * Private file storage.
 *
 * Resumes are personal data. Files are never served from a public URL: the API
 * streams them after an ownership check (`download`). Two drivers:
 *  - `local`    filesystem directory outside the web root (development).
 *  - `supabase` private bucket via the service role (production free tier).
 *
 * Storage keys are opaque and namespaced by user id, so a key alone cannot be
 * guessed and cannot be replayed across users.
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';

export interface StoredFile {
  key: string;
  checksum: string;
  sizeBytes: number;
}

export interface FileStorage {
  put(input: {
    userId: string;
    fileName: string;
    buffer: Buffer;
    contentType: string;
  }): Promise<StoredFile>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Signed URL is only used by the supabase driver; local driver returns undefined. */
  signedUrl?(key: string, expiresInSeconds: number): Promise<string | undefined>;
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

function buildKey(userId: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const random = randomBytes(12).toString('hex');
  return `${userId}/${Date.now()}-${random}-${safeName}`;
}

export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(rootDirectory: string) {
    this.root = resolve(rootDirectory);
  }

  async put(input: {
    userId: string;
    fileName: string;
    buffer: Buffer;
    contentType: string;
  }): Promise<StoredFile> {
    const key = buildKey(input.userId, input.fileName);
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.buffer, { mode: 0o600 });
    return {
      key,
      checksum: createHash('sha256').update(input.buffer).digest('hex'),
      sizeBytes: input.buffer.length,
    };
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolveKey(key));
    } catch {
      throw new StorageError('File not found');
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolveKey(key));
    } catch {
      // Deleting a missing file is not an error: deletion must be idempotent.
    }
  }

  /** Path traversal defence: resolved path must stay inside the root. */
  private resolveKey(key: string): string {
    const candidate = resolve(join(this.root, normalize(key)));
    if (candidate !== this.root && !candidate.startsWith(this.root + sep)) {
      throw new StorageError('Invalid storage key');
    }
    return candidate;
  }
}

/** Supabase Storage driver (private bucket, service role key, server-side only). */
export class SupabaseFileStorage implements FileStorage {
  constructor(
    private readonly options: {
      url: string;
      serviceRoleKey: string;
      bucket: string;
      fetchImpl?: typeof globalThis.fetch | undefined;
    },
  ) {}

  private get fetch(): typeof globalThis.fetch {
    return this.options.fetchImpl ?? globalThis.fetch;
  }

  async put(input: {
    userId: string;
    fileName: string;
    buffer: Buffer;
    contentType: string;
  }): Promise<StoredFile> {
    const key = buildKey(input.userId, input.fileName);
    const response = await this.fetch(
      `${this.options.url}/storage/v1/object/${this.options.bucket}/${encodeURI(key)}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.serviceRoleKey}`,
          'content-type': input.contentType,
          'x-upsert': 'false',
        },
        body: new Uint8Array(input.buffer),
      },
    );
    if (!response.ok) {
      throw new StorageError(`Upload failed with status ${response.status}`);
    }
    return {
      key,
      checksum: createHash('sha256').update(input.buffer).digest('hex'),
      sizeBytes: input.buffer.length,
    };
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.fetch(
      `${this.options.url}/storage/v1/object/${this.options.bucket}/${encodeURI(key)}`,
      { headers: { authorization: `Bearer ${this.options.serviceRoleKey}` } },
    );
    if (!response.ok) throw new StorageError('File not found');
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    await this.fetch(
      `${this.options.url}/storage/v1/object/${this.options.bucket}/${encodeURI(key)}`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${this.options.serviceRoleKey}` },
      },
    ).catch(() => undefined);
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string | undefined> {
    const response = await this.fetch(
      `${this.options.url}/storage/v1/object/sign/${this.options.bucket}/${encodeURI(key)}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.serviceRoleKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: expiresInSeconds }),
      },
    ).catch(() => undefined);
    if (!response?.ok) return undefined;
    const payload = (await response.json().catch(() => ({}))) as { signedURL?: string };
    return payload.signedURL ? `${this.options.url}/storage/v1${payload.signedURL}` : undefined;
  }
}

export function createStorage(
  config:
    | { driver: 'local'; directory: string }
    | {
        driver: 'supabase';
        url: string;
        serviceRoleKey: string;
        bucket: string;
        fetchImpl?: typeof globalThis.fetch;
      },
): FileStorage {
  return config.driver === 'local'
    ? new LocalFileStorage(config.directory)
    : new SupabaseFileStorage(config);
}
