const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 5000);
const publicDir = path.join(__dirname, "public");

const authorities = [
  { id: "kwsc", name: "KW&SC", fullName: "Karachi Water & Sewerage Corporation", color: "#1a9b93", areas: ["Gulshan-e-Iqbal", "North Nazimabad", "Clifton"] },
  { id: "sswmb", name: "SSWMB", fullName: "Sindh Solid Waste Management Board", color: "#d89127", areas: ["Gulshan-e-Iqbal", "Korangi", "Nazimabad"] },
  { id: "kmc", name: "KMC", fullName: "Karachi Metropolitan Corporation", color: "#e06d4f", areas: ["Saddar", "Clifton", "Gulshan-e-Iqbal"] },
];

const categories = [
  "Water leakage", "Burst water line", "Water outage", "Low water pressure",
  "Sewage overflow", "Blocked drain", "Open manhole", "Garbage accumulation",
  "Uncollected waste", "Illegal dumping", "Construction waste", "Road damage",
  "Pothole", "Road flooding", "Footpath damage", "Streetlight failure", "Other",
];

const seededReports = [
  {
    id: "CY-2408", title: "Sewage overflow near Beaconhouse School", category: "Sewage overflow",
    location: "Gulshan-e-Iqbal, Block 13-D", area: "Gulshan-e-Iqbal", authorityId: "kwsc",
    priority: "Critical", status: "In Progress", citizen: "Ayesha Khan", age: "2h ago",
    reports: 23, sensitive: { type: "School", name: "Beaconhouse School", distance: "180m", relevance: "High" },
    authenticity: "Likely Genuine", risk: 8, duplicate: "Incident INC-102",
    summary: "Sewage water has been standing on the road for two days, affecting children walking to school.",
    source: "Voice report + photo", confidence: 94, duration: "2 days",
    factors: ["Near a school", "Public health risk", "23 related reports"],
    timeline: [
      { label: "Submitted", time: "Today, 08:14", by: "Ayesha Khan", kind: "done" },
      { label: "AI triage complete", time: "Today, 08:15", by: "Civic AI", kind: "done" },
      { label: "Assigned to Gulshan field team", time: "Today, 08:32", by: "KW&SC", kind: "done" },
      { label: "Resolution evidence requested", time: "Pending", by: "Field team", kind: "active" },
    ],
  },
  {
    id: "CY-2407", title: "Overflowing drain on University Road", category: "Blocked drain",
    location: "Gulshan-e-Iqbal, University Road", area: "Gulshan-e-Iqbal", authorityId: "kwsc",
    priority: "High", status: "Assigned", citizen: "Usman Raza", age: "4h ago",
    reports: 8, sensitive: null, authenticity: "Likely Genuine", risk: 13, duplicate: "Incident INC-102",
    summary: "Bad smell and standing water outside the bus stop near University Road.",
    source: "Text report", confidence: 88, duration: "1 day",
    factors: ["Transit hub nearby", "8 related reports"],
    timeline: [{ label: "Submitted", time: "Today, 06:47", by: "Usman Raza", kind: "done" }, { label: "Assigned", time: "Today, 07:30", by: "KW&SC", kind: "active" }],
  },
  {
    id: "CY-2405", title: "Uncollected waste beside market", category: "Uncollected waste",
    location: "Gulshan-e-Iqbal, Block 7", area: "Gulshan-e-Iqbal", authorityId: "sswmb",
    priority: "Medium", status: "Under Review", citizen: "Sara Ahmed", age: "Yesterday",
    reports: 5, sensitive: { type: "Major market", name: "Gulshan Chowrangi Market", distance: "240m", relevance: "Medium" },
    authenticity: "Needs Verification", risk: 41, duplicate: null,
    summary: "Three days of uncollected waste has accumulated beside the market entrance.",
    source: "Photo + text", confidence: 82, duration: "3 days",
    factors: ["Near a market", "Duration over 48 hours"],
    timeline: [{ label: "Submitted", time: "Yesterday, 16:21", by: "Sara Ahmed", kind: "done" }, { label: "Verification requested", time: "Today, 08:50", by: "SSWMB", kind: "active" }],
  },
  {
    id: "CY-2403", title: "Pothole at Tariq Road intersection", category: "Pothole",
    location: "PECHS, Tariq Road", area: "PECHS", authorityId: "kmc",
    priority: "High", status: "Resolved", citizen: "Bilal Siddiqui", age: "2 days ago",
    reports: 12, sensitive: { type: "Public transport hub", name: "Tariq Road bus stop", distance: "90m", relevance: "Medium" },
    authenticity: "Likely Genuine", risk: 5, duplicate: "Incident INC-099",
    summary: "Large pothole is forcing traffic to merge suddenly near the bus stop.",
    source: "Photo report", confidence: 97, duration: "1 week",
    factors: ["Traffic safety", "Near a transit hub"],
    timeline: [{ label: "Submitted", time: "Sep 10, 09:10", by: "Bilal Siddiqui", kind: "done" }, { label: "Resolved", time: "Sep 11, 15:42", by: "KMC", kind: "done" }, { label: "Citizen confirmation", time: "Awaiting response", by: "Bilal Siddiqui", kind: "active" }],
  },
  {
    id: "CY-2401", title: "Possible reused photo of road flooding", category: "Road flooding",
    location: "Saddar, M.A. Jinnah Road", area: "Saddar", authorityId: "kmc",
    priority: "Medium", status: "Needs Verification", citizen: "Anonymous citizen", age: "3 days ago",
    reports: 1, sensitive: null, authenticity: "Suspicious", risk: 81, duplicate: null,
    summary: "The uploaded image may not correspond to the reported location. A human verification call is required.",
    source: "Photo report", confidence: 76, duration: "Unknown",
    factors: ["Image/location mismatch", "Evidence reused in 2 reports"],
    timeline: [{ label: "Submitted", time: "Sep 9, 14:11", by: "Citizen", kind: "done" }, { label: "Verification requested", time: "Sep 9, 14:14", by: "Civic AI", kind: "active" }],
  },
];

let reports = structuredClone(seededReports);
let audit = [
  { action: "Priority increased", detail: "CY-2408 increased to Critical because of nearby school and public-health risk.", by: "Civic AI + rules", time: "Today, 08:15" },
  { action: "Incident clustered", detail: "8 reports linked to INC-102 based on location, category and language similarity.", by: "Civic AI", time: "Today, 08:16" },
  { action: "Verification requested", detail: "CY-2405 requires field confirmation before resolution.", by: "SSWMB", time: "Today, 08:50" },
];

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; if (raw.length > 1e6) reject(new Error("Payload too large")); });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}

function chooseAuthority(category, area) {
  if (["Sewage overflow", "Blocked drain", "Open manhole", "Water leakage", "Burst water line", "Water outage", "Low water pressure"].includes(category)) return authorities.find((a) => a.id === "kwsc");
  if (["Garbage accumulation", "Uncollected waste", "Illegal dumping", "Construction waste"].includes(category)) return authorities.find((a) => a.id === "sswmb");
  return authorities.find((a) => a.areas.includes(area)) || authorities.find((a) => a.id === "kmc");
}

function analyze(input) {
  const text = `${input.description || ""} ${input.location || ""}`.toLowerCase();
  let category = "Other";
  if (/gutter|sewage|drain|nali|bad smell|sewer/.test(text)) category = text.includes("blocked") || text.includes("band") ? "Blocked drain" : "Sewage overflow";
  else if (/garbage|kachra|waste|dump/.test(text)) category = "Uncollected waste";
  else if (/pothole|road damage|khadda|sarak/.test(text)) category = "Pothole";
  else if (/light|streetlight|andhera/.test(text)) category = "Streetlight failure";
  else if (/water|pani|leak|pipe/.test(text)) category = "Water leakage";
  const sensitive = /school|school ke bach|hospital|clinic|market|bus stop/.test(text)
    ? (/hospital|clinic/.test(text) ? { type: "Hospital", name: "Aga Khan Community Clinic", distance: "220m", relevance: "High" } : /market/.test(text) ? { type: "Major market", name: "Gulshan Chowrangi Market", distance: "240m", relevance: "Medium" } : { type: "School", name: "Beaconhouse School", distance: "180m", relevance: "High" })
    : null;
  const authority = chooseAuthority(category, input.area || "Gulshan-e-Iqbal");
  const healthRisk = category === "Sewage overflow" || category === "Blocked drain";
  const critical = sensitive?.relevance === "High" && healthRisk;
  const priority = critical ? "Critical" : (healthRisk || sensitive ? "High" : "Medium");
  const risk = /photo|image|video/.test(text) ? 12 : 9;
  const duration = /two days|2 days|do din/.test(text) ? "Approximately 2 days" : "Not specified";
  return {
    issueCategory: category, issueDescription: input.description || "Civic issue reported by citizen",
    severityAssessment: priority === "Critical" ? "High public-health and pedestrian risk" : "Requires authority review",
    locationInformation: input.location || "Gulshan-e-Iqbal, Karachi",
    duration, affectedArea: input.area || "Gulshan-e-Iqbal", potentialHazards: healthRisk ? ["Public health", "Pedestrian safety"] : ["Local disruption"],
    recommendedAuthority: authority.name, authorityId: authority.id, authorityConfidence: 94, issueConfidence: category === "Other" ? 62 : 93,
    priorityRecommendation: priority, sensitiveLocationMatch: sensitive, authenticityAssessment: { status: "Likely Genuine", risk, reason: "Description, location and evidence type are consistent." },
    duplicateLikelihood: category === "Sewage overflow" ? "High — similar active reports nearby" : "Low", recommendedQuestions: duration === "Not specified" ? ["How long has this been happening?"] : [],
    complaintSummary: `${category} reported in ${input.location || "Gulshan-e-Iqbal"}. ${input.description || ""}`.trim(),
    complaint: {
      subject: `${priority} civic issue: ${category} at ${input.location || "Gulshan-e-Iqbal"}`,
      recipient: authority.fullName,
      requestedAction: `Please inspect and address the ${category.toLowerCase()} as soon as possible. Provide an update with resolution evidence.`,
    },
  };
}

function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    const authorityId = url.searchParams.get("authority");
    const visible = authorityId ? reports.filter((r) => r.authorityId === authorityId) : reports;
    return json(res, 200, { reports: visible, authorities, categories, audit, metrics: {
      total: reports.length + 46, open: reports.filter((r) => !["Resolved", "Closed"].includes(r.status)).length + 29,
      critical: reports.filter((r) => r.priority === "Critical").length + 3, suspicious: reports.filter((r) => ["Suspicious", "Needs Verification"].includes(r.authenticity)).length + 2,
      citizens: 1284, resolutionRate: 78, incidents: 18,
    } });
  }
  if (req.method === "POST" && url.pathname === "/api/analyze") {
    return body(req).then((input) => json(res, 200, { analysis: analyze(input) })).catch((e) => json(res, 400, { error: e.message }));
  }
  if (req.method === "POST" && url.pathname === "/api/reports") {
    return body(req).then((input) => {
      const analysis = analyze(input);
      const report = { id: `CY-${String(2410 + reports.length).padStart(4, "0")}`, title: analysis.complaint.subject.replace(`${analysis.priority} civic issue: `, ""), category: analysis.issueCategory, location: analysis.locationInformation, area: analysis.affectedArea, authorityId: analysis.authorityId, priority: analysis.priorityRecommendation, status: "Submitted", citizen: "You", age: "Just now", reports: 1, sensitive: analysis.sensitiveLocationMatch, authenticity: analysis.authenticityAssessment.status, risk: analysis.authenticityAssessment.risk, duplicate: null, summary: analysis.complaintSummary, source: input.source || "Text report", confidence: analysis.issueConfidence, duration: analysis.duration, factors: analysis.sensitiveLocationMatch ? ["Sensitive location nearby"] : ["Awaiting field assessment"], timeline: [{ label: "Submitted", time: "Just now", by: "You", kind: "done" }, { label: "AI triage complete", time: "Just now", by: "Civic AI", kind: "active" }], analysis };
      reports.unshift(report);
      audit.unshift({ action: "New report submitted", detail: `${report.id} routed to ${analysis.recommendedAuthority}.`, by: "You + Civic AI", time: "Just now" });
      return json(res, 201, { report });
    }).catch((e) => json(res, 400, { error: e.message }));
  }
  if (req.method === "PATCH" && url.pathname.startsWith("/api/reports/")) {
    const id = url.pathname.split("/").pop();
    return body(req).then((input) => {
      const report = reports.find((item) => item.id === id);
      if (!report) return json(res, 404, { error: "Report not found" });
      if (input.status) { report.status = input.status; report.timeline.push({ label: input.status, time: "Just now", by: input.by || "Authority user", kind: "active" }); audit.unshift({ action: `Case status changed to ${input.status}`, detail: `${id} updated and preserved in the case history.`, by: input.by || "Authority user", time: "Just now" }); }
      if (input.confirmation) { report.status = input.confirmation === "resolved" ? "Closed" : "Escalated"; report.timeline.push({ label: input.confirmation === "resolved" ? "Citizen confirmed resolution" : "Citizen disputed resolution", time: "Just now", by: "You", kind: "active" }); }
      return json(res, 200, { report });
    }).catch((e) => json(res, 400, { error: e.message }));
  }
  return false;
}

const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  const filePath = path.join(publicDir, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(publicDir)) return json(res, 403, { error: "Forbidden" });
  fs.readFile(filePath, (err, file) => {
    if (err) return json(res, 404, { error: "Not found" });
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(file);
  });
});
server.listen(PORT, "0.0.0.0", () => console.log(`The City Around You running on port ${PORT}`));