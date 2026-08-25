import { setData, checkAuth, DATA_KEYS } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!checkAuth(request)) {
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  const { type, data } = await request.json();
  const okShape =
    type === "settings" ? data && typeof data === "object" : Array.isArray(data);
  if (!DATA_KEYS.includes(type) || !okShape) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  await setData(type, data);
  return Response.json({ ok: true });
}
