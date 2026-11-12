// Vite (used by Vitest) does not recognise the `node:sqlite` scheme, so tests
// resolve the builtin at runtime instead of through the bundler.
const mod = (process as unknown as { getBuiltinModule: (id: string) => unknown }).getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

export const DatabaseSync = mod.DatabaseSync;
export type DatabaseSync = import("node:sqlite").DatabaseSync;
export default mod;
