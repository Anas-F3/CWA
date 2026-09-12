"use strict";

/**
 * Prepare data/civic.db to be committed as demo seed data.
 *
 *   node scripts/snapshot-db.js          report only
 *   node scripts/snapshot-db.js --write  checkpoint + clear sessions
 *
 * Three things make a live SQLite file unsafe to commit as-is, and this fixes
 * all of them:
 *
 * 1. In WAL mode most recent writes live in civic.db-wal, not civic.db. Commit
 *    the .db alone and you ship a nearly empty database. A TRUNCATE checkpoint
 *    folds the log back into the main file so it stands on its own.
 * 2. The sessions table holds live login tokens. Committing them would let
 *    anyone with the repo sign in as those accounts until the tokens expire.
 * 3. Deleted rows leave their contents in free pages until the file is
 *    vacuumed, so "deleted" data can still be read out of a committed file.
 */

const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

const write = process.argv.includes("--write");
const dbFile = path.join(__dirname, "..", "data", "civic.db");

if (!fs.existsSync(dbFile)) {
  console.error(`No database at ${dbFile}. Run the server once first.`);
  process.exit(1);
}

const sizeOf = (file) => (fs.existsSync(file) ? fs.statSync(file).size : 0);
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

const db = new DatabaseSync(dbFile);
const count = (sql) => Number(db.prepare(sql).get().c);

console.log("Before:");
console.log(`  civic.db      ${kb(sizeOf(dbFile))}`);
console.log(`  civic.db-wal  ${kb(sizeOf(`${dbFile}-wal`))}  <- uncommitted writes live here`);

if (write) {
  const sessions = count("SELECT COUNT(*) AS c FROM sessions");
  db.prepare("DELETE FROM sessions").run();
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.exec("VACUUM");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  console.log(`\nCleared ${sessions} session token(s), checkpointed the log, vacuumed free pages.`);
}

console.log("\nContents:");
console.log(`  users        ${count("SELECT COUNT(*) AS c FROM users")}`);
console.log(`  complaints   ${count("SELECT COUNT(*) AS c FROM complaints")}`);
console.log(`  attachments  ${count("SELECT COUNT(*) AS c FROM attachments")} (${kb(count("SELECT COALESCE(SUM(size),0) AS c FROM attachments"))} of photos/audio/video)`);
console.log(`  messages     ${count("SELECT COUNT(*) AS c FROM case_messages")}`);
console.log(`  sessions     ${count("SELECT COUNT(*) AS c FROM sessions")}`);

console.log("\nAccounts that would be published:");
for (const u of db.prepare("SELECT email, role, phone FROM users ORDER BY role, email").all()) {
  console.log(`  ${u.email.padEnd(24)} ${u.role.padEnd(10)} ${u.phone || "-"}`);
}

db.close();

console.log("\nAfter:");
console.log(`  civic.db      ${kb(sizeOf(dbFile))}`);
console.log(`  civic.db-wal  ${kb(sizeOf(`${dbFile}-wal`))}`);

if (!write) {
  console.log("\nReport only. Re-run with --write to checkpoint and clear sessions.");
} else {
  console.log("\nReady to commit data/civic.db. Stop the server before committing,");
  console.log("or the next write will put the file back out of sync with the log.");
}
