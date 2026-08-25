import { setData, checkAuth, DATA_KEYS } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!checkAuth(request)) {
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const { type, data } = body || {};
  const okShape =
    type === "settings" ? data && typeof data === "object" : Array.isArray(data);
  if (!DATA_KEYS.includes(type) || !okShape) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    await setData(type, data);
  } catch (e) {
    console.error("save error", e);
    return Response.json(
      { error: "Couldn't reach the database - nothing was saved" },
      { status: 502 }
    );
  }
  return Response.json({ ok: true });
}
