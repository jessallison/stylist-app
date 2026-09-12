import { getData, getVersion, DATA_KEYS, checkAuth } from "../../../lib/store";
import { hasClaude } from "../../../lib/claude";
import { hasBgRemoval } from "../../../lib/bgremove";

export const dynamic = "force-dynamic";

export async function GET(request) {
  // Viewing is password-gated too - see checkAuth in lib/store.js.
  if (!(await checkAuth(request))) {
    return Response.json({ error: "Locked" }, { status: 401 });
  }
  try {
    const [values, versions] = await Promise.all([
      Promise.all(DATA_KEYS.map((k) => getData(k))),
      Promise.all(DATA_KEYS.map((k) => getVersion(k))),
    ]);
    const out = Object.fromEntries(DATA_KEYS.map((k, i) => [k, values[i]]));
    // Each type's version at load time, so a later save() can tell the
    // server "only write this if nobody's changed it since" - see setData()
    // in lib/store.js.
    out.versions = Object.fromEntries(DATA_KEYS.map((k, i) => [k, versions[i]]));
    // Lets the UI say up front when AI features aren't configured, instead of
    // failing on first use.
    out.ai = hasClaude();
    out.bgRemoval = hasBgRemoval();
    return Response.json(out);
  } catch (e) {
    console.error("data error", e);
    return Response.json(
      { error: "Couldn't reach the database - try again in a moment" },
      { status: 502 }
    );
  }
}
