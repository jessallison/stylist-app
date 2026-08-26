import { setData, checkAuth, DATA_KEYS } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!checkAuth(request)) {
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  let body;
  try {
    body = await request.json();
  } catch (e) {
    // Usually a flaky connection cutting the request off mid-transfer, not a
    // real problem with the data - console.error keeps the real cause in
    // Vercel's logs.
    console.error("save: couldn't parse request body", e);
    return Response.json(
      { error: "Save didn't come through - try again (a flaky connection can cut off the request)" },
      { status: 400 }
    );
  }
  const { type, data } = body || {};
  const okShape =
    type === "settings" ? data && typeof data === "object" : Array.isArray(data);
  if (!DATA_KEYS.includes(type) || !okShape) {
    console.error("save: bad payload shape", { type, isArray: Array.isArray(data) });
    return Response.json(
      { error: "That change didn't save properly - refresh the page and try again" },
      { status: 400 }
    );
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
