"use strict";

/**
 * Account admin CLI.
 *
 *   node scripts/users.js list
 *   node scripts/users.js set-password <email> <new-password>
 *   node scripts/users.js promote <email> <citizen|authority|admin> [authorityId]
 *
 * Passwords are stored as one-way scrypt hashes, so there is no "show password"
 * command — there is nothing to show. If someone is locked out, set a new one.
 */

const path = require("path");
try { process.loadEnvFile(path.join(__dirname, "..", ".env")); } catch { /* optional */ }

const db = require("../db");
const { hashPassword, ROLES } = require("../auth");

const [command, ...args] = process.argv.slice(2);

const usage = () => {
  console.log(`
Usage:
  node scripts/users.js list
  node scripts/users.js set-password <email> <new-password>
  node scripts/users.js promote <email> <${ROLES.join("|")}> [authorityId]
`.trim());
};

function list() {
  const rows = db.listUsers();
  if (!rows.length) return console.log("No accounts yet. Start the server once to seed the demo accounts.");

  const width = Math.max(...rows.map((r) => r.email.length), 5);
  console.log(`${"EMAIL".padEnd(width)}  ${"ROLE".padEnd(10)}  ${"ORG".padEnd(10)}  NAME`);
  console.log("-".repeat(width + 40));
  for (const r of rows) {
    console.log(`${r.email.padEnd(width)}  ${r.role.padEnd(10)}  ${(r.authorityId || "—").padEnd(10)}  ${r.name}`);
  }
  console.log(`\n${rows.length} account(s). Passwords are hashed and cannot be displayed.`);
}

async function setPassword(email, password) {
  if (!email || !password) return usage();
  if (password.length < 8) return console.error("Password must be at least 8 characters.");

  const user = db.findUserForLogin(String(email).toLowerCase());
  if (!user) return console.error(`No account found for ${email}.`);

  db.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(password), user.id);
  // Existing sessions outlive a password change unless they're cleared.
  const { changes } = db.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
  db.addAudit("Password reset", `Password changed for ${user.email} via the admin CLI.`, "CLI");

  console.log(`Password updated for ${user.email}.`);
  console.log(`${changes} active session(s) signed out.`);
}

function promote(email, role, authorityId) {
  if (!email || !ROLES.includes(role)) return usage();

  const user = db.findUserForLogin(String(email).toLowerCase());
  if (!user) return console.error(`No account found for ${email}.`);

  if (role === "authority") {
    const ids = db.listAuthorities().map((a) => a.id);
    if (!ids.includes(authorityId)) return console.error(`Pass an authority id: ${ids.join(", ")}`);
  }

  db.db.prepare("UPDATE users SET role = ?, authority_id = ? WHERE id = ?")
    .run(role, role === "authority" ? authorityId : null, user.id);
  db.addAudit("Role changed", `${user.email} is now ${role}${authorityId ? ` (${authorityId})` : ""}.`, "CLI");

  console.log(`${user.email} is now ${role}${role === "authority" ? ` for ${authorityId}` : ""}.`);
}

(async () => {
  switch (command) {
    case "list": return list();
    case "set-password": return setPassword(args[0], args[1]);
    case "promote": return promote(args[0], args[1], args[2]);
    default: return usage();
  }
})();
