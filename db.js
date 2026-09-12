"use strict";

/**
 * SQLite persistence for civic complaints.
 *
 * Uses node:sqlite (built into Node 22.5+, stable from Node 24) so the project
 * keeps its "clone and run, no native build step" property.
 */

const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const dbFile = path.join(dataDir, "civic.db");

const db = new DatabaseSync(dbFile);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS authorities (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  color         TEXT,
  areas         TEXT NOT NULL DEFAULT '[]',
  categories    TEXT NOT NULL DEFAULT '[]',
  contact_email TEXT
);

CREATE TABLE IF NOT EXISTS complaints (
  id                   TEXT PRIMARY KEY,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  channel              TEXT NOT NULL,
  source_label         TEXT,
  title                TEXT NOT NULL,
  description          TEXT,
  transcript           TEXT,
  location             TEXT,
  area                 TEXT,
  latitude             REAL,
  longitude            REAL,
  category             TEXT,
  priority             TEXT,
  status               TEXT NOT NULL DEFAULT 'Submitted',
  authority_id         TEXT REFERENCES authorities(id),
  authority_confidence INTEGER,
  issue_confidence     INTEGER,
  summary              TEXT,
  duration             TEXT,
  authenticity         TEXT,
  risk                 INTEGER,
  sensitive            TEXT,
  factors              TEXT NOT NULL DEFAULT '[]',
  hazards              TEXT NOT NULL DEFAULT '[]',
  citizen_name         TEXT,
  citizen_contact      TEXT,
  language             TEXT,
  report_count         INTEGER NOT NULL DEFAULT 1,
  duplicate_of         TEXT,
  ai_mode              TEXT,
  ai_model             TEXT,
  analysis             TEXT
);

CREATE TABLE IF NOT EXISTS attachments (
  id           TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  mime         TEXT NOT NULL,
  filename     TEXT,
  size         INTEGER NOT NULL,
  data         BLOB NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timeline (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  actor        TEXT,
  kind         TEXT NOT NULL DEFAULT 'done',
  at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  detail TEXT,
  actor  TEXT,
  at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'citizen',
  authority_id  TEXT REFERENCES authorities(id),
  job_title     TEXT,
  phone         TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS case_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id),
  author_name  TEXT NOT NULL,
  author_role  TEXT NOT NULL,
  authority_id TEXT,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_parent      ON case_messages(complaint_id, id);
CREATE INDEX IF NOT EXISTS idx_complaints_authority ON complaints(authority_id);
CREATE INDEX IF NOT EXISTS idx_complaints_created   ON complaints(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_parent   ON attachments(complaint_id);
CREATE INDEX IF NOT EXISTS idx_timeline_parent      ON timeline(complaint_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user        ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_authority      ON users(authority_id);
`);

// Databases created before accounts existed need the owning-user column added.
function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
addColumnIfMissing("complaints", "user_id", "TEXT REFERENCES users(id)");
addColumnIfMissing("complaints", "assignee_id", "TEXT REFERENCES users(id)");
addColumnIfMissing("complaints", "assigned_at", "TEXT");

// Indexed after the migration, since the column may have just been added.
db.exec("CREATE INDEX IF NOT EXISTS idx_complaints_assignee ON complaints(assignee_id)");

const now = () => new Date().toISOString();
const jsonOut = (value, fallback) => {
  if (value === null || value === undefined) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

/* ------------------------------------------------------------------ */
/* Authorities                                                         */
/* ------------------------------------------------------------------ */

const AUTHORITY_SEED = [
  {
    id: "kwsc", name: "KW&SC", full_name: "Karachi Water & Sewerage Corporation",
    color: "#1a9b93", contact_email: "complaints@kwsc.gos.pk",
    areas: ["Gulshan-e-Iqbal", "North Nazimabad", "Clifton", "Saddar", "Korangi", "PECHS", "Nazimabad"],
    categories: ["Water leakage", "Burst water line", "Water outage", "Low water pressure", "Sewage overflow", "Blocked drain", "Open manhole"],
  },
  {
    id: "sswmb", name: "SSWMB", full_name: "Sindh Solid Waste Management Board",
    color: "#d89127", contact_email: "info@sswmb.gos.pk",
    areas: ["Gulshan-e-Iqbal", "Korangi", "Nazimabad", "Saddar", "PECHS", "Clifton"],
    categories: ["Garbage accumulation", "Uncollected waste", "Illegal dumping", "Construction waste"],
  },
  {
    id: "kmc", name: "KMC", full_name: "Karachi Metropolitan Corporation",
    color: "#e06d4f", contact_email: "complaints@kmc.gos.pk",
    areas: ["Saddar", "Clifton", "Gulshan-e-Iqbal", "PECHS", "Korangi", "Nazimabad", "North Nazimabad"],
    categories: ["Road damage", "Pothole", "Road flooding", "Footpath damage", "Encroachment", "Other"],
  },
  {
    id: "kelectric", name: "K-Electric", full_name: "K-Electric Limited",
    color: "#5b6ec4", contact_email: "customercare@ke.com.pk",
    areas: ["Gulshan-e-Iqbal", "Saddar", "Clifton", "Korangi", "PECHS", "Nazimabad", "North Nazimabad"],
    categories: ["Streetlight failure", "Exposed wiring", "Power outage", "Transformer fault"],
  },
];

const CATEGORIES = AUTHORITY_SEED.flatMap((a) => a.categories);

function seedAuthorities() {
  const insert = db.prepare(`
    INSERT INTO authorities (id, name, full_name, color, areas, categories, contact_email)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, full_name = excluded.full_name, color = excluded.color,
      areas = excluded.areas, categories = excluded.categories, contact_email = excluded.contact_email
  `);
  for (const a of AUTHORITY_SEED) {
    insert.run(a.id, a.name, a.full_name, a.color, JSON.stringify(a.areas), JSON.stringify(a.categories), a.contact_email);
  }
}

function listAuthorities() {
  return db.prepare("SELECT * FROM authorities ORDER BY name").all().map((row) => ({
    id: row.id, name: row.name, fullName: row.full_name, color: row.color,
    areas: jsonOut(row.areas, []), categories: jsonOut(row.categories, []), contactEmail: row.contact_email,
  }));
}

/* ------------------------------------------------------------------ */
/* Users and sessions                                                  */
/* ------------------------------------------------------------------ */

const publicUser = (row) => (row ? {
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  authorityId: row.authority_id,
  jobTitle: row.job_title,
  phone: row.phone,
  createdAt: row.created_at,
} : null);

function createUser({ email, passwordHash, name, role, authorityId, jobTitle, phone }) {
  const id = `usr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO users (id, email, password_hash, name, role, authority_id, job_title, phone, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, email, passwordHash, name, role, authorityId ?? null, jobTitle ?? null, phone ?? null, now());
  return publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
}

/** Includes password_hash — for the login check only. Never send to a client. */
const findUserForLogin = (email) => db.prepare("SELECT * FROM users WHERE email = ?").get(email) || null;
const getUser = (id) => publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
const emailTaken = (email) => Boolean(db.prepare("SELECT 1 AS x FROM users WHERE email = ?").get(email));
const countUsers = () => Number(db.prepare("SELECT COUNT(*) AS c FROM users").get().c);

function listUsers() {
  return db.prepare("SELECT * FROM users ORDER BY created_at DESC").all().map(publicUser);
}

function createSession(userId, days = 30) {
  const token = require("crypto").randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + days * 86400_000).toISOString();
  db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(token, userId, now(), expires);
  return { token, expiresAt: expires };
}

function userForSession(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?
  `).get(token, now());
  return publicUser(row);
}

const deleteSession = (token) => db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
const purgeExpiredSessions = () => db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());

/** Staff of one authority, for the assignment picker. */
function listAuthorityStaff(authorityId) {
  return db.prepare("SELECT * FROM users WHERE role = 'authority' AND authority_id = ? ORDER BY name")
    .all(authorityId)
    .map(publicUser);
}

/**
 * The work contact of an authority staff member, shown to the citizen whose case
 * they are assigned to so they can chase it up. Deliberately excludes anything
 * that isn't an official point of contact.
 */
const contactCard = (row) => (row ? {
  id: row.id,
  name: row.name,
  jobTitle: row.job_title,
  authorityId: row.authority_id,
  email: row.email,
  phone: row.phone,
} : null);

/* ------------------------------------------------------------------ */
/* Complaints                                                          */
/* ------------------------------------------------------------------ */

function nextComplaintId() {
  const row = db.prepare("SELECT COUNT(*) AS c FROM complaints").get();
  return `CY-${2400 + Number(row.c) + 1}`;
}

const INSERT_COMPLAINT = `
INSERT INTO complaints (
  id, created_at, updated_at, channel, source_label, title, description, transcript,
  location, area, latitude, longitude, category, priority, status,
  authority_id, authority_confidence, issue_confidence, summary, duration,
  authenticity, risk, sensitive, factors, hazards,
  citizen_name, citizen_contact, language, report_count, duplicate_of,
  ai_mode, ai_model, analysis, user_id
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?,
  ?, ?, ?, ?
)`;

function createComplaint(input) {
  const id = input.id || nextComplaintId();
  const ts = input.createdAt || now();
  db.prepare(INSERT_COMPLAINT).run(
    id, ts, ts,
    input.channel || "text",
    input.sourceLabel || "Text report",
    input.title,
    input.description ?? null,
    input.transcript ?? null,
    input.location ?? null,
    input.area ?? null,
    input.latitude ?? null,
    input.longitude ?? null,
    input.category ?? null,
    input.priority ?? "Medium",
    input.status || "Submitted",
    input.authorityId ?? null,
    input.authorityConfidence ?? null,
    input.issueConfidence ?? null,
    input.summary ?? null,
    input.duration ?? null,
    input.authenticity ?? null,
    input.risk ?? null,
    input.sensitive ? JSON.stringify(input.sensitive) : null,
    JSON.stringify(input.factors || []),
    JSON.stringify(input.hazards || []),
    input.citizenName ?? null,
    input.citizenContact ?? null,
    input.language ?? null,
    input.reportCount ?? 1,
    input.duplicateOf ?? null,
    input.aiMode ?? null,
    input.aiModel ?? null,
    input.analysis ? JSON.stringify(input.analysis) : null,
    input.userId ?? null,
  );
  return id;
}

function hydrate(row) {
  if (!row) return null;
  const attachments = db
    .prepare("SELECT id, kind, mime, filename, size, created_at FROM attachments WHERE complaint_id = ? ORDER BY created_at")
    .all(row.id)
    .map((a) => ({ id: a.id, kind: a.kind, mime: a.mime, filename: a.filename, size: a.size, url: `/api/attachments/${a.id}` }));
  const timeline = db
    .prepare("SELECT label, actor, kind, at FROM timeline WHERE complaint_id = ? ORDER BY id")
    .all(row.id)
    .map((t) => ({ label: t.label, by: t.actor, kind: t.kind, time: t.at }));

  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    channel: row.channel,
    source: row.source_label,
    title: row.title,
    description: row.description,
    transcript: row.transcript,
    location: row.location,
    area: row.area,
    latitude: row.latitude,
    longitude: row.longitude,
    category: row.category,
    priority: row.priority,
    status: row.status,
    authorityId: row.authority_id,
    authorityConfidence: row.authority_confidence,
    confidence: row.issue_confidence,
    summary: row.summary,
    duration: row.duration,
    authenticity: row.authenticity,
    risk: row.risk,
    sensitive: jsonOut(row.sensitive, null),
    factors: jsonOut(row.factors, []),
    hazards: jsonOut(row.hazards, []),
    citizen: row.citizen_name,
    citizenContact: row.citizen_contact,
    userId: row.user_id,
    assignedAt: row.assigned_at,
    assignee: row.assignee_id
      ? contactCard(db.prepare("SELECT * FROM users WHERE id = ?").get(row.assignee_id))
      : null,
    messages: listMessages(row.id),
    language: row.language,
    reports: row.report_count,
    duplicate: row.duplicate_of,
    aiMode: row.ai_mode,
    aiModel: row.ai_model,
    analysis: jsonOut(row.analysis, null),
    attachments,
    timeline,
  };
}

function getComplaint(id) {
  return hydrate(db.prepare("SELECT * FROM complaints WHERE id = ?").get(id));
}

function listComplaints({ authorityId, status, priority, userId, assigneeId, limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (authorityId) { where.push("authority_id = ?"); params.push(authorityId); }
  if (userId) { where.push("user_id = ?"); params.push(userId); }
  if (assigneeId) { where.push("assignee_id = ?"); params.push(assigneeId); }
  if (status) { where.push("status = ?"); params.push(status); }
  if (priority) { where.push("priority = ?"); params.push(priority); }
  const sql = `SELECT * FROM complaints ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`;
  return db.prepare(sql).all(...params, limit).map(hydrate);
}

function assignComplaint(id, assigneeId) {
  db.prepare("UPDATE complaints SET assignee_id = ?, assigned_at = ?, updated_at = ? WHERE id = ?")
    .run(assigneeId, assigneeId ? now() : null, now(), id);
  return getComplaint(id);
}

/* ------------------------------------------------------------------ */
/* Case messages                                                       */
/* ------------------------------------------------------------------ */

function addMessage({ complaintId, user, body }) {
  db.prepare(`
    INSERT INTO case_messages (complaint_id, user_id, author_name, author_role, authority_id, body, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(complaintId, user.id, user.name, user.role, user.authorityId ?? null, body, now());
  db.prepare("UPDATE complaints SET updated_at = ? WHERE id = ?").run(now(), complaintId);
}

function listMessages(complaintId) {
  return db.prepare("SELECT * FROM case_messages WHERE complaint_id = ? ORDER BY id").all(complaintId)
    .map((m) => ({
      id: m.id,
      body: m.body,
      authorName: m.author_name,
      authorRole: m.author_role,
      authorityId: m.authority_id,
      userId: m.user_id,
      createdAt: m.created_at,
    }));
}

function updateComplaint(id, fields) {
  const map = {
    status: "status", priority: "priority", authorityId: "authority_id",
    category: "category", summary: "summary", duplicateOf: "duplicate_of",
    reportCount: "report_count",
  };
  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(map)) {
    if (fields[key] !== undefined) { sets.push(`${column} = ?`); params.push(fields[key]); }
  }
  if (!sets.length) return getComplaint(id);
  sets.push("updated_at = ?");
  params.push(now(), id);
  db.prepare(`UPDATE complaints SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getComplaint(id);
}

/* ------------------------------------------------------------------ */
/* Attachments, timeline, audit                                        */
/* ------------------------------------------------------------------ */

function addAttachment({ complaintId, kind, mime, filename, buffer }) {
  const id = `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  db.prepare("INSERT INTO attachments (id, complaint_id, kind, mime, filename, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, complaintId, kind, mime, filename || null, bytes.byteLength, bytes, now());
  return { id, kind, mime, filename, size: bytes.byteLength, url: `/api/attachments/${id}` };
}

function getAttachment(id) {
  return db.prepare("SELECT id, mime, filename, data FROM attachments WHERE id = ?").get(id) || null;
}

function addTimeline(complaintId, label, actor, kind = "done", at = now()) {
  db.prepare("INSERT INTO timeline (complaint_id, label, actor, kind, at) VALUES (?, ?, ?, ?, ?)")
    .run(complaintId, label, actor || null, kind, at);
}

function addAudit(action, detail, actor, at = now()) {
  db.prepare("INSERT INTO audit (action, detail, actor, at) VALUES (?, ?, ?, ?)").run(action, detail || null, actor || null, at);
}

function listAudit(limit = 40) {
  return db.prepare("SELECT action, detail, actor, at FROM audit ORDER BY id DESC LIMIT ?").all(limit)
    .map((r) => ({ action: r.action, detail: r.detail, by: r.actor, time: r.at }));
}

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

function metrics({ authorityId } = {}) {
  // Authority accounts get the same shape, counted over their own queue only.
  const scope = authorityId ? " WHERE authority_id = ?" : "";
  const and = authorityId ? " AND authority_id = ?" : "";
  const args = authorityId ? [authorityId] : [];
  const one = (sql) => Number(db.prepare(sql).get(...args).c);

  const total = one(`SELECT COUNT(*) AS c FROM complaints${scope}`);
  const resolved = one(`SELECT COUNT(*) AS c FROM complaints WHERE status IN ('Resolved','Closed')${and}`);
  const byChannel = db.prepare(`SELECT channel, COUNT(*) AS c FROM complaints${scope} GROUP BY channel`).all(...args)
    .reduce((acc, r) => Object.assign(acc, { [r.channel]: Number(r.c) }), {});
  const byCategory = db.prepare(`SELECT category, COUNT(*) AS c FROM complaints WHERE category IS NOT NULL${and} GROUP BY category ORDER BY c DESC LIMIT 8`).all(...args)
    .map((r) => ({ category: r.category, count: Number(r.c) }));
  const byAuthority = db.prepare(`SELECT authority_id, COUNT(*) AS c FROM complaints WHERE authority_id IS NOT NULL${and} GROUP BY authority_id`).all(...args)
    .map((r) => ({ authorityId: r.authority_id, count: Number(r.c) }));

  return {
    total,
    open: one(`SELECT COUNT(*) AS c FROM complaints WHERE status NOT IN ('Resolved','Closed')${and}`),
    critical: one(`SELECT COUNT(*) AS c FROM complaints WHERE priority = 'Critical'${and}`),
    suspicious: one(`SELECT COUNT(*) AS c FROM complaints WHERE authenticity IN ('Suspicious','Needs Verification')${and}`),
    resolutionRate: total ? Math.round((resolved / total) * 100) : 0,
    citizens: Number(db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'citizen'").get().c),
    byChannel, byCategory, byAuthority,
  };
}

module.exports = {
  db, dbFile, CATEGORIES, AUTHORITY_SEED,
  seedAuthorities, listAuthorities,
  createUser, findUserForLogin, getUser, listUsers, emailTaken, countUsers,
  createSession, userForSession, deleteSession, purgeExpiredSessions,
  listAuthorityStaff, contactCard, assignComplaint, addMessage, listMessages,
  createComplaint, getComplaint, listComplaints, updateComplaint, nextComplaintId,
  addAttachment, getAttachment,
  addTimeline, addAudit, listAudit,
  metrics, now,
};
