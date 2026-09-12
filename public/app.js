const state = {
  user: null,
  role: "citizen",
  view: "overview",
  data: null,
  config: null,
  selected: null,
  analysis: null,
  staff: null,
  intake: {
    channel: "text",
    description: "",
    caption: "",
    transcript: "",
    image: null,        // { mime, data, name, previewUrl }
    audio: null,        // { mime, data, url, seconds }
    video: null,        // { mime, data, name, url, size }
    location: "Gulshan-e-Iqbal, Block 13-D",
    area: "Gulshan-e-Iqbal",
    latitude: null,
    longitude: null,
    speechLang: "ur-PK",
  },
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
const priorityClass = (p) => String(p || "").toLowerCase();
const toast = (message) => { const el = $("#toast"); el.textContent = message; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 3600); };

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return iso;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

async function api(url, options) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, credentials: "same-origin", ...options });
  const data = await response.json();
  if (!response.ok) {
    // A dropped session should land on the sign-in screen, not a dead page.
    if (response.status === 401 && state.user) return goToLogin();
    throw Object.assign(new Error(data.error || "Something went wrong"), { status: response.status });
  }
  return data;
}

const authorityName = (id) => {
  const match = (state.data?.authorities || []).find((a) => a.id === id);
  return match ? match.name : "Authority";
};

/* ================================================================== */
/* Routing                                                             */
/* ================================================================== */

/**
 * Each view has a real URL, so refresh, the back button and shared links work.
 * The server serves index.html for all of these and the app reads the path.
 */
const ROUTES = {
  "/": "overview",
  "/report": "report",
  "/reports": "reports",
  "/nearby": "nearby",
  "/assigned": "assigned",
  "/cases": "cases",
  "/critical": "critical",
  "/clusters": "clusters",
  "/people": "people",
  "/rules": "rules",
  "/audit": "audit",
};

const VIEW_PATH = Object.fromEntries(Object.entries(ROUTES).map(([path, view]) => [view, path]));

function pathFor(view, id) {
  if (view === "detail") return `/case/${encodeURIComponent(id ?? state.selected ?? "")}`;
  return VIEW_PATH[view] || "/";
}

function readLocation() {
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  const caseMatch = /^\/case\/([\w-]+)$/.exec(pathname);
  if (caseMatch) return { view: "detail", selected: decodeURIComponent(caseMatch[1]) };
  return { view: ROUTES[pathname] || "overview", selected: null };
}

/** Change view and push a history entry. */
function navigate(view, id) {
  const path = pathFor(view, id);
  if (path !== location.pathname) history.pushState({ view, id }, "", path);
  state.view = view;
  if (id) state.selected = id;
  render();
}

/** Update the URL without adding a history entry (e.g. after submitting). */
function replaceUrl(view, id) {
  const path = pathFor(view, id);
  if (path !== location.pathname) history.replaceState({ view, id }, "", path);
}

window.addEventListener("popstate", () => {
  const { view, selected } = readLocation();
  state.view = view;
  if (selected) state.selected = selected;
  render();
});

const goToLogin = () => location.assign("/login");

async function signOut() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch { /* leave anyway */ }
  // Full navigation, so no signed-in state survives in memory or in the URL.
  goToLogin();
}


/* ================================================================== */
/* Navigation and shared chrome                                        */
/* ================================================================== */

function navItems() {
  const citizen = [{ icon:"home", label:"Overview", view:"overview" }, { icon:"plus", label:"Report an issue", view:"report" }, { icon:"clock", label:"My reports", view:"reports" }, { icon:"pulse", label:"Nearby incidents", view:"nearby" }];
  const mine = (state.data?.assignedToMe || []).length;
  const authority = [{ icon:"home", label:"Command center", view:"overview" }, { icon:"bookmark", label:"Assigned to me", view:"assigned", badge: mine ? String(mine) : "" }, { icon:"inbox", label:"All cases", view:"cases" }, { icon:"alert", label:"Critical queue", view:"critical" }, { icon:"target", label:"Incident clusters", view:"clusters" }];
  const admin = [{ icon:"home", label:"Platform overview", view:"overview" }, { icon:"users", label:"People & access", view:"people" }, { icon:"settings", label:"Routing & rules", view:"rules" }, { icon:"history", label:"Audit history", view:"audit" }];
  const groups = state.role === "citizen" ? [{ name:"YOUR CIVIC SPACE", items:citizen }] : state.role === "authority" ? [{ name:"OPERATIONS", items:authority }] : [{ name:"ADMINISTRATION", items:admin }];
  $("#nav").innerHTML = groups.map((group) => `<div class="nav-label">${group.name}</div>${group.items.map((item) => `<button class="nav-item ${state.view === item.view ? "active" : ""}" data-view="${item.view}"><b>${icon(item.icon, 18)}</b><span>${item.label}</span>${item.badge ? `<em>${item.badge}</em>` : ""}</button>`).join("")}`).join("");
  $$(".nav-item").forEach((el) => el.addEventListener("click", () => navigate(el.dataset.view)));
}

function metricCard(label, value, name, tone, note, neutral = false) { return `<div class="metric"><div class="metric-top"><span>${label}</span><span class="metric-icon ${tone}">${icon(name, 18)}</span></div><strong>${value}</strong><small class="${neutral ? "neutral" : ""}">${note}</small></div>`; }
function pageHeading(eyebrow, title, subtitle, action = "") { return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`; }

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

/**
 * Inline stroke icons on a 24px grid, drawn in currentColor. Replaces the
 * dingbat glyphs the prototype used, which rendered differently on every
 * platform and never matched the type.
 */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.5"/><path d="M9.5 21v-6h5v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pulse: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
  inbox: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 13.5h4l1.5 2.5h6l1.5-2.5h4"/>',
  alert: '<path d="M12 4.5 21 19.5H3L12 4.5Z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".6" fill="currentColor" stroke="none"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8" fill="currentColor" stroke="none"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16.5 5.4a3.5 3.5 0 0 1 0 6.2"/><path d="M18 14.4c2.1.7 3.5 2.5 3.5 5.1"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h.1A1.6 1.6 0 0 0 10 3.3V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.3 1.1Z"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5V10H9"/><path d="M12 8v4.5l3 1.8"/>',
  bookmark: '<path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4-6.5 4v-16a1 1 0 0 1 1-1Z"/>',
  crosshair: '<circle cx="12" cy="12" r="8"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>',
  check: '<path d="M4.5 12.5 9.5 17.5 19.5 7"/>',
  text: '<path d="M5.5 3.5h9l5 5v12a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z"/><path d="M14 3.5v5h5"/><path d="M8.5 13h7M8.5 16.5h5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 4.8-4.3a1.5 1.5 0 0 1 2 0L16 17.5"/><path d="m13.5 14 2-1.7a1.5 1.5 0 0 1 2 0l2.5 2.2"/>',
  mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>',
  video: '<rect x="2.5" y="5.5" width="13" height="13" rx="2"/><path d="m15.5 10 6-3.2v10.4l-6-3.2Z"/>',
  phone: '<path d="M7 3.5 9.5 4l1.2 3.4-1.8 1.6a11 11 0 0 0 5.1 5.1l1.6-1.8L19 13.5l.5 2.5a2 2 0 0 1-2 2.3A14.5 14.5 0 0 1 4.2 5.5a2 2 0 0 1 2.3-2Z"/>',
  mail: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3 7 8.4 5.6a1 1 0 0 0 1.2 0L21 7"/>',
  sparkle: '<path d="m12 3 1.9 5.4L19.5 10l-5.6 1.6L12 17l-1.9-5.4L4.5 10l5.6-1.6L12 3Z"/>',
  power: '<path d="M12 3.5v8"/><path d="M7 6.4a8 8 0 1 0 10 0"/>',
  shield: '<path d="M12 2.8 20 6v6c0 5-3.4 8-8 9.2C7.4 20 4 17 4 12V6l8-3.2Z"/><path d="m9 12 2 2 4-4"/>',
  send: '<path d="M21 3 10.5 13.5"/><path d="M21 3 14.5 21l-4-7.5L3 9.5 21 3Z"/>',
  message: '<path d="M20.5 12a7.5 7.5 0 0 1-10.9 6.7L4 20.5l1.8-5.6A7.5 7.5 0 1 1 20.5 12Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/>',
  pin: '<path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
  bell: '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9Z"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>',
};

const icon = (name, size = 20) =>
  `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;

const CHANNEL_ICON = { text: "text", image: "image", audio: "mic", video: "video" };

/** What the active AI engine can actually accept. */
const caps = () => state.config?.capabilities || { text: true, image: true, audio: "transcript", video: false };
const audioIsNative = () => caps().audio === "native";
const videoSupported = () => Boolean(caps().video);

function reportRow(report, action = "Open case") {
  const evidence = report.reports > 1 ? `${icon("pulse", 13)} ${report.reports} reports` : `${icon(CHANNEL_ICON[report.channel] || "text", 13)} ${escapeHtml(report.source || "Report")}`;
  return `<div class="report-row"><div><h3>${escapeHtml(report.title)}</h3><p>${escapeHtml(report.location || "Location not specified")} · ${timeAgo(report.createdAt)}</p><div class="report-meta"><span class="tag ${priorityClass(report.priority)}">${escapeHtml(report.priority)}</span><span class="tag status">${escapeHtml(report.status)}</span><span class="meta-dim">${evidence}</span></div></div><div class="report-right"><button class="action-link" data-report="${report.id}">${action} →</button><small>${escapeHtml(report.id)}</small></div></div>`;
}

/* ================================================================== */
/* Overview / list pages                                               */
/* ================================================================== */

function overview() {
  const m = state.data.metrics;
  const reports = state.data.reports;

  if (state.role === "citizen") {
    const mine = state.data.myReports || [];
    return `${pageHeading("Karachi civic intelligence", `Good morning, ${escapeHtml(state.user.name.split(" ")[0])}`, "Report an issue in whichever way is easiest — type it, photograph it, or just say it.", `<button class="primary-btn" data-action="new-report">${icon("plus", 16)} Report an issue</button>`)}
    <div class="channel-promo ${videoSupported() ? "four" : ""}">
      <button class="channel-promo-card" data-new-channel="text"><b>${icon("text", 22)}</b><strong>Write it</strong><small>English, Urdu or Roman Urdu</small></button>
      <button class="channel-promo-card" data-new-channel="image"><b>${icon("image", 22)}</b><strong>Photograph it</strong><small>AI reads the photo itself</small></button>
      <button class="channel-promo-card" data-new-channel="audio"><b>${icon("mic", 22)}</b><strong>Say it</strong><small>${audioIsNative() ? "AI listens to your voice note" : "Record a voice note"}</small></button>
      ${videoSupported() ? `<button class="channel-promo-card" data-new-channel="video"><b>${icon("video", 22)}</b><strong>Film it</strong><small>AI watches the clip</small></button>` : ""}
    </div>
    <div class="metrics">${metricCard("My open reports", mine.filter((r) => !["Resolved","Closed"].includes(r.status)).length, "clock", "teal", "Tracked to closure")}${metricCard("Nearby incidents", m.open, "crosshair", "amber", `${m.critical} critical`)}${metricCard("Resolved in your area", m.total - m.open, "check", "blue", `${m.resolutionRate}% resolution rate`)}${metricCard("Reports on record", m.total, "pulse", "rose", "Stored in the civic database")}</div>
    <div class="grid-2"><section class="card"><div class="card-head"><div><h2>Your active reports</h2><p>Keep track of what happens next</p></div><button class="card-link" data-view="reports">View all →</button></div><div class="report-list">${mine.slice(0,3).map((r) => reportRow(r, "View report")).join("") || emptyState("You haven’t filed a report yet.")}</div></section><section class="card side-card"><div class="card-head"><div><h2>Gulshan-e-Iqbal</h2><p>Area civic pulse</p></div><span class="tag high">Fair</span></div><div class="map"><i class="map-pin a"></i><i class="map-pin b"></i><i class="map-pin c"></i><i class="map-pin d"></i></div><div class="map-legend"><span><i style="background:#d85b58"></i> Critical</span><span><i style="background:#e98259"></i> High</span><span><i style="background:#087f78"></i> Resolved</span></div>${channelBreakdown(m)}</section></div>`;
  }

  if (state.role === "authority") {
    // The server already scoped `reports` to this account's authority.
    const org = myAuthority();
    const name = org ? org.name : "your authority";
    return `${pageHeading(`${escapeHtml(name)} operations`, "Command center", `Every case routed to ${escapeHtml(org ? org.fullName : "your organisation")}.`, `<button class="secondary-btn" data-view="cases">${icon("inbox", 16)} All cases</button>`)}
    <div class="metrics">${metricCard("Cases routed to you", reports.length, "inbox", "teal", "Your organisation only")}${metricCard("Critical queue", reports.filter((r) => r.priority === "Critical").length, "alert", "rose", "Need field action")}${metricCard("In progress", reports.filter((r) => ["In Progress","Assigned","Under Review"].includes(r.status)).length, "history", "amber", "Active field work", true)}${metricCard("Resolution rate", `${m.resolutionRate}%`, "check", "blue", "Across your cases")}</div>
    <div class="grid-2"><section class="card"><div class="card-head"><div><h2>Needs your attention</h2><p>Priority-sorted reports for ${escapeHtml(name)}</p></div><button class="card-link" data-view="cases">All cases →</button></div><div class="report-list">${reports.slice(0,4).map((r) => reportRow(r, "Open case")).join("") || emptyState(`No cases routed to ${name} yet.`)}</div></section><section class="card side-card"><div class="card-head"><div><h2>Live incident map</h2><p>${escapeHtml((org?.areas || []).slice(0, 2).join(", ") || "Service area")}</p></div></div><div class="map"><i class="map-pin a"></i><i class="map-pin b"></i><i class="map-pin c"></i><i class="map-pin d"></i></div>${channelBreakdown(m)}</section></div>`;
  }

  return `${pageHeading("Platform command center", "Karachi, in focus", "Human oversight for a city that works better.", `<button class="secondary-btn" data-view="audit">View audit history →</button>`)}
    <div class="metrics">${metricCard("Citizens reporting", m.citizens, "users", "teal", "Distinct reporters")}${metricCard("Open incidents", m.open, "history", "amber", `Across ${state.data.authorities.length} authorities`)}${metricCard("Critical incidents", m.critical, "alert", "rose", "Escalated by AI + rules")}${metricCard("Resolution rate", `${m.resolutionRate}%`, "check", "blue", "Based on stored complaints")}</div>
    <div class="admin-grid"><section class="card"><div class="card-head"><div><h2>Reports by category</h2><p>From the complaints database</p></div></div><div class="bar-chart">${categoryChart(m)}</div></section><section class="card"><div class="card-head"><div><h2>Intake channels</h2><p>How citizens are reporting</p></div></div>${channelBreakdown(m, true)}</section></div>`;
}

function channelBreakdown(m, expanded = false) {
  const total = Object.values(m.byChannel || {}).reduce((a, b) => a + b, 0) || 1;
  const rows = [["text","Text","text"],["image","Photo","image"],["audio","Voice","mic"],["video","Video","video"]]
    .map(([key, label, glyph]) => {
      const count = m.byChannel?.[key] || 0;
      return `<div class="channel-row"><span class="channel-icon">${icon(glyph, 15)}</span><div class="channel-bar-wrap"><div class="channel-bar-label"><strong>${label}</strong><small>${count}</small></div><div class="channel-bar"><i style="width:${Math.round((count / total) * 100)}%"></i></div></div></div>`;
    }).join("");
  return `<div class="channel-breakdown ${expanded ? "expanded" : ""}">${expanded ? "" : `<div class="channel-breakdown-title">Intake channels</div>`}${rows}</div>`;
}

function categoryChart(m) {
  const rows = m.byCategory || [];
  if (!rows.length) return emptyState("No complaints recorded yet.");
  const max = Math.max(...rows.map((r) => r.count));
  return rows.map((r, i) => `<div class="bar-col"><div class="bar ${i === 0 ? "hot" : ""}" style="height:${Math.round((r.count / max) * 100)}%"></div><small title="${escapeHtml(r.category)}">${escapeHtml(r.category.split(" ")[0])}</small></div>`).join("");
}

const emptyState = (message) => `<div class="empty-state">${escapeHtml(message)}</div>`;

function reportsPage() {
  const mine = state.data.myReports || [];
  return `${pageHeading("Your civic record", "My reports", "Every report stays visible until the issue is truly closed.", `<button class="primary-btn" data-action="new-report">${icon("plus", 16)} New report</button>`)}<div class="notice"><strong>Privacy first.</strong> Your identity details are protected. Your CNIC is never displayed in your case list or shared with authorities unless a verified workflow requires it.</div><section class="card"><div class="card-head"><div><h2>Reports you filed</h2><p>${mine.length} report${mine.length === 1 ? "" : "s"} on your account</p></div></div><div class="report-list">${mine.map((r) => reportRow(r, "View report")).join("") || emptyState("No reports yet. Submit your first one.")}</div></section>`;
}

function assignedPage() {
  const mine = state.data.assignedToMe || [];
  const open = mine.filter((r) => !["Resolved", "Closed"].includes(r.status));
  return `${pageHeading("Your workload", "Assigned to me", "Cases you personally are responsible for. The citizen can see your name and number on each of these.", `<button class="secondary-btn" data-view="cases">${icon("inbox", 16)} All cases</button>`)}
  <div class="metrics">${metricCard("Assigned to you", mine.length, "bookmark", "teal", "Across all statuses")}${metricCard("Still open", open.length, "history", "amber", "Need your action", true)}${metricCard("Critical", mine.filter((r) => r.priority === "Critical").length, "alert", "rose", "Attend first")}${metricCard("Awaiting reply", mine.filter((r) => r.messages?.length && r.messages.at(-1).authorRole === "citizen").length, "mail", "blue", "Citizen wrote last")}</div>
  <section class="card"><div class="card-head"><div><h2>Your cases</h2><p>Ordered newest first</p></div></div><div class="report-list">${mine.map((r) => reportRow(r, "Open case")).join("") || emptyState("Nothing assigned to you yet.")}</div></section>`;
}

function casesPage(filter = "all") {
  const org = myAuthority();
  const list = state.data.reports.filter((r) => (filter === "critical" ? r.priority === "Critical" : true));
  return `${pageHeading(`${escapeHtml(org ? org.name : "Authority")} operations`, filter === "critical" ? "Critical queue" : "All cases", "Prioritize the cases that need field action.", `<button class="secondary-btn" data-view="overview">← Command center</button>`)}<section class="card table-card"><table class="case-table"><thead><tr><th>Case</th><th>Location</th><th>Priority</th><th>Status</th><th>Reports</th><th></th></tr></thead><tbody>${list.map((r) => `<tr><td><div class="case-id">${r.id}</div><div class="case-title">${escapeHtml(r.title)}</div><div class="case-sub">${icon(CHANNEL_ICON[r.channel] || "text", 13)} ${escapeHtml(r.source || "")}</div></td><td>${escapeHtml(r.location || "—")}<div class="case-sub">${r.sensitive ? `${icon("alert", 12)} ${escapeHtml(r.sensitive.name || r.sensitive.type)}` : "No sensitive match"}</div></td><td><span class="tag ${priorityClass(r.priority)}">${r.priority}</span></td><td><span class="tag status">${r.status}</span></td><td>${r.reports}</td><td><button class="action-link" data-report="${r.id}">Open →</button></td></tr>`).join("") || `<tr><td colspan="6">${emptyState("Nothing in this queue.")}</td></tr>`}</tbody></table></section>`;
}

function adminPage(view) {
  if (view === "people") return `${pageHeading("Administration", "People & access", "Manage platform participants without exposing sensitive identity data.", "")}<div class="admin-grid"><section class="card"><div class="card-head"><div><h2>Authorities</h2><p>Configurable service organizations</p></div></div><div class="admin-list">${state.data.authorities.map((a) => `<div class="admin-line"><div><strong>${escapeHtml(a.name)}</strong><small>${escapeHtml(a.fullName)} · ${a.categories.length} issue types</small></div><span class="tag resolved">Active</span></div>`).join("")}</div></section><section class="card"><div class="card-head"><div><h2>Reporting citizens</h2><p>Identity data is access-controlled</p></div></div><div class="admin-list"><div class="admin-line"><div><strong>Distinct reporters</strong><small>Across all stored complaints</small></div><b class="admin-number">${state.data.metrics.citizens}</b></div><div class="admin-line"><div><strong>Reports needing verification</strong><small>Awaiting human review</small></div><b class="admin-number">${state.data.metrics.suspicious}</b></div></div></section></div>`;

  if (view === "rules") return `${pageHeading("Administration", "Routing & rules", "AI interprets reports; these configurable rules make the final decision.", "")}<div class="notice"><strong>Rules are active.</strong> A human can override an AI recommendation at any time. No automated rule can punish a citizen or permanently reject a report.</div><div class="admin-grid"><section class="card"><div class="card-head"><div><h2>Priority rules</h2><p>Applied after AI triage</p></div></div><div class="admin-list"><div class="admin-line"><div><strong>Sewage + school or hospital</strong><small>Increase priority by one level</small></div><span class="tag critical">Active</span></div><div class="admin-line"><div><strong>Open manhole or exposed wiring</strong><small>Escalate to Critical</small></div><span class="tag resolved">Active</span></div><div class="admin-line"><div><strong>Unresolved beyond SLA</strong><small>Escalate to authority lead</small></div><span class="tag resolved">Active</span></div></div></section><section class="card"><div class="card-head"><div><h2>Routing table</h2><p>${state.data.authorities.length} authorities configured</p></div></div><div class="admin-list">${state.data.authorities.map((a) => `<div class="admin-line"><div><strong>${escapeHtml(a.name)}</strong><small>${escapeHtml(a.categories.slice(0,3).join(", "))}${a.categories.length > 3 ? ` +${a.categories.length - 3} more` : ""}</small></div><span class="tag status">${escapeHtml(a.contactEmail || "")}</span></div>`).join("")}</div></section></div>`;

  return `${pageHeading("Administration", "Audit history", "A transparent record of important platform decisions.", `<span class="tag resolved">All actions preserved</span>`)}<section class="card"><div class="card-head"><div><h2>Recent activity</h2><p>AI recommendations and human actions</p></div></div>${state.data.audit.map((a) => `<div class="audit-row"><strong>${escapeHtml(a.action)}</strong><p>${escapeHtml(a.detail || "")}</p><small>${escapeHtml(a.by || "")} · ${timeAgo(a.time)}</small></div>`).join("") || emptyState("No audit entries yet.")}</section>`;
}

function nearbyPage() {
  return `${pageHeading("Around you", "Nearby incidents", "See what is happening in Gulshan-e-Iqbal.", `<button class="secondary-btn" data-action="new-report">${icon("plus", 16)} Report something</button>`)}<div class="grid-2"><section class="card side-card"><div class="card-head"><div><h2>Gulshan-e-Iqbal civic pulse</h2><p>Updated from stored complaints</p></div></div><div class="map"><i class="map-pin a"></i><i class="map-pin b"></i><i class="map-pin c"></i><i class="map-pin d"></i></div>${channelBreakdown(state.data.metrics)}</section><section class="card"><div class="card-head"><div><h2>Active around you</h2><p>Within your selected area</p></div></div><div class="report-list">${state.data.reports.slice(0,5).map((r) => reportRow(r, "View details")).join("") || emptyState("Nothing reported nearby yet.")}</div></section></div>`;
}

/* ================================================================== */
/* Multimodal intake                                                   */
/* ================================================================== */

const speechSupported = () => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
const recorderSupported = () => Boolean(navigator.mediaDevices && window.MediaRecorder);

function reportForm() {
  const i = state.intake;
  const areas = state.config?.areas || ["Gulshan-e-Iqbal"];
  const aiBadge = state.config?.aiEnabled
    ? `<span class="tag resolved">${icon("sparkle", 12)} ${escapeHtml(state.config.label)} · ${escapeHtml(state.config.model)}</span>`
    : `<span class="tag high">Offline keyword triage</span>`;

  return `${pageHeading("New civic report", "Tell us what’s wrong", "Choose whichever way is easiest. Civic AI will identify the issue and route it.", aiBadge)}
  <div class="report-layout">
    <section class="card form-card">
      <div class="channel-tabs ${videoSupported() ? "four" : ""}" role="tablist">
        <button class="channel-tab ${i.channel === "text" ? "active" : ""}" data-channel="text" role="tab"><b>${icon("text", 17)}</b><span>Write it</span></button>
        <button class="channel-tab ${i.channel === "image" ? "active" : ""}" data-channel="image" role="tab"><b>${icon("image", 17)}</b><span>Photo</span></button>
        <button class="channel-tab ${i.channel === "audio" ? "active" : ""}" data-channel="audio" role="tab"><b>${icon("mic", 17)}</b><span>Voice</span></button>
        ${videoSupported() ? `<button class="channel-tab ${i.channel === "video" ? "active" : ""}" data-channel="video" role="tab"><b>${icon("video", 17)}</b><span>Video</span></button>` : ""}
      </div>

      <div class="channel-panel" ${i.channel === "text" ? "" : "hidden"}>
        <div class="field">
          <label for="intake-description">What is happening?</label>
          <textarea id="intake-description" placeholder="For example: Yahan do din se gutter ka pani road par khara hai aur school ke bachay isi raste se guzarte hain.">${escapeHtml(i.description)}</textarea>
          <div class="input-note">Write in English, Urdu, or Roman Urdu. No government jargon needed.</div>
        </div>
      </div>

      <div class="channel-panel" ${i.channel === "image" ? "" : "hidden"}>
        <div class="field">
          <label>Photograph the problem</label>
          <div class="uploader ${i.image ? "has-file" : ""}" id="image-drop">
            ${i.image
              ? `<img class="image-preview" src="${i.image.previewUrl}" alt="Photo of the reported issue" /><div class="uploader-actions"><button type="button" class="ghost-btn" id="image-replace">Replace</button><button type="button" class="ghost-btn danger" id="image-clear">Remove</button></div>`
              : `<div class="uploader-empty"><b>${icon("image", 26)}</b><strong>Take or choose a photo</strong><small>Drag one here, or tap to open your camera</small></div>`}
          </div>
          <input type="file" id="image-input" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" hidden />
          <div class="input-note">${escapeHtml(state.config?.label || "The AI")} reads the photo directly to identify the issue. JPEG, PNG, WebP or GIF up to 8 MB.</div>
        </div>
        <div class="field">
          <label for="intake-caption">Add a note <span class="label-optional">(optional)</span></label>
          <input id="intake-caption" value="${escapeHtml(i.caption)}" placeholder="Anything the photo doesn’t show" />
        </div>
      </div>

      <div class="channel-panel" ${i.channel === "audio" ? "" : "hidden"}>
        <div class="field">
          <label>Record a voice note</label>
          ${recorderSupported() ? `
          <div class="recorder ${i.audio ? "has-audio" : ""}">
            <button type="button" class="record-btn" id="record-btn" aria-label="Start recording"><span class="record-dot"></span></button>
            <div class="recorder-body">
              <strong id="record-status">${i.audio ? "Recording saved" : "Tap the mic and describe the problem"}</strong>
              <small id="record-timer">${i.audio ? `${i.audio.seconds}s recorded` : "Speak in Urdu, Roman Urdu or English"}</small>
              <div class="level-meter"><i id="record-level"></i></div>
            </div>
            <select id="speech-lang" aria-label="Spoken language">
              <option value="ur-PK" ${i.speechLang === "ur-PK" ? "selected" : ""}>Urdu</option>
              <option value="en-PK" ${i.speechLang === "en-PK" ? "selected" : ""}>English</option>
              <option value="en-IN" ${i.speechLang === "en-IN" ? "selected" : ""}>Roman Urdu</option>
            </select>
          </div>
          ${i.audio ? `
          <audio class="audio-playback" controls src="${i.audio.url}"></audio>
          <div class="uploader-actions">
            <button type="button" class="ghost-btn" id="audio-rerecord">${icon("history", 15)} Record again</button>
            <button type="button" class="ghost-btn danger" id="audio-clear">Remove</button>
          </div>` : ""}
          ` : `<div class="notice warn"><strong>Recording isn’t available in this browser.</strong> Type what you would have said in the box below, or use the text tab.</div>`}
        </div>
        <div class="field">
          <label for="intake-transcript">Transcript ${audioIsNative() ? `<span class="label-optional">(optional — ${escapeHtml(state.config.label)} listens to the recording itself)</span>` : ""}</label>
          <textarea id="intake-transcript" placeholder="${audioIsNative() ? "Leave this empty and the AI will transcribe your recording. Type here only if you'd rather not record." : speechSupported() ? "Your words appear here as you speak. Correct anything the browser misheard." : "Your browser can’t transcribe speech — type what you said here."}">${escapeHtml(i.transcript)}</textarea>
          <div class="input-note">${audioIsNative()
            ? `${icon("sparkle", 12)} The audio goes straight to ${escapeHtml(state.config.label)}, which transcribes and triages it. Anything you type here is treated as a hint.`
            : speechSupported()
              ? "Transcribed in your browser, then sent to Civic AI. The recording is stored with the complaint as evidence."
              : `${icon("alert", 12)} Speech recognition isn’t supported here (it works in Chrome and Edge). The recording is still stored as evidence.`}</div>
        </div>
      </div>

      <div class="channel-panel" ${i.channel === "video" ? "" : "hidden"}>
        <div class="field">
          <label>Record or upload a short video</label>
          <div class="uploader ${i.video ? "has-file" : ""}" id="video-drop">
            ${i.video
              ? `<video class="video-preview" controls src="${i.video.url}"></video><div class="uploader-actions"><button type="button" class="ghost-btn" id="video-replace">Replace</button><button type="button" class="ghost-btn danger" id="video-clear">Remove</button></div><div class="input-note">${escapeHtml(i.video.name || "clip")} · ${(i.video.size / 1048576).toFixed(1)} MB</div>`
              : `<div class="uploader-empty"><b>${icon("video", 26)}</b><strong>Take or choose a video</strong><small>Drag one here, or tap to open your camera</small></div>`}
          </div>
          <input type="file" id="video-input" accept="video/*" capture="environment" hidden />
          <div class="input-note">The AI watches the clip — useful when the problem is a flow, a spread, or something you need to pan across. MP4, WebM or MOV up to 40 MB. Anything spoken in the clip is transcribed too.</div>
        </div>
        <div class="field">
          <label for="intake-video-caption">Add a note <span class="label-optional">(optional)</span></label>
          <input id="intake-video-caption" value="${escapeHtml(i.caption)}" placeholder="Anything the video doesn’t show" />
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="intake-location">Where is it happening?</label>
          <input id="intake-location" value="${escapeHtml(i.location)}" placeholder="Area, street, or landmark" />
        </div>
        <div class="field narrow">
          <label for="intake-area">Area</label>
          <select id="intake-area">${areas.map((a) => `<option ${a === i.area ? "selected" : ""}>${escapeHtml(a)}</option>`).join("")}</select>
        </div>
      </div>
      <button type="button" class="ghost-btn locate" id="locate-btn">${icon("crosshair", 14)} ${i.latitude ? `Location attached (${i.latitude.toFixed(4)}, ${i.longitude.toFixed(4)})` : "Use my current location"}</button>

      <button class="primary-btn" id="analyze-btn" style="width:100%;margin-top:16px">Continue with Civic AI →</button>
    </section>

    <aside class="card analysis-card">
      <div class="eyebrow">Transparent triage</div>
      <h2>What happens next?</h2>
      <p>We’ll identify the issue, find the right authority, and flag anything that needs human attention — before anything is submitted.</p>
      <div class="ai-wait" id="analysis-empty"><div class="ai-wait-mark">${icon("sparkle", 26)}</div>Your analysis will appear here.</div>
      <div id="analysis-result"></div>
    </aside>
  </div>`;
}

function renderAnalysis(analysis) {
  const sensitive = analysis.sensitiveLocationMatch;
  const auth = (state.data.authorities || []).find((a) => a.id === analysis.authorityId);
  $("#analysis-empty").style.display = "none";
  $("#analysis-result").innerHTML = `<div class="ai-result">
    ${analysis.degraded ? `<div class="notice warn"><strong>Offline mode.</strong> ${escapeHtml(analysis.degraded)}</div>` : ""}
    ${analysis.spokenTranscript ? `<div class="decision"><span class="decision-label">What the AI heard you say</span><blockquote class="mini-transcript">“${escapeHtml(analysis.spokenTranscript)}”</blockquote><small class="decision-note">Correct it in the transcript box if anything is wrong, then analyse again.</small></div>` : ""}
    ${analysis.evidenceObservations ? `<div class="decision"><span class="decision-label">What the AI saw or heard</span><p class="decision-text">${escapeHtml(analysis.evidenceObservations)}</p></div>` : ""}
    ${analysis.evidenceQuality && analysis.evidenceQuality !== "Clear" && analysis.evidenceQuality !== "No evidence" ? `<div class="notice warn"><strong>Evidence is ${escapeHtml(analysis.evidenceQuality.toLowerCase())}.</strong> The AI could not read much from your attachment — adding a clearer one will get this routed faster.</div>` : ""}
    <div class="decision"><span class="decision-label">Detected issue</span><span class="decision-value">${escapeHtml(analysis.issueCategory)}</span><div class="score-row"><div class="score-bar"><i style="width:${analysis.issueConfidence}%"></i></div><small>${analysis.issueConfidence}% confidence</small></div></div>
    <div class="decision"><span class="decision-label">Recommended authority</span><span class="decision-value teal">${escapeHtml(auth ? auth.name : analysis.authorityId)}</span><small class="decision-note">${escapeHtml(auth ? auth.fullName : "")} · ${analysis.authorityConfidence}% confidence</small></div>
    <div class="decision"><span class="decision-label">Priority</span><span class="tag ${priorityClass(analysis.priorityRecommendation)}">${escapeHtml(analysis.priorityRecommendation)}</span><small class="decision-note">${escapeHtml(analysis.priorityReason || "")}</small>${sensitive?.detected ? `<small class="decision-warn">${icon("alert", 12)} ${escapeHtml(sensitive.name || sensitive.type)} is nearby (${escapeHtml(sensitive.relevance)} relevance)</small>` : ""}</div>
    <div class="decision"><span class="decision-label">Authenticity check</span><span class="decision-value">${escapeHtml(analysis.authenticityAssessment.status)}</span><small class="decision-note">${escapeHtml(analysis.authenticityAssessment.reason)}</small></div>
    ${analysis.recommendedQuestions?.length ? `<div class="decision"><span class="decision-label">Still unclear</span><ul class="question-list">${analysis.recommendedQuestions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ul></div>` : ""}
    <div class="complaint-preview"><small>Generated complaint</small><p>${escapeHtml(analysis.complaint.subject)}</p><span>${escapeHtml(analysis.complaint.requestedAction)}</span></div>
    <button class="primary-btn" id="submit-report" style="width:100%;margin-top:14px">Submit to ${escapeHtml(auth ? auth.name : "the authority")} →</button>
  </div>`;
  $("#submit-report").addEventListener("click", submitReport);
}

/* ---- media helpers ---------------------------------------------- */

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",")[1]);
  reader.onerror = () => reject(new Error("That file could not be read."));
  reader.readAsDataURL(file);
});

// MediaRecorder reports types like "audio/webm;codecs=opus"; the API allowlist
// matches on the bare type.
const baseMime = (type) => String(type || "").split(";")[0];

async function acceptImage(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) return toast("That file isn’t an image.");
  if (file.size > 8 * 1024 * 1024) return toast("That photo is over 8 MB. Try a smaller one.");
  try {
    const data = await fileToBase64(file);
    if (state.intake.image?.previewUrl) URL.revokeObjectURL(state.intake.image.previewUrl);
    state.intake.image = { mime: baseMime(file.type), data, name: file.name, previewUrl: URL.createObjectURL(file) };
    state.analysis = null;
    render();
  } catch (error) {
    toast(error.message);
  }
}

async function acceptVideo(file) {
  if (!file) return;
  if (!file.type.startsWith("video/")) return toast("That file isn’t a video.");
  const limit = state.config?.limits?.video || 40 * 1024 * 1024;
  if (file.size > limit) return toast(`That video is ${(file.size / 1048576).toFixed(1)} MB — the limit is ${Math.round(limit / 1048576)} MB. Try a shorter clip.`);
  try {
    const data = await fileToBase64(file);
    if (state.intake.video?.url) URL.revokeObjectURL(state.intake.video.url);
    state.intake.video = { mime: baseMime(file.type), data, name: file.name, url: URL.createObjectURL(file), size: file.size };
    state.analysis = null;
    render();
  } catch (error) {
    toast(error.message);
  }
}

const recorder = { instance: null, chunks: [], stream: null, recognition: null, startedAt: 0, timer: null, analyser: null, audioCtx: null, peak: 0 };

// A silent recording (muted mic, blocked hardware) makes the AI confabulate a
// plausible complaint rather than report nothing, so we check the waveform here
// — where the raw PCM is — instead of trusting the model to notice.
const SILENCE_PEAK = 5; // byte-domain deviation from the 128 midpoint

function watchLevel() {
  if (!recorder.analyser) return 0;
  const buffer = new Uint8Array(recorder.analyser.fftSize);
  recorder.analyser.getByteTimeDomainData(buffer);
  let peak = 0;
  for (const sample of buffer) peak = Math.max(peak, Math.abs(sample - 128));
  recorder.peak = Math.max(recorder.peak, peak);
  return peak;
}

function stopTracks() {
  if (recorder.stream) recorder.stream.getTracks().forEach((t) => t.stop());
  recorder.stream = null;
  if (recorder.audioCtx) { recorder.audioCtx.close().catch(() => {}); recorder.audioCtx = null; }
  recorder.analyser = null;
}

function startTranscription() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return;
  const recognition = new Recognition();
  recognition.lang = state.intake.speechLang;
  recognition.continuous = true;
  recognition.interimResults = true;

  let settled = "";
  recognition.onresult = (event) => {
    let interim = "";
    for (let idx = event.resultIndex; idx < event.results.length; idx += 1) {
      const result = event.results[idx];
      if (result.isFinal) settled += `${result[0].transcript} `;
      else interim += result[0].transcript;
    }
    const box = $("#intake-transcript");
    if (box) box.value = `${settled}${interim}`.trim();
    state.intake.transcript = `${settled}${interim}`.trim();
  };
  // `no-speech` and `aborted` fire during normal use — only surface real faults.
  recognition.onerror = (event) => {
    if (["no-speech", "aborted"].includes(event.error)) return;
    toast(event.error === "not-allowed"
      ? "Microphone access was blocked. You can still type the transcript."
      : `Transcription stopped (${event.error}). You can type the transcript instead.`);
  };
  recognition.start();
  recorder.recognition = recognition;
}

async function startRecording() {
  try {
    recorder.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return toast("Microphone access was blocked. Type the transcript instead, or use the text tab.");
  }

  recorder.chunks = [];
  recorder.peak = 0;
  try {
    recorder.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    recorder.analyser = recorder.audioCtx.createAnalyser();
    recorder.analyser.fftSize = 2048;
    recorder.audioCtx.createMediaStreamSource(recorder.stream).connect(recorder.analyser);
  } catch { recorder.analyser = null; }

  recorder.instance = new MediaRecorder(recorder.stream);
  recorder.instance.ondataavailable = (event) => { if (event.data.size) recorder.chunks.push(event.data); };
  recorder.instance.onstop = async () => {
    const blob = new Blob(recorder.chunks, { type: recorder.instance.mimeType });
    const seconds = Math.max(1, Math.round((Date.now() - recorder.startedAt) / 1000));
    const heardSomething = !recorder.analyser || recorder.peak >= SILENCE_PEAK;
    stopTracks();

    if (!heardSomething) {
      state.intake.audio = null;
      render();
      return toast("We couldn’t hear anything — check your microphone isn’t muted, then record again.");
    }

    const data = await fileToBase64(blob);
    if (state.intake.audio?.url) URL.revokeObjectURL(state.intake.audio.url);
    state.intake.audio = { mime: baseMime(recorder.instance.mimeType), data, url: URL.createObjectURL(blob), seconds };
    render();
  };

  recorder.instance.start();
  recorder.startedAt = Date.now();
  startTranscription();

  $("#record-btn")?.classList.add("recording");
  $("#record-status") && ($("#record-status").textContent = "Listening… tap again to stop");
  recorder.timer = setInterval(() => {
    const seconds = Math.round((Date.now() - recorder.startedAt) / 1000);
    const level = watchLevel();
    const timerEl = $("#record-timer");
    const meter = $("#record-level");
    if (meter) meter.style.width = `${Math.min(100, Math.round((level / 60) * 100))}%`;
    if (timerEl) {
      timerEl.textContent = recorder.peak < SILENCE_PEAK && seconds > 2
        ? `${seconds}s — we can’t hear you yet`
        : `${seconds}s — speak naturally`;
    }
    if (seconds >= 120) stopRecording();
  }, 200);
}

function stopRecording() {
  clearInterval(recorder.timer);
  recorder.timer = null;
  if (recorder.recognition) { recorder.recognition.stop(); recorder.recognition = null; }
  if (recorder.instance && recorder.instance.state !== "inactive") recorder.instance.stop();
  else stopTracks();
}

const isRecording = () => Boolean(recorder.instance && recorder.instance.state === "recording");

/* ---- intake submission ------------------------------------------ */

function collectIntake() {
  const i = state.intake;
  const payload = {
    channel: i.channel,
    location: i.location,
    area: i.area,
    latitude: i.latitude,
    longitude: i.longitude,
  };
  if (i.channel === "text") payload.description = i.description;
  if (i.channel === "image") { payload.description = i.caption; payload.image = { mime: i.image?.mime, data: i.image?.data, filename: i.image?.name }; }
  if (i.channel === "video") { payload.description = i.caption; payload.video = { mime: i.video?.mime, data: i.video?.data, filename: i.video?.name }; }
  if (i.channel === "audio") {
    payload.transcript = i.transcript;
    if (i.audio) payload.audio = { mime: i.audio.mime, data: i.audio.data, filename: `voice-note.${i.audio.mime.split("/")[1] || "webm"}` };
  }
  return payload;
}

function validateIntake() {
  const i = state.intake;
  if (i.channel === "text" && !i.description.trim()) return "Describe the issue so Civic AI can classify it.";
  if (i.channel === "image" && !i.image) return "Add a photo, or switch to the text tab.";
  if (i.channel === "video" && !i.video) return "Add a video, or switch to the photo tab.";
  if (i.channel === "audio" && !i.audio && !i.transcript.trim()) return "Record a voice note, or type what you said in the transcript box.";
  // Without native audio support the recording carries nothing the AI can read.
  if (i.channel === "audio" && !audioIsNative() && !i.transcript.trim()) {
    return "This engine can’t listen to audio — type what you said in the transcript box.";
  }
  return null;
}

async function analyzeIntake() {
  const problem = validateIntake();
  if (problem) return toast(problem);

  const button = $("#analyze-btn");
  button.disabled = true;
  button.textContent = "Analyzing your report…";
  $("#analysis-result").innerHTML = "";
  $("#analysis-empty").style.display = "block";
  $("#analysis-empty").innerHTML = `<div class="spinner"></div>Reading your ${state.intake.channel === "image" ? "photo" : state.intake.channel === "audio" ? "voice note" : "report"}<br/><small>Checking category, priority, location and authority</small>`;

  try {
    const result = await api("/api/triage", { method: "POST", body: JSON.stringify(collectIntake()) });
    state.analysis = result.analysis;

    // When the engine transcribed the recording itself, show the citizen what it
    // heard and let them correct it before submitting.
    const heard = result.analysis.spokenTranscript || result.transcript;
    if (heard && heard !== state.intake.transcript) {
      state.intake.transcript = heard;
      const box = $("#intake-transcript");
      if (box) {
        box.value = heard;
        box.classList.add("just-transcribed");
        setTimeout(() => box.classList.remove("just-transcribed"), 1600);
      }
    }

    renderAnalysis(result.analysis);
  } catch (error) {
    $("#analysis-empty").innerHTML = `<div class="ai-wait-mark warn">${icon("alert", 26)}</div>${escapeHtml(error.message)}`;
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Analyze again →";
  }
}

async function submitReport() {
  const button = $("#submit-report");
  button.disabled = true;
  button.textContent = "Submitting…";
  try {
    const data = await api("/api/complaints", {
      method: "POST",
      body: JSON.stringify({ ...collectIntake(), analysis: state.analysis }),
    });
    if (state.intake.image?.previewUrl) URL.revokeObjectURL(state.intake.image.previewUrl);
    if (state.intake.audio?.url) URL.revokeObjectURL(state.intake.audio.url);
    if (state.intake.video?.url) URL.revokeObjectURL(state.intake.video.url);
    Object.assign(state.intake, { description: "", caption: "", transcript: "", image: null, audio: null, video: null });
    state.analysis = null;
    state.selected = data.complaint.id;
    state.view = "detail";
    // Replace rather than push: going Back should not return to the filled form.
    replaceUrl("detail", data.complaint.id);
    await load();
    toast(`${data.complaint.id} submitted and routed to ${authorityName(data.complaint.authorityId)}.`);
  } catch (error) {
    button.disabled = false;
    button.textContent = "Submit this report →";
    toast(error.message);
  }
}

/* ================================================================== */
/* Case detail                                                         */
/* ================================================================== */

/** Who is handling the case, and how to reach them. */
function assignmentSection(report) {
  const org = (state.data.authorities || []).find((a) => a.id === report.authorityId);
  const who = report.assignee;

  const card = who
    ? `<div class="contact-card">
        <div class="contact-avatar">${escapeHtml(who.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase())}</div>
        <div class="contact-body">
          <strong>${escapeHtml(who.name)}</strong>
          <small>${escapeHtml(who.jobTitle || "Field officer")}${org ? ` · ${escapeHtml(org.name)}` : ""}</small>
          ${who.phone || who.email ? `<div class="contact-links">
            ${who.phone ? `<a class="contact-link" href="tel:${escapeHtml(who.phone.replace(/\s/g, ""))}">${icon("phone", 13)} ${escapeHtml(who.phone)}</a>` : ""}
            ${who.email ? `<a class="contact-link" href="mailto:${escapeHtml(who.email)}">${icon("mail", 13)} ${escapeHtml(who.email)}</a>` : ""}
          </div>` : `<div class="contact-links"><span class="meta-dim">No contact number on file.</span></div>`}
          ${report.assignedAt ? `<small class="assigned-when">Assigned ${timeAgo(report.assignedAt)}</small>` : ""}
        </div>
      </div>`
    : `<div class="contact-card empty"><div class="contact-body"><strong>Not assigned yet</strong><small>${escapeHtml(org ? org.name : "The authority")} has the case; a named officer appears here once it is assigned.</small></div></div>`;

  const picker = report.canAssign
    ? `<div class="assign-row">
        <select id="assign-select" aria-label="Assign this case">
          <option value="">Unassigned</option>
          ${(state.staff || []).map((s) => `<option value="${escapeHtml(s.id)}" ${who && who.id === s.id ? "selected" : ""}>${escapeHtml(s.name)}${s.jobTitle ? ` — ${escapeHtml(s.jobTitle)}` : ""}</option>`).join("")}
        </select>
        <button class="ghost-btn" id="assign-btn">Assign</button>
      </div>`
    : "";

  const citizenPhone = report.citizenContact
    ? `<div class="contact-aside"><span class="decision-label">Citizen contact</span><a class="contact-link" href="tel:${escapeHtml(report.citizenContact.replace(/\s/g, ""))}">${icon("phone", 13)} ${escapeHtml(report.citizenContact)}</a> <span class="meta-dim">${escapeHtml(report.citizen || "")}</span></div>`
    : "";

  return `<div class="detail-section"><h3>${report.isOwner ? "Who is handling your report" : "Assigned officer"}</h3>${card}${picker}${citizenPhone}</div>`;
}

/** Two-way updates between the citizen and the authority. */
function messageThread(report) {
  if (!report.canComment) return "";

  const bubbles = (report.messages || []).map((m) => {
    const mine = m.userId === state.user.id;
    const staff = m.authorRole === "authority" || m.authorRole === "admin";
    return `<div class="message ${mine ? "mine" : ""} ${staff ? "staff" : ""}">
      <div class="message-head"><strong>${escapeHtml(m.authorName)}</strong><span>${staff ? escapeHtml(authorityName(m.authorityId)) : "Citizen"} · ${timeAgo(m.createdAt)}</span></div>
      <p>${escapeHtml(m.body)}</p>
    </div>`;
  }).join("");

  return `<div class="detail-section">
    <h3>Updates ${report.messages.length ? `<span class="count-pill">${report.messages.length}</span>` : ""}</h3>
    <div class="message-thread">${bubbles || emptyState("No updates yet. Post one to start the conversation.")}</div>
    <div class="message-compose">
      <textarea id="message-body" rows="2" placeholder="${state.role === "citizen" ? "Ask the officer a question, or add something you noticed…" : "Tell the citizen what happens next — when a crew is coming, what you need from them…"}"></textarea>
      <button class="primary-btn" id="message-send">Send</button>
    </div>
  </div>`;
}

function detailPage(report) {
  if (!report) return emptyState("That case could not be found.");
  const auth = (state.data.authorities || []).find((a) => a.id === report.authorityId);
  const photo = report.attachments.find((a) => a.kind === "image");
  const voice = report.attachments.find((a) => a.kind === "audio");
  const clip = report.attachments.find((a) => a.kind === "video");

  // The same case reads differently depending on which side of it you are on.
  const staffView = state.role !== "citizen";
  const banner = report.status === "Closed"
    ? ["Resolution confirmed by citizen", "This case is closed and preserved in the audit history."]
    : report.status === "Resolved"
      ? staffView
        ? ["Marked resolved — awaiting citizen confirmation", "The citizen can confirm the fix or dispute it if the issue is still present."]
        : ["Resolution is ready for your confirmation", "Please confirm whether the issue is actually fixed. You can dispute it if it is still present."]
      : staffView
        ? [`${report.assignee ? `Assigned to ${report.assignee.name}` : "Not yet assigned"}`, `Routed to ${auth ? auth.fullName : "your organisation"}. ${report.assignee ? "The citizen can see their name and number." : "Assign an officer so the citizen knows who to contact."}`]
        : ["Your report is with the responsible authority", `The case was routed to ${auth ? auth.fullName : "the responsible authority"} based on the issue and location.`];

  return `${pageHeading(`Case ${escapeHtml(report.id)}`, "One issue, followed through", "The full case history stays visible from first report to final confirmation.", `<button class="secondary-btn" data-view="${state.role === "citizen" ? "reports" : "cases"}">← Back to list</button>`)}
  <div class="success-banner"><strong>${banner[0]}</strong><span>${escapeHtml(banner[1])}</span></div>
  <div class="case-detail">
    <section class="card detail-main">
      <div class="detail-title">
        <div><div class="eyebrow">${escapeHtml(report.id)} · ${icon(CHANNEL_ICON[report.channel] || "text", 13)} ${escapeHtml(report.source || "")}</div><h1>${escapeHtml(report.title)}</h1><p>${icon("pin", 13)} ${escapeHtml(report.location || "Location not specified")} · Reported by ${escapeHtml(report.citizen || "a citizen")} · ${timeAgo(report.createdAt)}</p></div>
        <div class="detail-status"><span class="tag ${priorityClass(report.priority)}">${escapeHtml(report.priority)} priority</span><small>${escapeHtml(report.status)}</small></div>
      </div>

      ${photo || voice || clip || report.transcript ? `<div class="detail-section"><h3>Citizen evidence</h3><div class="evidence-grid">
        ${photo ? `<figure class="evidence-item"><img src="${photo.url}" alt="Photo submitted with the report" /><figcaption>Photo · ${Math.round(photo.size / 1024)} KB</figcaption></figure>` : ""}
        ${clip ? `<figure class="evidence-item wide"><video controls preload="metadata" src="${clip.url}"></video><figcaption>Video · ${(clip.size / 1048576).toFixed(1)} MB</figcaption></figure>` : ""}
        ${voice ? `<figure class="evidence-item"><audio controls src="${voice.url}"></audio><figcaption>Voice note · ${Math.round(voice.size / 1024)} KB</figcaption></figure>` : ""}
      </div>${report.transcript ? `<blockquote class="transcript">“${escapeHtml(report.transcript)}”<cite>${escapeHtml(report.aiMode === "gemini" ? `Transcribed by ${report.aiModel}` : "Browser transcript")}</cite></blockquote>` : ""}</div>` : ""}

      <div class="detail-section"><h3>AI interpretation</h3><div class="decision-grid">
        <div class="decision-box"><small>Issue category</small><strong>${escapeHtml(report.category || "—")}</strong></div>
        <div class="decision-box"><small>Responsible authority</small><strong class="teal">${escapeHtml(auth ? auth.name : "—")}</strong></div>
        <div class="decision-box"><small>AI confidence</small><strong>${report.confidence ?? "—"}%</strong></div>
        <div class="decision-box"><small>Triaged by</small><strong>${escapeHtml(report.aiMode === "heuristic" || !report.aiMode ? "Offline rules" : report.aiModel)}</strong></div>
      </div></div>

      <div class="detail-section"><h3>Why this priority?</h3><p class="detail-copy">${escapeHtml(report.summary || "")}</p><div class="report-meta">${(report.factors || []).map((f) => `<span class="tag status">${escapeHtml(f)}</span>`).join("")}</div></div>

      ${assignmentSection(report)}
      ${messageThread(report)}

      <div class="detail-section"><h3>Case history</h3><div class="timeline">${report.timeline.map((item) => `<div class="timeline-item ${item.kind}"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.by || "")} · ${timeAgo(item.time)}</small></div>`).join("")}</div></div>

      ${state.role === "authority"
        ? `<div class="detail-section"><h3>Authority action</h3><div class="status-actions"><button data-status="Under Review">Accept case</button><button data-status="In Progress">Mark in progress</button><button data-status="Resolved">Mark resolved</button></div></div>`
        : report.status === "Resolved" && report.userId === state.user.id
          ? `<div class="detail-section"><h3>Is this issue really resolved?</h3><div class="status-actions"><button data-confirm="resolved">${icon("check", 15)} Yes, it’s resolved</button><button data-confirm="disputed">${icon("history", 15)} No, it’s still present</button></div></div>`
          : ""}
    </section>

    <aside class="card analysis-card">
      <div class="eyebrow">Decision record</div><h2>AI + human oversight</h2>
      <p>Recommendations are validated by rules and can be changed by authorized staff.</p>
      <div class="decision"><span class="decision-label">Sensitive location</span><span class="decision-value">${report.sensitive ? `${icon("alert", 13)} ${escapeHtml(report.sensitive.name || report.sensitive.type)}` : "None detected"}</span>${report.sensitive ? `<small class="decision-warn">${escapeHtml(report.sensitive.distance || "Distance not specified")} · ${escapeHtml(report.sensitive.relevance)} relevance</small>` : ""}</div>
      <div class="decision"><span class="decision-label">Authenticity</span><span class="decision-value">${escapeHtml(report.authenticity || "—")}</span><div class="score-row"><div class="score-bar"><i style="width:${Math.max(6, 100 - (report.risk || 8))}%"></i></div><small>Risk ${report.risk ?? "—"}/100</small></div></div>
      <div class="decision"><span class="decision-label">Reported duration</span><span class="decision-value">${escapeHtml(report.duration || "Not specified")}</span></div>
      <div class="decision"><span class="decision-label">Incident cluster</span><span class="decision-value">${escapeHtml(report.duplicate || "No duplicate detected")}</span><small class="decision-note">${report.reports > 1 ? `${report.reports} citizen reports preserved` : "The system keeps checking nearby reports."}</small></div>
      <div class="notice"><strong>Mock integration.</strong> Authority handoff is simulated for this demonstration. No government system has been contacted.</div>
    </aside>
  </div>`;
}

/* ================================================================== */
/* Render + events                                                     */
/* ================================================================== */

const CRUMB = { overview:"Overview", report:"New report", reports:"My reports", nearby:"Nearby incidents", assigned:"Assigned to me", cases:"All cases", critical:"Critical queue", clusters:"Incident clusters", people:"People & access", rules:"Routing & rules", audit:"Audit history", detail:"Case detail" };

/** A case may be in the scoped list, the citizen's own list, or both. */
function findReport(id) {
  const pools = [state.data?.reports || [], state.data?.myReports || []];
  for (const pool of pools) {
    const found = pool.find((r) => r.id === id);
    if (found) return found;
  }
  return null;
}

/** The authority the signed-in staff member belongs to. */
function myAuthority() {
  if (!state.user || state.user.role !== "authority") return null;
  return (state.data?.authorities || []).find((a) => a.id === state.user.authorityId) || null;
}

function render() {
  const user = state.user;
  const org = myAuthority();
  navItems();

  $("#crumb-section").textContent = state.role === "citizen" ? "Civic space"
    : state.role === "authority" ? `${org ? org.name : "Authority"} operations`
    : "Administration";
  $("#crumb-title").textContent = state.view === "overview"
    ? (state.role === "citizen" ? `Good morning, ${user.name.split(" ")[0]}` : state.role === "authority" ? "Command center" : "Platform overview")
    : CRUMB[state.view] || "Overview";

  $("#user-name").textContent = user.name;
  $("#user-initials").textContent = user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  $("#user-role").textContent = state.role === "citizen" ? "Citizen account"
    : state.role === "authority" ? `${org ? org.name : "Authority"}${user.jobTitle ? ` · ${user.jobTitle}` : ""}`
    : "Platform administrator";
  $("#account-label").textContent = state.role === "citizen" ? "Citizen"
    : state.role === "authority" ? (org ? org.name : "Authority")
    : "Administrator";

  const view = state.view;
  const content =
    view === "report" ? reportForm()
    : view === "reports" ? reportsPage()
    : view === "nearby" ? nearbyPage()
    : view === "assigned" ? assignedPage()
    : view === "cases" ? casesPage()
    : view === "critical" ? casesPage("critical")
    : view === "clusters" ? casesPage()
    : view === "detail" ? detailPage(findReport(state.selected))
    : ["people","rules","audit"].includes(view) ? adminPage(view)
    : overview();

  $("#content").innerHTML = content;
  bindEvents();
  if (view === "report" && state.analysis) renderAnalysis(state.analysis);

  // Conversations read newest-last, so open them scrolled to the bottom.
  const thread = $(".message-thread");
  if (thread) thread.scrollTop = thread.scrollHeight;
}

function bindEvents() {
  $$("[data-view]").forEach((el) => el.addEventListener("click", () => navigate(el.dataset.view)));
  $$("[data-report]").forEach((el) => el.addEventListener("click", () => navigate("detail", el.dataset.report)));
  $$("[data-action='new-report']").forEach((el) => el.addEventListener("click", () => navigate("report")));
  $$("[data-new-channel]").forEach((el) => el.addEventListener("click", () => { state.intake.channel = el.dataset.newChannel; navigate("report"); }));

  // --- channel tabs
  $$("[data-channel]").forEach((el) => el.addEventListener("click", () => {
    if (isRecording()) stopRecording();
    state.intake.channel = el.dataset.channel;
    state.analysis = null;
    render();
  }));

  // --- text
  $("#intake-description")?.addEventListener("input", (e) => { state.intake.description = e.target.value; });
  $("#intake-caption")?.addEventListener("input", (e) => { state.intake.caption = e.target.value; });
  $("#intake-video-caption")?.addEventListener("input", (e) => { state.intake.caption = e.target.value; });
  $("#intake-transcript")?.addEventListener("input", (e) => { state.intake.transcript = e.target.value; });
  $("#intake-location")?.addEventListener("input", (e) => { state.intake.location = e.target.value; });
  $("#intake-area")?.addEventListener("change", (e) => { state.intake.area = e.target.value; });
  $("#speech-lang")?.addEventListener("change", (e) => { state.intake.speechLang = e.target.value; });

  // --- image
  const imageInput = $("#image-input");
  const drop = $("#image-drop");
  if (drop && imageInput) {
    drop.addEventListener("click", (event) => { if (!event.target.closest(".ghost-btn")) imageInput.click(); });
    drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("dragging"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
    drop.addEventListener("drop", (event) => { event.preventDefault(); drop.classList.remove("dragging"); acceptImage(event.dataTransfer.files[0]); });
    imageInput.addEventListener("change", (event) => acceptImage(event.target.files[0]));
    $("#image-replace")?.addEventListener("click", () => imageInput.click());
    $("#image-clear")?.addEventListener("click", () => {
      if (state.intake.image?.previewUrl) URL.revokeObjectURL(state.intake.image.previewUrl);
      state.intake.image = null; state.analysis = null; render();
    });
  }

  // --- video
  const videoInput = $("#video-input");
  const videoDrop = $("#video-drop");
  if (videoDrop && videoInput) {
    videoDrop.addEventListener("click", (event) => { if (!event.target.closest(".ghost-btn") && event.target.tagName !== "VIDEO") videoInput.click(); });
    videoDrop.addEventListener("dragover", (event) => { event.preventDefault(); videoDrop.classList.add("dragging"); });
    videoDrop.addEventListener("dragleave", () => videoDrop.classList.remove("dragging"));
    videoDrop.addEventListener("drop", (event) => { event.preventDefault(); videoDrop.classList.remove("dragging"); acceptVideo(event.dataTransfer.files[0]); });
    videoInput.addEventListener("change", (event) => acceptVideo(event.target.files[0]));
    $("#video-replace")?.addEventListener("click", () => videoInput.click());
    $("#video-clear")?.addEventListener("click", () => {
      if (state.intake.video?.url) URL.revokeObjectURL(state.intake.video.url);
      state.intake.video = null; state.analysis = null; render();
    });
  }

  // --- voice
  $("#record-btn")?.addEventListener("click", () => { if (isRecording()) stopRecording(); else startRecording(); });

  const clearAudio = () => {
    if (state.intake.audio?.url) URL.revokeObjectURL(state.intake.audio.url);
    state.intake.audio = null;
    state.intake.transcript = "";
    state.analysis = null;
  };
  $("#audio-clear")?.addEventListener("click", () => { clearAudio(); render(); });
  $("#audio-rerecord")?.addEventListener("click", () => { clearAudio(); render(); startRecording(); });

  // --- location
  $("#locate-btn")?.addEventListener("click", () => {
    if (!navigator.geolocation) return toast("This browser can’t share your location. Type the nearest landmark instead.");
    toast("Getting your location…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        state.intake.latitude = position.coords.latitude;
        state.intake.longitude = position.coords.longitude;
        render();
        toast("Location attached. It is used only to route this report.");
      },
      () => toast("Location access was blocked. Type the nearest landmark instead."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });

  $("#analyze-btn")?.addEventListener("click", analyzeIntake);

  // --- assignment
  $("#assign-btn")?.addEventListener("click", async () => {
    const button = $("#assign-btn");
    button.disabled = true;
    try {
      await api(`/api/complaints/${state.selected}/assign`, {
        method: "POST",
        body: JSON.stringify({ assigneeId: $("#assign-select").value || null }),
      });
      await load();
      toast("Assignment updated. The citizen can now see who to contact.");
    } catch (error) {
      button.disabled = false;
      toast(error.message);
    }
  });

  // --- case updates
  const send = async () => {
    const box = $("#message-body");
    const body = box.value.trim();
    if (!body) return toast("Write a message first.");
    const button = $("#message-send");
    button.disabled = true;
    try {
      await api(`/api/complaints/${state.selected}/messages`, { method: "POST", body: JSON.stringify({ body }) });
      await load();
    } catch (error) {
      button.disabled = false;
      toast(error.message);
    }
  };
  $("#message-send")?.addEventListener("click", send);
  // Enter sends, Shift+Enter for a new line.
  $("#message-body")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); }
  });

  $$("[data-status]").forEach((el) => el.addEventListener("click", () => updateCase({ status: el.dataset.status })));
  $$("[data-confirm]").forEach((el) => el.addEventListener("click", () => updateCase({ confirmation: el.dataset.confirm })));
}

async function updateCase(payload) {
  try {
    await api(`/api/complaints/${state.selected}`, { method: "PATCH", body: JSON.stringify(payload) });
    await load();
    toast(payload.confirmation === "resolved" ? "Thank you — resolution confirmed." : "Case updated and preserved in the audit history.");
  } catch (error) {
    toast(error.message);
  }
}

async function load() {
  // The server scopes the dashboard to the signed-in account.
  state.data = await api("/api/dashboard");
  state.user = state.data.user;
  state.role = state.data.user.role;

  // Colleagues available for assignment, fetched once per session.
  if (state.role === "authority" && !state.staff) {
    try { state.staff = (await api("/api/staff")).staff; } catch { state.staff = []; }
  }
  render();
}

$("#signout").addEventListener("click", signOut);

(async function boot() {
  // The server only serves this page to a signed-in account, so the view comes
  // straight from the URL — a refresh or a shared link lands where it should.
  const { view, selected } = readLocation();
  state.view = view;
  state.selected = selected;
  history.replaceState({ view, id: selected }, "", location.pathname);

  try {
    state.config = await api("/api/config");
    await load();

    if (!state.config.aiEnabled) {
      toast("Running offline keyword triage. Set GEMINI_API_KEY in .env for real multimodal AI.");
    }
  } catch (error) {
    if (error.status === 401) return goToLogin();
    $("#content").innerHTML = `<div class="notice"><strong>Unable to load Civic Space.</strong> ${escapeHtml(error.message)}</div>`;
  }
})();
