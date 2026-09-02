import { DEFAULT_SETTINGS } from "./style-identity";

// Storage: Upstash Redis via REST when configured (production on Vercel),
// otherwise an in-memory object (local dev / preview) that resets on restart.

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

// Login throttling. A single shared password with no brute-force protection
// is only as strong as the password; this puts a ceiling on guessing speed.
// Failed attempts are counted per client IP in Redis with a rolling window:
// once the count hits LOGIN_MAX_FAILURES the login route refuses further
// attempts until the window expires, and a successful login clears the
// count. Redis-backed (not in-memory) because Vercel runs many isolated
// serverless instances - a per-instance counter would be trivially bypassed.
// With no Redis configured (local dev) there is nothing to protect and the
// limiter stays out of the way entirely.
const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_SECONDS = 15 * 60;

function loginKey(ip) {
  return `stylist:login-fail:${ip}`;
}

export async function loginBlocked(ip) {
  if (!hasRedis) return false;
  const n = await redis(["GET", loginKey(ip)]);
  return Number(n) >= LOGIN_MAX_FAILURES;
}

export async function recordLoginFailure(ip) {
  if (!hasRedis) return;
  const key = loginKey(ip);
  const n = await redis(["INCR", key]);
  // Start the window on the first failure, so the block always lifts
  // LOGIN_WINDOW_SECONDS after the first bad guess rather than the last.
  if (n === 1) await redis(["EXPIRE", key, LOGIN_WINDOW_SECONDS]);
}

export async function clearLoginFailures(ip) {
  if (!hasRedis) return;
  await redis(["DEL", loginKey(ip)]);
}

// One password gates BOTH viewing and editing: the wardrobe holds photos
// of the owner and what they own,
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
