import { setData, getData, checkAuth, DATA_KEYS } from "../../../lib/store";

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
  const { type, data, version } = body || {};
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
    // `version` is the version the client last loaded for this type - see
    // setData()'s own comment in lib/store.js for what this catches: a
    // second tab/device that saved in between gets rejected here instead of
    // silently overwritten.
    const result = await setData(type, data, version);
    if (!result.ok) {
      const current = await getData(type);
      return Response.json(
        {
          error: "This was changed elsewhere just now - showing the latest version, so try your change again",
          conflict: true,
          currentVersion: result.currentVersion,
          current,
        },
        { status: 409 }
      );
    }
    return Response.json({ ok: true, version: result.version });
  } catch (e) {
    console.error("save error", e);
    return Response.json(
      { error: "Couldn't reach the database - nothing was saved" },
      { status: 502 }
    );
  }
}
