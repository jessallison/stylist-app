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
    // Best-effort: give a freshly-seeded key an explicit starting version so
    // it lines up with getVersion()'s own default below. Not awaited-for
    // correctness (getVersion's fallback already covers a missing key) -
    // just avoids a redundant extra round trip on every first read.
    redis(["SET", `stylist:ver:${key}`, "1"]).catch(() => {});
    return structuredClone(SEEDS[key]);
  }
  return JSON.parse(raw);
}

// The version counter behind setData()'s optimistic-concurrency check below.
// A key that's never been explicitly versioned yet (seeded but never
// written through the version-aware path) reads as version 1 - that has to
// match the version setData() assumes when nothing else has run first, or
// the very first write after this feature shipped would spuriously look
// like a version it never actually was.
export async function getVersion(key) {
  if (!hasRedis) {
    const store = mem();
    if (!store.versions) store.versions = {};
    return store.versions[key] || 1;
  }
  const raw = await redis(["GET", `stylist:ver:${key}`]);
  return raw ? parseInt(raw, 10) : 1;
}

// Two tabs, two devices, or a tab left open across a day both loading the
// same data and both saving it back have no way to know about each other -
// today's save() is a plain overwrite, and the extensive comments in
// app/page.js's save() document two real data-loss bugs that already came
// out of that gap within a single tab. This adds the missing check: pass
// the version the caller last read as `expectedVersion` and the write is
// rejected (not applied) if the stored version has since moved on, instead
// of silently clobbering whatever the other write put there.
//
// This is a plain read-then-write, not one atomic Redis operation - so two
// writes to the very same key within the same network round trip (sub-100ms
// apart) could in principle both pass the check. That's not a regression:
// it's exactly what every write does today with no check at all. This only
// narrows the window; the realistic failure mode this was built for - two
// browser tabs or devices open minutes apart - is fully covered.
//
// Pass no expectedVersion to keep the old unconditional-overwrite behaviour
// (used by nothing currently, kept for any future caller that genuinely
// doesn't care).
export async function setData(key, value, expectedVersion) {
  if (!hasRedis) {
    const store = mem();
    if (!store.versions) store.versions = {};
    const current = store.versions[key] || 1;
    if (expectedVersion != null && expectedVersion !== current) {
      return { ok: false, currentVersion: current };
    }
    mem().data[key] = value;
    store.versions[key] = current + 1;
    return { ok: true, version: store.versions[key] };
  }
  const current = await getVersion(key);
  if (expectedVersion != null && expectedVersion !== current) {
    return { ok: false, currentVersion: current };
  }
  await redis(["SET", `stylist:${key}`, JSON.stringify(value)]);
  const next = current + 1;
  await redis(["SET", `stylist:ver:${key}`, String(next)]);
  return { ok: true, version: next };
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
