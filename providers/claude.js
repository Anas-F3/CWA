"use strict";

/**
 * Claude triage provider.
 *
 * The Messages API accepts text and images. It does not accept audio or video,
 * so a voice note reaches this provider as the browser's Web Speech transcript,
 * and the video channel is not offered when Claude is the active provider.
 */

const Anthropic = require("@anthropic-ai/sdk");

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || process.env.CIVIC_MODEL || "claude-opus-5";

let client = null;
function getClient() {
  // The SDK resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth
  // login` profile itself — don't pass a key explicitly.
  if (!client) client = new Anthropic();
  return client;
}

const isConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

async function triage(input, { systemPrompt, schema, buildTextPrompt }) {
  const content = [];
  if (input.image) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: input.image.mime, data: input.image.data },
    });
  }
  content.push({ type: "text", text: buildTextPrompt(input) });

  const response = await getClient().messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 4000,
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema },
    },
  });

  if (response.stop_reason === "refusal") {
    const category = response.stop_details ? response.stop_details.category : "unknown";
    throw new Error(`Triage declined by safety classifier (${category}).`);
  }

  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  if (!text.trim()) throw new Error("Claude returned an empty triage result.");

  // Structured output JSON must be parsed, never string-matched.
  return {
    ...JSON.parse(text),
    mode: "claude",
    model: response.model,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens,
    },
  };
}

function describeError(error) {
  if (error instanceof Anthropic.AuthenticationError) return "Anthropic credentials were rejected";
  if (error instanceof Anthropic.RateLimitError) return "Rate limited by the Claude API";
  if (error instanceof Anthropic.APIError) return `Claude API error ${error.status}`;
  return null;
}

module.exports = {
  id: "claude",
  label: "Claude",
  get model() { return DEFAULT_MODEL; },
  capabilities: { text: true, image: true, audio: "transcript", video: false },
  isConfigured,
  triage,
  describeError,
};
