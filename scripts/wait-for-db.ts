/**
 * Wait until the development database accepts connections.
 *
 * `npm run dev` starts the database and the API concurrently, and PGlite needs a
 * moment to open its data directory. Without this the API's first queries race
 * the listener and fail with "connection refused", which looks like an
 * application bug. Polls the port only — no credentials, no queries.
 */

const port = Number.parseInt(process.env.PGLITE_PORT ?? '5432', 10);
const host = process.env.PGLITE_HOST ?? '127.0.0.1';
const deadlineMs = Number.parseInt(process.env.DB_WAIT_TIMEOUT_MS ?? '60000', 10);
const startedAt = Date.now();

async function probe(): Promise<boolean> {
  const { connect } = await import('node:net');
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const finish = (ok: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1_000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

let attempt = 0;
for (;;) {
  attempt += 1;
  if (await probe()) {
    if (attempt > 1) console.log(`[wait-for-db] ready after ${attempt} attempts`);
    process.exit(0);
  }
  if (Date.now() - startedAt > deadlineMs) {
    console.error(
      `[wait-for-db] ${host}:${port} did not accept connections within ${deadlineMs}ms.\n` +
        'Is the database running? Start it with `npm run db:up`.',
    );
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
