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
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const { dataUrl } = body || {};
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return Response.json({ error: "Bad request" }, { status: 400 });
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
