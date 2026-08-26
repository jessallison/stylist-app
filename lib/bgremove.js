// Background removal for wardrobe photos, via remove.bg's REST API. Composites
// the garment directly onto white (matching the app's product-shot look) so
// no client-side compositing is needed. Kept entirely server-side - the API
// key never reaches the browser, same pattern as ANTHROPIC_API_KEY.
//
// Scope: wardrobe item photos ONLY. Inspo images (real outfit/flat-lay
// photos) and style-profile photos keep their real backgrounds on purpose -
// stripping them would destroy the proportion/drape information Flow A reads.

const API_URL = "https://api.remove.bg/v1.0/removebg";

export function hasBgRemoval() {
  return Boolean(process.env.REMOVEBG_API_KEY);
}

export async function removeBackground(dataUrl) {
  const m = /^data:image\/[\w+]+;base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw new Error("Not a valid image");

  const res = await fetch(API_URL, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "X-Api-Key": process.env.REMOVEBG_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_file_b64: m[1],
      // "preview" (0.25MP) is the free-credit resolution and plenty for a
      // ~900px catalogue thumbnail - deliberately not "full"/"auto", which
      // cost more per image.
      size: "preview",
      bg_color: "FFFFFF",
      format: "jpg",
    }),
  });

  if (!res.ok) {
    let msg = `remove.bg ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.errors?.[0]?.title || msg;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}
