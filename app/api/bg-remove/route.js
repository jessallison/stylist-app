import { checkAuth } from "../../../lib/store";
import { hasBgRemoval, removeBackground } from "../../../lib/bgremove";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request) {
  if (!checkAuth(request)) {
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  if (!hasBgRemoval()) {
    // Distinct code so callers can skip the toast when the feature is just
    // unconfigured, rather than treating it as a real failure.
    return Response.json({ error: "no-key" }, { status: 503 });
  }
  let body;
  try {
    body = await request.json();
  } catch (e) {
    console.error("bg-remove: couldn't parse request body", e);
    return Response.json(
      { error: "That photo didn't come through - try again (a flaky connection can cut off the upload)" },
      { status: 400 }
    );
  }
  const { dataUrl } = body || {};
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    console.error("bg-remove: bad dataUrl", { dataUrlPrefix: typeof dataUrl === "string" ? dataUrl.slice(0, 20) : typeof dataUrl });
    return Response.json(
      { error: "Couldn't read that photo - try picking it again" },
      { status: 400 }
    );
  }
  try {
    const cleaned = await removeBackground(dataUrl);
    return Response.json({ dataUrl: cleaned });
  } catch (e) {
    console.error("bg-remove error", e);
    return Response.json(
      { error: e.message || "Background removal failed" },
      { status: 502 }
    );
  }
}
