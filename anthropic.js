/* =========================================================================
   anthropic.js — Module API Anthropic (Phase 2)
   Appels directs depuis le navigateur avec streaming.
   Le header `anthropic-dangerous-direct-browser-access: true` est requis
   pour autoriser les appels CORS depuis un navigateur.
   ========================================================================= */

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-5-20250929";

const buildHeaders = (apiKey) => ({
  "x-api-key": apiKey,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
  "content-type": "application/json",
});

/**
 * Appel streaming — pousse chaque delta via onDelta(delta, full).
 */
export async function streamMessage({ apiKey, system, messages, maxTokens = 2048, onDelta }) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    const err = await res.text();
    throw new Error(`Anthropic ${res.status} — ${err.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload);
        if (evt.type === "content_block_delta" && evt.delta?.text) {
          full += evt.delta.text;
          if (onDelta) onDelta(evt.delta.text, full);
        }
      } catch {}
    }
  }
  return full;
}
