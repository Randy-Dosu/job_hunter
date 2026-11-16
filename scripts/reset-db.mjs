import fs from "node:fs";
import path from "node:path";

const file = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "job-hunter.db");
for (const suffix of ["", "-wal", "-shm"]) {
  const target = `${file}${suffix}`;
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
    console.log("removed", target);
  }
}
console.log("Database reset. A clean schema will be created on the next request — no accounts or listings are seeded.");
