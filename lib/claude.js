// Thin server-side wrapper around the Anthropic Messages API. No SDK - one
// fetch, same spirit as the recipe app's zero-dependency approach.

const API_URL = "https://api.anthropic.com/v1/messages";

export function hasClaude() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// One automatic retry on rate limits / transient upstream errors, and a hard
// timeout so a hung call fails cleanly instead of riding out the function's
// whole execution window.
export async function claude({
  system,
  messages,
  maxTokens = 3000,
  timeoutMs = 90_000,
}) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.CLAUDE_MODEL || "claude-sonnet-4-5",
          max_tokens: maxTokens,
          system,
          messages,
        }),
      });
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        const err = new Error(`Claude API ${res.status}: ${await res.text()}`);
        if (retryable && attempt === 0) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        throw err;
      }
      const data = await res.json();
      const text = data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (!text) throw new Error("Claude API returned an empty reply");
      return text;
    } catch (e) {
      // Network failures and timeouts get the same single retry.
      if (attempt === 0 && !String(e.message).startsWith("Claude API")) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

// Turn a stored data-URL image into an API image block.
export function imageBlock(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(
    dataUrl || ""
  );
  if (!m) return null;
  return {
    type: "image",
    source: { type: "base64", media_type: m[1], data: m[2] },
  };
}

// Extract the first JSON object from a model reply (tolerates fences/preamble).
export function parseJson(text) {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("No JSON in model reply");
  // Walk to the matching close brace so trailing prose doesn't break parsing.
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error("Unbalanced JSON in model reply");
}
