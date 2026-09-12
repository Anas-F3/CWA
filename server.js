"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

// Load local secrets (GEMINI_API_KEY, ANTHROPIC_API_KEY, CIVIC_AI_PROVIDER)
// before anything reads process.env. Absent in production, where the host
// supplies real environment variables.
try { process.loadEnvFile(path.join(__dirname, ".env")); } catch { /* no .env file */ }

const db = require("./db");
const ai = require("./ai");
const auth = require("./auth");
const { seedDemoData, DEMO_PASSWORD } = require("./seed");

const PORT = Number(process.env.PORT || 5000);
const publicDir = path.join(__dirname, "public");

// Base64-encoded photos, voice notes and video clips travel inside the JSON
// body, so the limit has to clear a phone camera shot or a short clip. Base64
// inflates by ~4/3, which the body cap accounts for.
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_VIDEO_BYTES = 40 * 1024 * 1024;

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const AUDIO_MIMES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-m4a", "audio/aac"];
const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/3gpp", "video/ogg"];

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

function json(res, status, data, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Upload is too large. Keep photos under 8 MB and voice notes under a minute."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(Object.assign(new Error("Invalid JSON body."), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/**
 * Reject silent audio before it reaches the model.
 *
 * Given a silent recording, Gemini does not report silence — it invents a
 * plausible complaint and transcribes words nobody said. The browser gates this
 * at capture time using the live waveform; this covers uploads and API clients.
 * Only uncompressed WAV can be inspected without a codec, so compressed formats
 * pass through and rely on the recorder-side check.
 */
function rejectSilentWav(media) {
  if (!media || media.mime !== "audio/wav") return;
  const buf = media.buffer;
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return;

  const bitsPerSample = buf.readUInt16LE(34);
  if (bitsPerSample !== 16) return;

  let peak = 0;
  for (let i = 44; i + 1 < buf.length; i += 2) peak = Math.max(peak, Math.abs(buf.readInt16LE(i)));
  if (peak < 328) { // ~1% of full scale
    throw fail("That recording is silent. Check your microphone isn’t muted and record again.");
  }
}

/* ------------------------------------------------------------------ */
/* Intake validation                                                   */
/* ------------------------------------------------------------------ */

function decodeMedia(media, { kind, allowedMimes, maxBytes }) {
  if (!media || !media.data) return null;
  if (!allowedMimes.includes(media.mime)) {
    throw fail(`Unsupported ${kind} format: ${media.mime}.`);
  }
  const buffer = Buffer.from(media.data, "base64");
  if (!buffer.length) throw fail(`The ${kind} could not be read.`);
  if (buffer.length > maxBytes) {
    throw fail(`That ${kind} is ${(buffer.length / 1048576).toFixed(1)} MB — the limit is ${maxBytes / 1048576} MB.`);
  }
  return { mime: media.mime, filename: media.filename || null, buffer, data: buffer.toString("base64") };
}

function normalizeIntake(payload) {
  const channel = ["text", "image", "audio", "video"].includes(payload.channel) ? payload.channel : "text";
  const description = String(payload.description || "").trim().slice(0, 4000);
  const transcript = String(payload.transcript || "").trim().slice(0, 8000);
  const capabilities = ai.status().capabilities;

  const image = decodeMedia(payload.image, { kind: "photo", allowedMimes: IMAGE_MIMES, maxBytes: MAX_IMAGE_BYTES });
  const audio = decodeMedia(payload.audio, { kind: "voice note", allowedMimes: AUDIO_MIMES, maxBytes: MAX_AUDIO_BYTES });
  const video = decodeMedia(payload.video, { kind: "video", allowedMimes: VIDEO_MIMES, maxBytes: MAX_VIDEO_BYTES });

  if (channel === "text" && !description) throw fail("Describe the issue so Civic AI can classify it.");
  if (channel === "image" && !image) throw fail("Attach a photo, or switch to the text tab.");

  if (channel === "audio") {
    if (!audio && !transcript) throw fail("Record a voice note, or switch to the text tab.");
    rejectSilentWav(audio);
    // Only Gemini listens to the audio itself. On any other engine the browser
    // transcript is the only thing that carries meaning.
    if (!transcript && capabilities.audio !== "native") {
      throw fail("This engine can't listen to audio. Type what you said in the transcript box, or switch to the text tab.");
    }
  }

  if (channel === "video") {
    if (!capabilities.video) throw fail("Video reports need the Gemini engine. Set GEMINI_API_KEY, or use the photo tab.");
    if (!video) throw fail("Attach a video, or switch to the photo tab.");
  }

  return {
    channel,
    description,
    transcript,
    image,
    audio,
    video,
    location: String(payload.location || "").trim().slice(0, 300),
    area: String(payload.area || "").trim().slice(0, 80),
    latitude: Number.isFinite(payload.latitude) ? payload.latitude : null,
    longitude: Number.isFinite(payload.longitude) ? payload.longitude : null,
    language: String(payload.language || "").trim().slice(0, 40),
    citizenName: String(payload.citizenName || "Ayesha Khan").trim().slice(0, 120),
  };
}

const SOURCE_LABEL = { text: "Text report", image: "Photo report", audio: "Voice report", video: "Video report" };

/**
 * Shape a complaint for one viewer.
 *
 * Contact details are the point of this feature, but they are not public: the
 * citizen who filed a case sees the assigned officer's work contact so they can
 * chase it up, and the handling authority sees the citizen's number so it can
 * call ahead. Everyone else — including citizens browsing nearby incidents —
 * gets the case without either.
 */
function forViewer(complaint, user) {
  const isOwner = Boolean(complaint.userId && complaint.userId === user.id);
  const isHandler = user.role === "authority" && complaint.authorityId === user.authorityId;
  const privileged = isOwner || isHandler || user.role === "admin";

  return {
    ...complaint,
    // Name and job title identify who is handling it; the number is need-to-know.
    assignee: complaint.assignee
      ? (privileged ? complaint.assignee : { name: complaint.assignee.name, jobTitle: complaint.assignee.jobTitle, authorityId: complaint.assignee.authorityId })
      : null,
    citizenContact: isHandler || user.role === "admin" ? complaint.citizenContact : null,
    messages: privileged ? complaint.messages : [],
    canComment: privileged,
    canAssign: isHandler || user.role === "admin",
    isOwner,
  };
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

function persistComplaint(intake, analysis) {
  const sensitive = analysis.sensitiveLocationMatch && analysis.sensitiveLocationMatch.detected
    ? analysis.sensitiveLocationMatch
    : null;

  const factors = [];
  if (sensitive) factors.push(`Near ${sensitive.name || sensitive.type}`);
  if (analysis.priorityReason) factors.push(analysis.priorityReason);
  for (const hazard of analysis.potentialHazards || []) factors.push(hazard);

  const id = db.createComplaint({
    channel: intake.channel,
    sourceLabel: SOURCE_LABEL[intake.channel],
    title: analysis.title || analysis.issueCategory,
    description: intake.description || null,
    // Gemini transcribes voice notes itself; prefer that over the browser's.
    transcript: analysis.spokenTranscript || intake.transcript || null,
    location: analysis.locationInformation || intake.location || null,
    area: analysis.affectedArea || intake.area || null,
    latitude: intake.latitude,
    longitude: intake.longitude,
    category: analysis.issueCategory,
    priority: analysis.priorityRecommendation,
    status: "Submitted",
    authorityId: analysis.authorityId,
    authorityConfidence: analysis.authorityConfidence,
    issueConfidence: analysis.issueConfidence,
    summary: analysis.complaintSummary,
    duration: analysis.duration,
    authenticity: analysis.authenticityAssessment ? analysis.authenticityAssessment.status : null,
    risk: analysis.authenticityAssessment ? analysis.authenticityAssessment.risk : null,
    sensitive,
    factors: factors.slice(0, 5),
    hazards: analysis.potentialHazards || [],
    citizenName: intake.citizenName,
    citizenContact: intake.citizenContact ?? null,
    userId: intake.userId ?? null,
    language: analysis.detectedLanguage || intake.language || null,
    aiMode: analysis.mode,
    aiModel: analysis.model,
    analysis,
  });

  if (intake.image) {
    db.addAttachment({ complaintId: id, kind: "image", mime: intake.image.mime, filename: intake.image.filename, buffer: intake.image.buffer });
  }
  if (intake.audio) {
    db.addAttachment({ complaintId: id, kind: "audio", mime: intake.audio.mime, filename: intake.audio.filename, buffer: intake.audio.buffer });
  }
  if (intake.video) {
    db.addAttachment({ complaintId: id, kind: "video", mime: intake.video.mime, filename: intake.video.filename, buffer: intake.video.buffer });
  }

  const authority = db.listAuthorities().find((a) => a.id === analysis.authorityId);
  const authorityName = authority ? authority.name : "the responsible authority";

  db.addTimeline(id, `Submitted via ${SOURCE_LABEL[intake.channel].toLowerCase()}`, intake.citizenName, "done");
  db.addTimeline(id, analysis.mode === "claude" ? "AI triage complete" : "Offline keyword triage complete", "Civic AI", "done");
  db.addTimeline(id, `Routed to ${authorityName}`, "Civic AI", "active");

  db.addAudit(
    "Complaint routed",
    `${id} (${analysis.issueCategory}, ${analysis.priorityRecommendation}) routed to ${authorityName} from a ${intake.channel} report.`,
    analysis.mode === "claude" ? `Civic AI · ${analysis.model}` : "Civic AI · offline rules",
  );

  return db.getComplaint(id);
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

const currentUser = (req) => db.userForSession(auth.readCookies(req.headers.cookie)[auth.COOKIE_NAME]);

function requireUser(req) {
  const user = currentUser(req);
  if (!user) throw fail("Sign in to continue.", 401);
  return user;
}

function requireRole(req, ...roles) {
  const user = requireUser(req);
  if (!roles.includes(user.role)) throw fail("Your account doesn't have access to that.", 403);
  return user;
}

async function handleAuth(req, res, pathname) {
  if (req.method === "POST" && pathname === "/api/auth/register") {
    const payload = await readBody(req);
    const authorityIds = db.listAuthorities().map((a) => a.id);
    const { errors, value } = auth.validateRegistration(payload, authorityIds);
    if (errors.length) throw fail(errors[0]);

    // Admin accounts are provisioned, never self-registered.
    if (value.role === "admin") throw fail("Admin accounts cannot be created from the signup form.", 403);
    if (db.emailTaken(value.email)) throw fail("An account with that email already exists. Try signing in.");

    const user = db.createUser({ ...value, passwordHash: await auth.hashPassword(value.password) });
    const session = db.createSession(user.id);
    db.addAudit("Account created", `${user.name} registered as ${user.role}${user.authorityId ? ` for ${user.authorityId.toUpperCase()}` : ""}.`, user.email);
    return json(res, 201, { user }, { "Set-Cookie": auth.sessionCookie(session.token, session.expiresAt) });
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const payload = await readBody(req);
    const email = String(payload.email || "").trim().toLowerCase();
    const row = db.findUserForLogin(email);
    // Same message either way, so the form can't be used to enumerate accounts.
    const ok = row && await auth.verifyPassword(String(payload.password || ""), row.password_hash);
    if (!ok) throw fail("That email and password don't match.", 401);

    const session = db.createSession(row.id);
    return json(res, 200, { user: db.getUser(row.id) }, { "Set-Cookie": auth.sessionCookie(session.token, session.expiresAt) });
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const token = auth.readCookies(req.headers.cookie)[auth.COOKIE_NAME];
    if (token) db.deleteSession(token);
    return json(res, 200, { ok: true }, { "Set-Cookie": auth.clearedCookie() });
  }

  if (req.method === "GET" && pathname === "/api/auth/me") {
    return json(res, 200, { user: currentUser(req) });
  }

  return false;
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, url) {
  const { pathname } = url;

  if (pathname.startsWith("/api/auth/")) {
    const handled = await handleAuth(req, res, pathname);
    if (handled !== false) return handled;
  }

  if (req.method === "GET" && pathname === "/api/config") {
    return json(res, 200, {
      ...ai.status(),
      areas: ai.AREAS,
      categories: [...new Set(db.CATEGORIES)],
      authorities: db.listAuthorities(),
      limits: {
        image: MAX_IMAGE_BYTES,
        audio: MAX_AUDIO_BYTES,
        video: MAX_VIDEO_BYTES,
      },
    });
  }

  if (req.method === "GET" && pathname === "/api/dashboard") {
    const user = requireUser(req);

    // An authority account only ever sees its own organisation's queue.
    const scoped = user.role === "authority"
      ? db.listComplaints({ authorityId: user.authorityId })
      : db.listComplaints();

    const shape = (list) => list.map((c) => forViewer(c, user));

    return json(res, 200, {
      user,
      reports: shape(scoped),
      myReports: shape(db.listComplaints({ userId: user.id })),
      assignedToMe: user.role === "authority" ? shape(db.listComplaints({ assigneeId: user.id })) : [],
      authorities: db.listAuthorities(),
      categories: [...new Set(db.CATEGORIES)],
      audit: user.role === "admin" ? db.listAudit() : [],
      metrics: db.metrics(user.role === "authority" ? { authorityId: user.authorityId } : {}),
      aiEnabled: ai.status().aiEnabled,
    });
  }

  // Classify without saving, so the citizen can review before submitting.
  if (req.method === "POST" && pathname === "/api/triage") {
    requireUser(req);
    const intake = normalizeIntake(await readBody(req));
    const analysis = await ai.triage(intake);
    return json(res, 200, { analysis, transcript: intake.transcript || "" });
  }

  // Classify (or re-use a reviewed analysis) and persist.
  if (req.method === "POST" && pathname === "/api/complaints") {
    const user = requireUser(req);
    const payload = await readBody(req);
    const intake = normalizeIntake(payload);
    intake.citizenName = user.name;
    intake.userId = user.id;
    // So the handling authority can call ahead; hidden from everyone else.
    intake.citizenContact = user.phone || null;
    const analysis = payload.analysis && payload.analysis.issueCategory
      ? payload.analysis
      : await ai.triage(intake);
    return json(res, 201, { complaint: forViewer(persistComplaint(intake, analysis), user) });
  }

  if (req.method === "GET" && pathname === "/api/complaints") {
    const user = requireUser(req);
    return json(res, 200, {
      complaints: db.listComplaints({
        authorityId: user.role === "authority" ? user.authorityId : url.searchParams.get("authority") || undefined,
        userId: url.searchParams.get("mine") ? user.id : undefined,
        status: url.searchParams.get("status") || undefined,
        priority: url.searchParams.get("priority") || undefined,
      }),
    });
  }

  const complaintMatch = /^\/api\/complaints\/([\w-]+)$/.exec(pathname);
  if (complaintMatch) {
    const user = requireUser(req);
    const id = complaintMatch[1];
    const complaint = db.getComplaint(id);
    if (!complaint) throw fail("Complaint not found.", 404);

    // Authority staff are confined to cases routed to their own organisation.
    if (user.role === "authority" && complaint.authorityId !== user.authorityId) {
      throw fail("That case belongs to another authority.", 403);
    }

    if (req.method === "GET") return json(res, 200, { complaint: forViewer(complaint, user) });

    if (req.method === "PATCH") {
      const input = await readBody(req);

      if (input.status) {
        requireRole(req, "authority", "admin");
        db.updateComplaint(id, { status: input.status });
        db.addTimeline(id, input.status, user.name, "active");
        db.addAudit("Case status changed", `${id} moved to ${input.status}.`, `${user.name} · ${user.authorityId ? user.authorityId.toUpperCase() : "Admin"}`);
      }

      if (input.confirmation) {
        // Only the citizen who filed it can confirm or dispute the resolution.
        if (complaint.userId && complaint.userId !== user.id && user.role !== "admin") {
          throw fail("Only the citizen who filed this report can confirm it.", 403);
        }
        const status = input.confirmation === "resolved" ? "Closed" : "Escalated";
        db.updateComplaint(id, { status });
        db.addTimeline(
          id,
          input.confirmation === "resolved" ? "Citizen confirmed resolution" : "Citizen disputed resolution",
          user.name,
          "active",
        );
        db.addAudit("Citizen confirmation", `${id} marked ${status.toLowerCase()} by the citizen.`, user.name);
      }
      return json(res, 200, { complaint: forViewer(db.getComplaint(id), user) });
    }
  }

  // Staff of one authority, for the assignment picker.
  if (req.method === "GET" && pathname === "/api/staff") {
    const user = requireRole(req, "authority", "admin");
    const authorityId = user.role === "admin" ? url.searchParams.get("authority") : user.authorityId;
    if (!authorityId) throw fail("Specify an authority.");
    return json(res, 200, { staff: db.listAuthorityStaff(authorityId) });
  }

  const assignMatch = /^\/api\/complaints\/([\w-]+)\/assign$/.exec(pathname);
  if (req.method === "POST" && assignMatch) {
    const user = requireRole(req, "authority", "admin");
    const complaint = db.getComplaint(assignMatch[1]);
    if (!complaint) throw fail("Complaint not found.", 404);
    if (user.role === "authority" && complaint.authorityId !== user.authorityId) {
      throw fail("That case belongs to another authority.", 403);
    }

    const { assigneeId } = await readBody(req);
    if (assigneeId) {
      // Work can only go to someone who actually belongs to the owning authority.
      const eligible = db.listAuthorityStaff(complaint.authorityId).some((s) => s.id === assigneeId);
      if (!eligible) throw fail("That person doesn't work for the authority handling this case.");
    }

    const updated = db.assignComplaint(complaint.id, assigneeId || null);
    const label = assigneeId ? `Assigned to ${updated.assignee.name}` : "Assignment cleared";
    db.addTimeline(complaint.id, label, user.name, "active");
    db.addAudit("Case assigned", `${complaint.id}: ${label.toLowerCase()}.`, user.name);

    if (assigneeId) {
      db.addMessage({
        complaintId: complaint.id,
        user,
        body: `${updated.assignee.name}${updated.assignee.jobTitle ? ` (${updated.assignee.jobTitle})` : ""} has been assigned to this case and will follow up.`,
      });
    }
    return json(res, 200, { complaint: forViewer(db.getComplaint(complaint.id), user) });
  }

  // Two-way thread between the citizen who filed the case and the authority.
  const messageMatch = /^\/api\/complaints\/([\w-]+)\/messages$/.exec(pathname);
  if (req.method === "POST" && messageMatch) {
    const user = requireUser(req);
    const complaint = db.getComplaint(messageMatch[1]);
    if (!complaint) throw fail("Complaint not found.", 404);

    const isOwner = complaint.userId && complaint.userId === user.id;
    const isHandler = user.role === "authority" && complaint.authorityId === user.authorityId;
    if (!isOwner && !isHandler && user.role !== "admin") {
      throw fail("You can't post updates on this case.", 403);
    }

    const body = String((await readBody(req)).body || "").trim().slice(0, 2000);
    if (!body) throw fail("Write a message first.");

    db.addMessage({ complaintId: complaint.id, user, body });
    return json(res, 201, { complaint: forViewer(db.getComplaint(complaint.id), user) });
  }

  const attachmentMatch = /^\/api\/attachments\/([\w-]+)$/.exec(pathname);
  if (req.method === "GET" && attachmentMatch) {
    requireUser(req);
    const attachment = db.getAttachment(attachmentMatch[1]);
    if (!attachment) throw fail("Attachment not found.", 404);
    res.writeHead(200, {
      "Content-Type": attachment.mime,
      "Content-Length": attachment.data.byteLength,
      "Cache-Control": "private, max-age=3600",
    });
    return res.end(Buffer.from(attachment.data));
  }

  throw fail("Unknown endpoint.", 404);
}

/* ------------------------------------------------------------------ */
/* Static files                                                        */
/* ------------------------------------------------------------------ */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, file) => {
    if (err) return json(res, 404, { error: "Not found" });
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(file);
  });
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

/**
 * Page routing.
 *
 * The signed-out and signed-in halves of the app are separate documents, so
 * signing in is a real browser navigation to a fresh page rather than a DOM
 * swap. Every in-app view (/report, /cases, /case/CY-2401, …) resolves to
 * index.html, which reads the URL and renders the matching view — so refresh,
 * the back button and shared links all work.
 */
function serveStatic(req, res, url) {
  const user = currentUser(req);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (pathname === "/login") {
    if (user) return redirect(res, "/");
    return sendFile(res, path.join(publicDir, "login.html"));
  }

  // Real files (app.js, styles.css, favicon) are served as-is.
  if (pathname !== "/") {
    const assetPath = path.join(publicDir, path.normalize(pathname));
    if (assetPath.startsWith(publicDir) && fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
      return sendFile(res, assetPath);
    }
  }

  // Everything else is an app route, and the app requires a session.
  if (!user) {
    const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return redirect(res, `/login${next}`);
  }
  return sendFile(res, path.join(publicDir, "index.html"));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (!url.pathname.startsWith("/api/")) return serveStatic(req, res, url);

  handleApi(req, res, url).catch((error) => {
    if (res.headersSent) return;
    const status = error.status || 500;
    if (status >= 500) console.error("API error:", error);
    json(res, status, { error: error.message || "Something went wrong." });
  });
});

(async function start() {
  db.seedAuthorities();
  db.purgeExpiredSessions();
  const seeded = await seedDemoData(db);

  server.listen(PORT, "0.0.0.0", () => {
    const status = ai.status();
    const caps = status.capabilities;
    const channels = ["text", "image", caps.audio === "native" ? "audio" : "audio(transcript)", caps.video ? "video" : null]
      .filter(Boolean).join(", ");

    console.log(`The City Around You — http://localhost:${PORT}`);
    console.log(`Database: ${db.dbFile}`);
    console.log(status.aiEnabled
      ? `Civic AI: ${status.label} (${status.model}) — channels: ${channels}`
      : "Civic AI: offline keyword triage — set GEMINI_API_KEY (or ANTHROPIC_API_KEY) in .env to enable real triage");
    if (seeded) {
      console.log(`Demo accounts seeded (password: ${DEMO_PASSWORD})`);
      console.log("  citizen@demo.pk · kwsc@demo.pk · sswmb@demo.pk · kmc@demo.pk · kelectric@demo.pk · admin@demo.pk");
    }
  });
})();
