import { setImage, checkAuth } from "../../../lib/store";

export const dynamic = "force-dynamic";

// Upload one image (client-side resized data URL). ~150KB after the client
// compresses, well inside Upstash's request limit.
export async function POST(request) {
  if (!checkAuth(request)) {
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  const { id, dataUrl } = await request.json();
  if (
    !id ||
    typeof id !== "string" ||
    !/^[a-z0-9-]+$/.test(id) ||
    typeof dataUrl !== "string" ||
    !dataUrl.startsWith("data:image/") ||
    dataUrl.length > 900_000
  ) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  await setImage(id, dataUrl);
  return Response.json({ ok: true });
}
