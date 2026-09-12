"use strict";

/**
 * Demo accounts and complaints, inserted once into an empty database so the
 * dashboards and authority queues have something to show. Real signups and
 * submissions land in the same tables.
 */

const { hashPassword } = require("./auth");

const DEMO_PASSWORD = "demo1234";

const DEMO_USERS = [
  { key: "ayesha",   name: "Ayesha Khan",      email: "citizen@demo.pk",   role: "citizen",   phone: "0300 2145566" },
  { key: "usman",    name: "Usman Raza",       email: "usman@demo.pk",     role: "citizen",   phone: "0321 8890231" },
  { key: "sara",     name: "Sara Ahmed",       email: "sara@demo.pk",      role: "citizen",   phone: "0333 4471902" },
  { key: "farhan",   name: "Farhan Ali",       email: "kwsc@demo.pk",      role: "authority", authorityId: "kwsc",      jobTitle: "Operations lead",    phone: "021 99245101" },
  { key: "shahid",   name: "Shahid Iqbal",     email: "kwsc.field@demo.pk",role: "authority", authorityId: "kwsc",      jobTitle: "Field engineer",     phone: "0301 7788456" },
  { key: "imran",    name: "Imran Sheikh",     email: "sswmb@demo.pk",     role: "authority", authorityId: "sswmb",     jobTitle: "Zonal supervisor",   phone: "021 99332218" },
  { key: "rabia",    name: "Rabia Qureshi",    email: "kmc@demo.pk",       role: "authority", authorityId: "kmc",       jobTitle: "Roads engineer",     phone: "021 99201744" },
  { key: "hassan",   name: "Hassan Mehmood",   email: "kelectric@demo.pk", role: "authority", authorityId: "kelectric", jobTitle: "Field supervisor",   phone: "0311 9004512" },
  { key: "nadia",    name: "Nadia Hussain",    email: "admin@demo.pk",     role: "admin",     phone: "021 99200100" },
];

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

const DEMO_COMPLAINTS = [
  {
    owner: "ayesha", createdAt: hoursAgo(2),
    channel: "audio", sourceLabel: "Voice report",
    title: "Sewage overflow outside Beaconhouse School",
    transcript: "Yahan do din se gutter ka pani road par khara hai aur school ke bachay isi raste se guzarte hain.",
    location: "Gulshan-e-Iqbal, Block 13-D", area: "Gulshan-e-Iqbal",
    category: "Sewage overflow", priority: "Critical", status: "In Progress",
    authorityId: "kwsc", authorityConfidence: 96, issueConfidence: 94,
    summary: "Sewage water has been standing on the road for two days. Children walking to the neighbouring school pass through it daily.",
    duration: "Approximately 2 days", authenticity: "Likely Genuine", risk: 8,
    sensitive: { detected: true, type: "School", name: "Beaconhouse School", distance: "180m", relevance: "High" },
    factors: ["Near Beaconhouse School", "Public health risk", "23 related reports"],
    hazards: ["Public health", "Pedestrian safety"],
    language: "Roman Urdu", reportCount: 23,
    duplicateOf: "INC-102", aiMode: "gemini", aiModel: "gemini-3.5-flash",
    assignedTo: "shahid",
    messages: [
      ["shahid", "Assalam-o-Alaikum. I have been assigned to this case. Our crew is scheduled for tomorrow between 9am and 12pm — please keep the lane clear if you can."],
      ["ayesha", "Thank you. The worst stretch is right outside the school gate, near the corner shop."],
      ["shahid", "Noted. I'll call you from this number before we arrive."],
    ],
    timeline: [
      ["Submitted via voice report", "Ayesha Khan", "done"],
      ["AI triage complete", "Civic AI", "done"],
      ["Assigned to Gulshan field team", "KW&SC", "done"],
      ["Resolution evidence requested", "Field team", "active"],
    ],
  },
  {
    owner: "usman", createdAt: hoursAgo(4),
    channel: "text", sourceLabel: "Text report",
    title: "Overflowing drain on University Road",
    description: "Bad smell and standing water outside the bus stop near University Road.",
    location: "Gulshan-e-Iqbal, University Road", area: "Gulshan-e-Iqbal",
    category: "Blocked drain", priority: "High", status: "Assigned",
    authorityId: "kwsc", authorityConfidence: 92, issueConfidence: 88,
    summary: "A blocked drain outside a busy bus stop is producing standing water and a strong smell.",
    duration: "1 day", authenticity: "Likely Genuine", risk: 13,
    sensitive: { detected: true, type: "Transit hub", name: "University Road bus stop", distance: "Not specified", relevance: "Medium" },
    factors: ["Transit hub nearby", "8 related reports"],
    hazards: ["Public health"],
    language: "English", reportCount: 8,
    duplicateOf: "INC-102", aiMode: "gemini", aiModel: "gemini-3.5-flash",
    timeline: [["Submitted via text report", "Usman Raza", "done"], ["AI triage complete", "Civic AI", "done"], ["Assigned", "KW&SC", "active"]],
  },
  {
    owner: "sara", createdAt: hoursAgo(26),
    channel: "image", sourceLabel: "Photo report",
    title: "Uncollected waste beside Gulshan Chowrangi market",
    description: "Three days of uncollected waste beside the market entrance.",
    location: "Gulshan-e-Iqbal, Block 7", area: "Gulshan-e-Iqbal",
    category: "Uncollected waste", priority: "Medium", status: "Under Review",
    authorityId: "sswmb", authorityConfidence: 90, issueConfidence: 82,
    summary: "Waste has accumulated beside the market entrance for three days and is spreading onto the footpath.",
    duration: "3 days", authenticity: "Needs Verification", risk: 41,
    sensitive: { detected: true, type: "Major market", name: "Gulshan Chowrangi Market", distance: "240m", relevance: "Medium" },
    factors: ["Near a market", "Duration over 48 hours"],
    hazards: ["Public health"],
    language: "English", reportCount: 5,
    aiMode: "gemini", aiModel: "gemini-3.5-flash",
    timeline: [["Submitted via photo report", "Sara Ahmed", "done"], ["AI triage complete", "Civic AI", "done"], ["Verification requested", "SSWMB", "active"]],
  },
  {
    owner: "ayesha", createdAt: hoursAgo(50),
    channel: "image", sourceLabel: "Photo report",
    title: "Pothole at Tariq Road intersection",
    description: "Large pothole forcing traffic to merge suddenly near the bus stop.",
    location: "PECHS, Tariq Road", area: "PECHS",
    category: "Pothole", priority: "High", status: "Resolved",
    authorityId: "kmc", authorityConfidence: 94, issueConfidence: 97,
    summary: "A large pothole at the intersection is forcing sudden lane changes beside a bus stop.",
    duration: "1 week", authenticity: "Likely Genuine", risk: 5,
    sensitive: { detected: true, type: "Transit hub", name: "Tariq Road bus stop", distance: "90m", relevance: "Medium" },
    factors: ["Traffic safety", "Near a transit hub"],
    hazards: ["Traffic safety"],
    language: "English", reportCount: 12,
    aiMode: "gemini", aiModel: "gemini-3.5-flash",
    timeline: [["Submitted via photo report", "Ayesha Khan", "done"], ["AI triage complete", "Civic AI", "done"], ["Resolved", "KMC", "done"], ["Citizen confirmation", "Ayesha Khan", "active"]],
  },
  {
    owner: null, createdAt: hoursAgo(74),
    channel: "image", sourceLabel: "Photo report",
    citizenName: "Anonymous citizen",
    title: "Streetlights out along main service lane",
    description: "Poori gali mein andhera hai, teen streetlight kaam nahi kar rahi.",
    location: "Saddar, M.A. Jinnah Road service lane", area: "Saddar",
    category: "Streetlight failure", priority: "Medium", status: "Needs Verification",
    authorityId: "kelectric", authorityConfidence: 88, issueConfidence: 76,
    summary: "Three streetlights along a service lane are out, leaving the stretch dark after sunset.",
    duration: "Not specified", authenticity: "Suspicious", risk: 81,
    sensitive: { detected: false, type: "", name: "", distance: "", relevance: "None" },
    factors: ["Image/location mismatch", "Evidence reused in 2 reports"],
    hazards: ["Pedestrian safety"],
    language: "Roman Urdu", reportCount: 1,
    aiMode: "gemini", aiModel: "gemini-3.5-flash",
    timeline: [["Submitted via photo report", "Anonymous citizen", "done"], ["Verification requested", "Civic AI", "active"]],
  },
];

async function seedDemoData(db) {
  if (db.countUsers() > 0) return false;

  const byKey = {};
  for (const spec of DEMO_USERS) {
    // Hash per account, never once for the batch: a shared salt makes identical
    // passwords visible as identical hashes in a table dump.
    byKey[spec.key] = db.createUser({ ...spec, passwordHash: await hashPassword(DEMO_PASSWORD) });
  }

  if (db.db.prepare("SELECT COUNT(*) AS c FROM complaints").get().c === 0) {
    for (const demo of DEMO_COMPLAINTS) {
      const { timeline, owner, assignedTo, messages, ...fields } = demo;
      const user = owner ? byKey[owner] : null;
      const id = db.createComplaint({
        ...fields,
        userId: user ? user.id : null,
        citizenName: fields.citizenName || (user ? user.name : "Anonymous citizen"),
        citizenContact: user ? user.phone : null,
      });
      for (const [label, actor, kind] of timeline) {
        db.addTimeline(id, label, actor, kind, demo.createdAt);
      }
      if (assignedTo) db.assignComplaint(id, byKey[assignedTo].id);
      for (const [authorKey, body] of messages || []) {
        db.addMessage({ complaintId: id, user: byKey[authorKey], body });
      }
    }

    db.addAudit("Priority increased", "A sewage report was raised to Critical because a school is 180m away and children cross the affected stretch.", "Civic AI + rules");
    db.addAudit("Incident clustered", "8 reports linked to INC-102 based on location, category and language similarity.", "Civic AI");
    db.addAudit("Verification requested", "A waste report requires field confirmation before resolution.", "SSWMB");
  }

  return true;
}

module.exports = { seedDemoData, DEMO_USERS, DEMO_PASSWORD };
