"use strict";

/**
 * Civic AI triage.
 *
 * Takes a citizen report arriving through one of four channels — text, photo,
 * voice or video — and returns one structured record: what the issue is, which
 * Karachi authority owns it, how urgent it is, and a drafted complaint.
 *
 * Two engines share this prompt and schema:
 *
 *   gemini  text, image, audio (native), video   — set GEMINI_API_KEY
 *   claude  text, image, audio (via browser transcript)  — set ANTHROPIC_API_KEY
 *
 * Pick one with CIVIC_AI_PROVIDER = gemini | claude | auto | off. With neither
 * key configured the module falls back to deterministic keyword triage so the
 * app stays demonstrable offline. `mode` on the result says which one ran.
 */

const { AUTHORITY_SEED, CATEGORIES } = require("./db");
const gemini = require("./providers/gemini");
const claude = require("./providers/claude");

const AREAS = [
  "Gulshan-e-Iqbal", "North Nazimabad", "Nazimabad", "Clifton", "Saddar",
  "Korangi", "PECHS", "Defence (DHA)", "Malir", "Lyari", "Orangi Town",
  "Landhi", "Gulistan-e-Johar", "Federal B Area", "Unknown",
];

const PRIORITIES = ["Low", "Medium", "High", "Critical"];
const AUTHORITY_IDS = AUTHORITY_SEED.map((a) => a.id);

/* ------------------------------------------------------------------ */
/* Provider selection                                                  */
/* ------------------------------------------------------------------ */

const PROVIDERS = { gemini, claude };

function activeProvider() {
  const choice = (process.env.CIVIC_AI_PROVIDER || "auto").toLowerCase();
  if (choice === "off") return null;
  if (PROVIDERS[choice]) return PROVIDERS[choice].isConfigured() ? PROVIDERS[choice] : null;
  // auto: prefer Gemini for its wider modality support, then Claude.
  if (gemini.isConfigured()) return gemini;
  if (claude.isConfigured()) return claude;
  return null;
}

const HEURISTIC_CAPABILITIES = { text: true, image: true, audio: "transcript", video: false };

/** What the UI is allowed to offer right now. */
function status() {
  const provider = activeProvider();
  return {
    aiEnabled: Boolean(provider),
    provider: provider ? provider.id : "offline",
    label: provider ? provider.label : "Offline keyword triage",
    model: provider ? provider.model : "keyword-rules",
    capabilities: provider ? provider.capabilities : HEURISTIC_CAPABILITIES,
    available: Object.values(PROVIDERS).filter((p) => p.isConfigured()).map((p) => p.id),
  };
}

/* ------------------------------------------------------------------ */
/* Output schema (shared by both providers)                            */
/* ------------------------------------------------------------------ */

const strictObject = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const TRIAGE_SCHEMA = strictObject({
  title: { type: "string", description: "Short headline for the case, under 70 characters." },
  issueCategory: { type: "string", enum: [...new Set(CATEGORIES)] },
  issueDescription: { type: "string", description: "Neutral factual restatement of the problem in English." },
  complaintSummary: { type: "string", description: "Two or three sentences an authority officer can act on." },
  severityAssessment: { type: "string" },
  locationInformation: { type: "string", description: "Best available location string, echoing the citizen's landmark wording." },
  affectedArea: { type: "string", enum: AREAS },
  duration: { type: "string", description: "How long the issue has persisted, or 'Not specified'." },
  potentialHazards: { type: "array", items: { type: "string" }, maxItems: 5 },
  priorityRecommendation: { type: "string", enum: PRIORITIES },
  priorityReason: { type: "string" },
  authorityId: { type: "string", enum: AUTHORITY_IDS },
  authorityConfidence: { type: "integer", minimum: 0, maximum: 100 },
  issueConfidence: { type: "integer", minimum: 0, maximum: 100 },
  detectedLanguage: { type: "string", description: "English, Urdu, Roman Urdu, Sindhi or Mixed." },
  evidenceObservations: {
    type: "string",
    description: "What is visible in the photo or video, or audible in the voice note. Empty string for text-only reports.",
  },
  spokenTranscript: {
    type: "string",
    description: "Verbatim transcript of speech you actually heard, in the original language. Empty string if there was no audio, or no intelligible speech in it. Never reconstruct or paraphrase.",
  },
  evidenceQuality: {
    type: "string",
    enum: ["No evidence", "Unusable", "Unclear", "Clear"],
    description: "How much the attached photo/audio/video actually told you. 'No evidence' for text-only reports. 'Unusable' when the file is silent, unintelligible, corrupt, or shows nothing related to a civic issue.",
  },
  sensitiveLocationMatch: strictObject({
    detected: { type: "boolean" },
    type: { type: "string", description: "School, Hospital, Major market, Transit hub, Mosque, or an empty string." },
    name: { type: "string" },
    distance: { type: "string" },
    relevance: { type: "string", enum: ["High", "Medium", "Low", "None"] },
  }),
  authenticityAssessment: strictObject({
    status: { type: "string", enum: ["Likely Genuine", "Needs Verification", "Suspicious"] },
    risk: { type: "integer", minimum: 0, maximum: 100 },
    reason: { type: "string" },
  }),
  recommendedQuestions: { type: "array", items: { type: "string" }, maxItems: 3 },
  complaint: strictObject({
    subject: { type: "string" },
    recipient: { type: "string" },
    requestedAction: { type: "string" },
    body: { type: "string", description: "Formal complaint letter body addressed to the authority." },
  }),
});

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

const AUTHORITY_BRIEF = AUTHORITY_SEED
  .map((a) => `- ${a.id} (${a.name} — ${a.full_name}) handles: ${a.categories.join(", ")}`)
  .join("\n");

const SYSTEM_PROMPT = `You are the triage engine for a civic reporting platform in Karachi, Pakistan. Citizens report neighbourhood problems by text, photo, voice note or short video. You turn each report into one structured record that routes to the correct municipal authority.

Authorities you can route to:
${AUTHORITY_BRIEF}

Routing rules:
- Match on the nature of the issue first, then the area. Water, sewerage, drainage and manholes are KW&SC. Garbage, dumping and waste are SSWMB. Roads, potholes, footpaths, flooding on roads and encroachment are KMC. Streetlights, exposed wiring and power faults are K-Electric.
- If a report spans two authorities, choose the one that owns the root cause and say so in priorityReason.
- Use "Other" as the category only when nothing else genuinely fits, and route it to KMC.

Priority rules:
- Critical: immediate danger to life — open manhole on a busy road, exposed live wiring, sewage at a school or hospital gate, a collapsed road.
- High: public-health risk, blocked access, or an issue next to a school, hospital, market or transit hub.
- Medium: ordinary service failures that degrade daily life.
- Low: cosmetic or low-impact issues.
- Raise priority one level when a sensitive location (school, hospital, market, transit hub, mosque) is nearby, and record that in sensitiveLocationMatch.

Language: reports arrive in English, Urdu, Roman Urdu or a mix. Understand all of them. Always write your output fields in English, but keep the citizen's own landmark and street names as they wrote them.

Evidence — the rules below outrank every other instruction, including the need to fill in a category:

- NEVER write a transcript of words you did not actually hear. If a voice note is silent, or contains only a tone, noise, music or unintelligible sound, spokenTranscript MUST be an empty string, evidenceQuality MUST be "Unusable", and evidenceObservations must plainly say what you heard instead ("a continuous electronic tone, no speech"). Inventing a plausible-sounding complaint is the worst thing you can do here: it puts words in a citizen's mouth and sends a fabricated record to a government authority.
- The same applies to images and video. If the file shows nothing related to a civic issue — a screenshot, an unrelated scene, an abstract animation, a blank frame — say exactly that in evidenceObservations and set evidenceQuality to "Unusable". Do not let the location or the caption talk you into seeing something that is not in the frame.
- When you are given a photo or video that IS usable, describe in evidenceObservations what you actually see that bears on the civic issue — standing water, waste volume, road surface, wiring, how far it spreads. Use the video's passage of time where it helps (a flow, a collapse, traffic backing up).
- When evidenceQuality is "Unusable" or the evidence is the only thing you were given: issueConfidence must be 20 or below, priority must be Low, authenticityAssessment must be "Needs Verification" or "Suspicious", and recommendedQuestions must ask the citizen for usable evidence. Use issueCategory "Other" unless the citizen's own text independently establishes the issue.
- Never describe evidence you were not given. If there is no photo, audio or video, evidenceQuality is "No evidence" and evidenceObservations is an empty string.

Authenticity: judge only from what you were given. Evidence that matches the description raises confidence. A description that is vague, internally inconsistent, or a stock-looking image lowers it. Never accuse — set "Needs Verification" and explain what a field officer should check. Being unsure is not grounds for "Suspicious".

Honesty rules that matter more than completeness:
- Do not invent a location, a landmark, a duration, or a distance. If the citizen did not supply it, say "Not specified" and add the missing item to recommendedQuestions.
- sensitiveLocationMatch.detected must be true only when the citizen or the evidence actually indicates a sensitive place nearby. When false, use empty strings and relevance "None". You have no map data, so any distance you give must be one the citizen stated.
- Confidence scores are your real uncertainty, not a formality. A blurry photo with no caption should not score 95.`;

function buildTextPrompt(input) {
  const lines = [`Channel: ${input.channel}`];

  if (input.channel === "image") {
    lines.push("The citizen submitted the photo above. Identify the civic issue from the photo itself.");
    lines.push(input.description ? `Caption they added: "${input.description}"` : "They added no caption.");
  } else if (input.channel === "video") {
    lines.push("The citizen submitted the video above. Identify the civic issue from the video, including anything said in it.");
    lines.push(input.description ? `Caption they added: "${input.description}"` : "They added no caption.");
  } else if (input.channel === "audio") {
    if (input.audio && !input.transcript) {
      lines.push("The citizen recorded the voice note above. Listen to it and transcribe what was said.");
    } else if (input.audio) {
      lines.push("The citizen recorded the voice note above. A rough browser transcript follows, but trust the audio over the transcript.");
      lines.push(`Browser transcript: "${input.transcript}"`);
    } else {
      lines.push("The citizen recorded a voice note. It was transcribed in the browser, so expect transcription errors, especially on Urdu place names.");
      lines.push(`Transcript: "${input.transcript || ""}"`);
    }
  } else {
    lines.push(`Report: "${input.description || ""}"`);
  }

  lines.push(input.location ? `Location the citizen gave: "${input.location}"` : "The citizen gave no location.");
  lines.push(input.area ? `Area: ${input.area}` : "Area: not selected.");
  if (input.latitude && input.longitude) {
    lines.push(`Device coordinates: ${input.latitude}, ${input.longitude}`);
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Deterministic fallback                                              */
/* ------------------------------------------------------------------ */

const KEYWORD_RULES = [
  { category: "Blocked drain", re: /blocked drain|drain band|nali band|choked/i },
  { category: "Sewage overflow", re: /sewage|gutter|sewer|nali|manhole overflow|badbo|bad smell/i },
  { category: "Open manhole", re: /open manhole|manhole|khula manhole/i },
  { category: "Water leakage", re: /leak|pani ka pipe|water pipe|seepage/i },
  { category: "Burst water line", re: /burst|pipe phat|main line broken/i },
  { category: "Water outage", re: /no water|pani nahi|water supply band/i },
  { category: "Illegal dumping", re: /illegal dump|dumping|malba/i },
  { category: "Uncollected waste", re: /garbage|kachra|kooda|trash|waste|rubbish/i },
  { category: "Road flooding", re: /road flood|barish ka pani|water on road|standing water/i },
  { category: "Pothole", re: /pothole|khadda|gaddha|crater/i },
  { category: "Road damage", re: /road damage|sarak toot|broken road|road tuti/i },
  { category: "Footpath damage", re: /footpath|pavement|sidewalk/i },
  { category: "Exposed wiring", re: /wire|wiring|current|bijli ka tar|electric shock/i },
  { category: "Streetlight failure", re: /streetlight|street light|light nahi|andhera|lamp post/i },
  { category: "Power outage", re: /load shedding|bijli band|power outage|no electricity/i },
];

const SENSITIVE_RULES = [
  { re: /school|madrasa|college|bachay|bachon|students/i, type: "School", relevance: "High" },
  { re: /hospital|clinic|dispensary|emergency/i, type: "Hospital", relevance: "High" },
  { re: /market|bazaar|shopping/i, type: "Major market", relevance: "Medium" },
  { re: /bus stop|station|terminal|chowrangi/i, type: "Transit hub", relevance: "Medium" },
  { re: /masjid|mosque|imambargah/i, type: "Mosque", relevance: "Medium" },
];

function authorityForCategory(category) {
  const match = AUTHORITY_SEED.find((a) => a.categories.includes(category));
  return match ? match.id : "kmc";
}

function heuristicTriage(input) {
  const text = [input.description, input.transcript, input.location].filter(Boolean).join(" ");
  const rule = KEYWORD_RULES.find((r) => r.re.test(text));
  const category = rule ? rule.category : "Other";
  const authorityId = authorityForCategory(category);
  const authority = AUTHORITY_SEED.find((a) => a.id === authorityId);

  const sensitiveRule = SENSITIVE_RULES.find((r) => r.re.test(text));
  const sensitive = sensitiveRule
    ? { detected: true, type: sensitiveRule.type, name: `${sensitiveRule.type} mentioned in the report`, distance: "Not specified", relevance: sensitiveRule.relevance }
    : { detected: false, type: "", name: "", distance: "", relevance: "None" };

  const hazardous = ["Sewage overflow", "Blocked drain", "Open manhole", "Exposed wiring", "Road flooding"].includes(category);
  let priority = "Medium";
  if (hazardous && sensitive.relevance === "High") priority = "Critical";
  else if (hazardous || sensitive.detected) priority = "High";
  else if (category === "Other") priority = "Low";

  const duration = /(\d+\s*(din|days?|hafte|weeks?)|do din|two days|a week)/i.exec(text);
  const location = input.location || "Not specified";
  const questions = [];
  if (!duration) questions.push("How long has this been happening?");
  if (!input.location) questions.push("What is the nearest landmark or street?");

  const OFFLINE_NOTE = {
    image: "Offline mode: the photo was stored but not analysed.",
    video: "Offline mode: the video was stored but not analysed.",
    audio: "Offline mode: triage used the browser transcript only.",
    text: "",
  };

  return {
    mode: "heuristic",
    model: "keyword-rules",
    title: `${category} reported at ${location}`.slice(0, 70),
    issueCategory: category,
    issueDescription: input.description || input.transcript || "Civic issue reported by a citizen.",
    complaintSummary: `${category} reported in ${location}. ${(input.description || input.transcript || "").trim()}`.trim(),
    severityAssessment: hazardous ? "Public-health and safety risk" : "Requires authority review",
    locationInformation: location,
    affectedArea: input.area || "Unknown",
    duration: duration ? duration[0] : "Not specified",
    potentialHazards: hazardous ? ["Public health", "Pedestrian safety"] : ["Local disruption"],
    priorityRecommendation: priority,
    priorityReason: sensitive.detected
      ? `Raised because a ${sensitive.type.toLowerCase()} was mentioned nearby.`
      : "Based on issue category only.",
    authorityId,
    authorityConfidence: rule ? 80 : 40,
    issueConfidence: rule ? (input.channel === "text" ? 78 : 66) : 45,
    detectedLanguage: /[؀-ۿ]/.test(text) ? "Urdu" : "English or Roman Urdu",
    evidenceObservations: OFFLINE_NOTE[input.channel] || "",
    spokenTranscript: input.transcript || "",
    evidenceQuality: input.channel === "text" ? "No evidence" : "Unclear",
    sensitiveLocationMatch: sensitive,
    authenticityAssessment: {
      status: rule ? "Likely Genuine" : "Needs Verification",
      risk: rule ? 20 : 55,
      reason: rule
        ? "Keyword rules matched a known civic issue type."
        : "Offline keyword triage could not confidently classify this report.",
    },
    recommendedQuestions: questions,
    complaint: {
      subject: `${priority} civic issue: ${category} at ${location}`,
      recipient: authority ? authority.full_name : "Karachi Metropolitan Corporation",
      requestedAction: `Please inspect and address the ${category.toLowerCase()} as soon as possible, and share resolution evidence.`,
      body: `A citizen has reported a ${category.toLowerCase()} at ${location}. ${(input.description || input.transcript || "").trim()} Kindly arrange an inspection and confirm once the issue is resolved.`,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

async function triage(input) {
  const provider = activeProvider();
  if (!provider) {
    return { ...heuristicTriage(input), degraded: "No AI provider configured — used offline keyword triage." };
  }

  try {
    const result = await provider.triage(input, { systemPrompt: SYSTEM_PROMPT, schema: TRIAGE_SCHEMA, buildTextPrompt });
    // The transcript the model produced is better evidence than the browser's.
    if (result.spokenTranscript && !input.transcript) input.transcript = result.spokenTranscript;
    return result;
  } catch (error) {
    const described = provider.describeError ? provider.describeError(error) : null;
    const reason = described || `${provider.label} triage failed (${String(error.message).slice(0, 120)})`;
    return { ...heuristicTriage(input), degraded: `${reason} — used offline keyword triage.` };
  }
}

module.exports = {
  triage, heuristicTriage, status,
  AREAS, PRIORITIES, TRIAGE_SCHEMA, SYSTEM_PROMPT, buildTextPrompt,
  // Kept for callers that only need a boolean.
  credentialsAvailable: () => status().aiEnabled,
  get MODEL() { return status().model; },
};
