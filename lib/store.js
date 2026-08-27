import { DEFAULT_SETTINGS } from "./style-identity";

// Storage: Upstash Redis via REST when configured (production on Vercel),
// otherwise an in-memory object (local dev / preview) that resets on restart.
// Same pattern as the recipe app.

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const hasRedis = Boolean(url && token);

async function redis(command) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Redis error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.result;
}

// Empty wardrobe/inspo/profile on first run; settings seeded with the
// Bornstein style identity.
const SEEDS = {
  wardrobe: [],
  inspo: [],
  styleProfile: [],
  looks: [], // saved outfit suggestions
  // "not my thing" / "love this" feedback on suggested outfits. Not read
  // back for display - the suggestion engine mines it for pairs of pieces
  // to avoid or lean into. See deriveFeedbackPairs in app/api/suggest.
  feedback: [],
  settings: DEFAULT_SETTINGS,
};

export const DATA_KEYS = Object.keys(SEEDS);

function mem() {
  if (!globalThis.__stylistMem) {
    globalThis.__stylistMem = {
      data: structuredClone(SEEDS),
      images: {},
    };
  }
  return globalThis.__stylistMem;
}

export async function getData(key) {
  if (!hasRedis) return mem().data[key];
  const raw = await redis(["GET", `stylist:${key}`]);
  if (raw == null) {
    await redis(["SET", `stylist:${key}`, JSON.stringify(SEEDS[key])]);
    return structuredClone(SEEDS[key]);
  }
  return JSON.parse(raw);
}

export async function setData(key, value) {
  if (!hasRedis) {
    mem().data[key] = value;
    return;
  }
  await redis(["SET", `stylist:${key}`, JSON.stringify(value)]);
}

// Images are stored one per key (data URL string), so a wardrobe of photos
// never has to move as a single giant record.
export async function getImage(id) {
  if (!hasRedis) return mem().images[id] || null;
  return await redis(["GET", `stylist:img:${id}`]);
}

export async function setImage(id, dataUrl) {
  if (!hasRedis) {
    mem().images[id] = dataUrl;
    return;
  }
  await redis(["SET", `stylist:img:${id}`, dataUrl]);
}

export async function delImage(id) {
  if (!hasRedis) {
    delete mem().images[id];
    return;
  }
  await redis(["DEL", `stylist:img:${id}`]);
}

// One password gates BOTH viewing and editing (unlike the recipe app, which
// is view-open): the wardrobe holds photos of the owner and what they own,
// so the whole thing is private. Accepts the header (fetch calls) or the
// httpOnly cookie set at login (lets plain <img src="/api/image/..."> work).
export function checkAuth(request) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) {
    // No password configured: open in local dev, locked in production
    // so a forgotten env var can't leave the live site world-readable.
    return process.env.NODE_ENV !== "production";
  }
  if (request.headers.get("x-admin-key") === pw) return true;
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)stylist-key=([^;]*)/);
  return m ? decodeURIComponent(m[1]) === pw : false;
}
