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
  } catch (e) {
    // Distinct from the field-validation case below: this is usually a large
    // upload getting cut off mid-transfer on a slow/flaky connection, not a
    // bad photo. console.error keeps the real cause visible in Vercel logs.
    console.error("image upload: couldn't parse request body", e);
    return Response.json(
      { error: "Upload didn't come through - try again (a slow connection can cut off a large photo mid-upload)" },
      { status: 400 }
    );
  }
  const { id, dataUrl } = body || {};
  if (
    !id ||
    typeof id !== "string" ||
    !/^[a-z0-9-]+$/.test(id) ||
    typeof dataUrl !== "string" ||
    !dataUrl.startsWith("data:image/")
  ) {
    console.error("image upload: bad payload shape", {
      hasId: typeof id === "string",
      dataUrlPrefix: typeof dataUrl === "string" ? dataUrl.slice(0, 20) : typeof dataUrl,
    });
    return Response.json(
      { error: "That photo didn't come through properly - try picking it again" },
      { status: 400 }
    );
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
