/**
 * Wait until the development database accepts *usable* connections.
 *
 * `npm run dev` starts the database and the API concurrently, and PGlite needs a
 * moment to open its data directory. A bare TCP connect is not enough: the
 * socket server can accept a connection before it is ready to serve queries, and
 * then drop it ("Connection terminated unexpectedly"), which the migration step
 * reports as a failure even though nothing is wrong. So this performs the
 * startup handshake of the Postgres wire protocol (SSLRequest, then a
 * StartupMessage) and only reports ready once the server sends any response.
 */

const port = Number.parseInt(process.env.PGLITE_PORT ?? '5432', 10);
const host = process.env.PGLITE_HOST ?? '127.0.0.1';
const deadlineMs = Number.parseInt(process.env.DB_WAIT_TIMEOUT_MS ?? '60000', 10);
const startedAt = Date.now();

/** Postgres SSLRequest: length 8, code 80877103. */
const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]);

async function probe(): Promise<boolean> {
  const { connect } = await import('node:net');
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    let responded = false;
    const finish = (ok: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1_500);
    socket.once('connect', () => socket.write(SSL_REQUEST));
    // 'N' (SSL unsupported) or 'S' both prove the server is parsing startup
    // traffic; PGlite answers 'N'.
    socket.once('data', () => {
      responded = true;
      finish(true);
    });
    socket.once('close', () => finish(responded));
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
