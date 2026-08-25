import { getImage, delImage, checkAuth } from "../../../../lib/store";

export const dynamic = "force-dynamic";

// Serve a stored image as real binary so <img src="/api/image/xyz"> works
// and the browser can cache it (photos never change under the same id).
export async function GET(request, { params }) {
  // Photos are the most personal thing here - gated like everything else.
  // The login cookie authenticates plain <img> requests.
  if (!checkAuth(request)) {
    return new Response("Locked", { status: 401 });
  }
  const { id } = await params;
  try {
    const dataUrl = await getImage(id);
    if (!dataUrl) return new Response("Not found", { status: 404 });
    const m = /^data:(image\/[\w+]+);base64,(.+)$/.exec(dataUrl);
    if (!m) return new Response("Corrupt image", { status: 500 });
    return new Response(Buffer.from(m[2], "base64"), {
      headers: {
        "Content-Type": m[1],
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    console.error("image get error", e);
    return new Response("Database unreachable", { status: 502 });
  }
}

export async function DELETE(request, { params }) {
  if (!checkAuth(request)) {
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  const { id } = await params;
  try {
    await delImage(id);
  } catch (e) {
    // Deletion is cleanup, not user-visible state - log and report gently.
    console.error("image delete error", e);
    return Response.json({ error: "Couldn't delete the photo" }, { status: 502 });
  }
  return Response.json({ ok: true });
}
