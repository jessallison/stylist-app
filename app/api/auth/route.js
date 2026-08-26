export const dynamic = "force-dynamic";

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
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `stylist-key=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`,
      },
    });
  }

  // No password configured (local dev): everything is open.
  const ok = !pw || password === pw;
  const headers = { "Content-Type": "application/json" };
  if (ok && pw) {
    headers["Set-Cookie"] = `stylist-key=${encodeURIComponent(
      pw
    )}; HttpOnly; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }
  return new Response(JSON.stringify({ ok }), {
    status: ok ? 200 : 401,
    headers,
  });
}
