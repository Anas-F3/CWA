"use strict";

/**
 * Gemini triage provider.
 *
 * Gemini accepts all four of our input modalities natively — text, image,
 * audio and video — so a voice note can be sent as actual audio rather than
 * relying on the browser to transcribe it first, and video is supported at all.
 *
 * Media under INLINE_LIMIT travels inline as base64. Anything larger goes
 * through the Files API (upload -> poll until ACTIVE -> reference by URI),
 * which matters because a phone video easily exceeds the ~20 MB request cap.
 */

const { GoogleGenAI } = require("@google/genai");

// gemini-3.5-flash is the default because every modality here (text, image,
// audio, video) was verified against it. The rest are retry targets for the
// transient "high demand" 503s the newer previews return under load.
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3-flash-preview", "gemini-3.6-flash"];

const INLINE_LIMIT = 15 * 1024 * 1024;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

let client = null;
function getClient() {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

const isConfigured = () => Boolean(process.env.GEMINI_API_KEY);

function statusOf(error) {
  if (typeof error.status === "number") return error.status;
  const match = /"code"\s*:\s*(\d{3})/.exec(String(error.message || ""));
  return match ? Number(match[1]) : 0;
}

/* ------------------------------------------------------------------ */
/* Media parts                                                         */
/* ------------------------------------------------------------------ */

async function uploadLarge(media) {
  const ai = getClient();
  let file = await ai.files.upload({
    file: new Blob([media.buffer], { type: media.mime }),
    config: { mimeType: media.mime },
  });

  // A file cannot be referenced until it leaves PROCESSING.
  const deadline = Date.now() + 90_000;
  while (file.state === "PROCESSING") {
    if (Date.now() > deadline) throw new Error("Gemini took too long to process the upload.");
    await new Promise((r) => setTimeout(r, 1500));
    file = await ai.files.get({ name: file.name });
  }
  if (file.state === "FAILED") throw new Error("Gemini could not process that file.");
  return file;
}

async function mediaPart(media, uploaded) {
  if (media.buffer.length <= INLINE_LIMIT) {
    return { part: { inlineData: { mimeType: media.mime, data: media.data } }, file: null };
  }
  const file = await uploadLarge(media);
  uploaded.push(file);
  return { part: { fileData: { fileUri: file.uri, mimeType: file.mimeType } }, file };
}

/* ------------------------------------------------------------------ */
/* Triage                                                              */
/* ------------------------------------------------------------------ */

async function triage(input, { systemPrompt, schema, buildTextPrompt }) {
  const ai = getClient();
  const parts = [];
  const uploaded = [];

  try {
    for (const media of [input.image, input.audio, input.video]) {
      if (media) parts.push((await mediaPart(media, uploaded)).part);
    }
    parts.push({ text: buildTextPrompt(input) });

    const models = [DEFAULT_MODEL, ...FALLBACK_MODELS.filter((m) => m !== DEFAULT_MODEL)];
    let lastError = null;

    for (const model of models) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: "application/json",
            responseSchema: schema,
            temperature: 0.2,
          },
        });

        const text = response.text;
        if (!text || !text.trim()) throw new Error("Gemini returned an empty triage result.");

        const usage = response.usageMetadata || {};
        return {
          ...JSON.parse(text),
          mode: "gemini",
          model,
          usage: { input: usage.promptTokenCount, output: usage.candidatesTokenCount, thoughts: usage.thoughtsTokenCount },
        };
      } catch (error) {
        lastError = error;
        if (!RETRYABLE.has(statusOf(error))) throw error;
      }
    }
    throw lastError;
  } finally {
    // Uploaded files are transient evidence; the copy of record is our own DB.
    for (const file of uploaded) {
      ai.files.delete({ name: file.name }).catch(() => {});
    }
  }
}

module.exports = {
  id: "gemini",
  label: "Gemini",
  get model() { return DEFAULT_MODEL; },
  capabilities: { text: true, image: true, audio: "native", video: true },
  isConfigured,
  triage,
  statusOf,
};
