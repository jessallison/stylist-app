import {
  loginBlocked,
  recordLoginFailure,
  clearLoginFailures,
  timingSafeStringEqual,
  createSession,
  destroySession,
} from "../../../lib/store";

export const dynamic = "force-dynamic";

// Client IP as seen through Vercel's edge: the first entry in
// x-forwarded-for. Falls back to a fixed bucket rather than skipping the
// limiter, so a missing header can't be used to dodge it.
function clientIp(request) {
  const fwd = request.headers.get("x-forwarded-for") || "";
  const first = fwd.split(",")[0].trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}

// Login sets an httpOnly cookie so image tags and the data-download link
// authenticate without JavaScript involvement; logout clears it.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    console.error("auth: couldn't parse request body", e);
    return Response.json(
      { error: "Login didn't come through - try again" },
      { status: 400 }
    );
  }
  const { password, logout } = body || {};
  const pw = process.env.ADMIN_PASSWORD;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  if (logout) {
    // Best-effort: invalidate the session server-side too, not just clear
    // the cookie, so a copy of it lying around elsewhere (browser history,
    // a synced cookie jar) stops working the moment this tab logs out.
    const cookie = request.headers.get("cookie") || "";
    const m = cookie.match(/(?:^|;\s*)stylist-key=([^;]*)/);
    if (m) {
      try {
        await destroySession(decodeURIComponent(m[1]));
      } catch (e) {
        console.error("auth: logout session cleanup failed", e);
      }
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `stylist-key=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`,
      },
    });
  }

  // Brute-force ceiling (see lib/store.js). Checked before the password so
  // a blocked client learns nothing about whether its guess was right.
  // Fails open on a Redis error: a storage hiccup shouldn't lock the owner
  // out of their own wardrobe, and the rest of the app would be failing
  // loudly anyway.
  const ip = clientIp(request);
  if (pw) {
    try {
      if (await loginBlocked(ip)) {
        return Response.json(
          { error: "Too many attempts - try again in 15 minutes" },
          { status: 429 }
        );
      }
    } catch (e) {
      console.error("auth: rate limit check failed, allowing attempt", e);
    }
  }

  // No password configured (local dev): everything is open. Otherwise a
  // timing-safe comparison - see timingSafeStringEqual in lib/store.js -
  // since this is the one comparison actually reachable by an outside
  // guess (checkAuth's cookie/header checks matter to a bad guess, but only
  // after the guess is already sitting in a valid-looking request).
  const ok = !pw || (typeof password === "string" && timingSafeStringEqual(password, pw));

  if (pw) {
    try {
      if (ok) await clearLoginFailures(ip);
      else await recordLoginFailure(ip);
    } catch (e) {
      console.error("auth: rate limit update failed", e);
    }
  }

  const headers = { "Content-Type": "application/json" };
  if (ok && pw) {
    // The cookie carries a random session token, not the password itself -
    // the password only ever travels in the login request body and the
    // x-admin-key header (for the app's own fetch calls), never sitting
    // around in a cookie jar where any script with DOM access could read
    // it back out. See createSession() in lib/store.js.
    const token = await createSession();
    headers["Set-Cookie"] = `stylist-key=${encodeURIComponent(
      token
    )}; HttpOnly; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }
  return new Response(JSON.stringify({ ok }), {
    status: ok ? 200 : 401,
    headers,
  });
}
