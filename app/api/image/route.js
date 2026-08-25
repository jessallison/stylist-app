import { setImage, checkAuth } from "../../../lib/store";

export const dynamic = "force-dynamic";

// Upload one image (client-side resized data URL). ~150KB after the client
// compresses, well inside Upstash's request limit.
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
  const { id, dataUrl } = body || {};
  if (
    !id ||
    typeof id !== "string" ||
    !/^[a-z0-9-]+$/.test(id) ||
    typeof dataUrl !== "string" ||
    !dataUrl.startsWith("data:image/")
  ) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (dataUrl.length > 900_000) {
    return Response.json(
      { error: "Photo too large even after compression" },
      { status: 413 }
    );
  }
  try {
    await setImage(id, dataUrl);
  } catch (e) {
    console.error("image save error", e);
    return Response.json(
      { error: "Couldn't store the photo - try again" },
      { status: 502 }
    );
  }
  return Response.json({ ok: true });
}
