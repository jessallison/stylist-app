import { getData, DATA_KEYS, checkAuth } from "../../../lib/store";
import { hasClaude } from "../../../lib/claude";

export const dynamic = "force-dynamic";

export async function GET(request) {
  // Viewing is password-gated too - see checkAuth in lib/store.js.
  if (!checkAuth(request)) {
    return Response.json({ error: "Locked" }, { status: 401 });
  }
  try {
    const values = await Promise.all(DATA_KEYS.map((k) => getData(k)));
    const out = Object.fromEntries(DATA_KEYS.map((k, i) => [k, values[i]]));
    // Lets the UI say up front when AI features aren't configured, instead of
    // failing on first use.
    out.ai = hasClaude();
    return Response.json(out);
  } catch (e) {
    console.error("data error", e);
    return Response.json(
      { error: "Couldn't reach the database - try again in a moment" },
      { status: 502 }
    );
  }
}
