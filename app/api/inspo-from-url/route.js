import { checkAuth } from "../../../lib/store";

export const dynamic = "force-dynamic";

// A real browser UA - several sites (including Pinterest's page shell, even
// though its pin pages don't end up usable here anyway - see below) serve a
// stripped-down or blocked response to Node's default fetch UA.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_BYTES = 12_000_000; // raw fetch cap - the client resizes down from here same as any other upload
const FETCH_TIMEOUT = 8000;

// Blocks the obvious SSRF targets (localhost, private ranges, cloud
// metadata). Not exhaustive - this endpoint is behind the same password as
// everything else, so the bar is "a pasted link can't trivially probe the
// server's own network," not full hardening.
function isBlockedHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local")) return true;
  if (/^127\./.test(h) || h === "0.0.0.0" || h === "::1") return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === "169.254.169.254") return true;
  return false;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function fetchWithLimits(url, accept, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const headers = { "User-Agent": UA, Accept: accept };
    if (referer) headers.Referer = referer;
    return await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Looks for the same tag Pinterest/Twitter/iMessage read to unfurl a link
// preview - present on most product and blog pages regardless of who's
// asking, since sites want their own links to unfurl nicely. Property/
// content can appear in either attribute order.
function extractImageUrl(html, baseUrl) {
  const patterns = [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image:secure_url["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      try {
        return new URL(decodeEntities(m[1]), baseUrl).toString();
      } catch {
        /* try the next pattern */
      }
    }
  }
  return null;
}

// Pulls an image out of either a direct image link, or a page's og:image
// (a Depop/Vinted/product/blog page). Deliberately doesn't try to parse
// Pinterest's own pin pages beyond that: they're a JS-rendered shell with
// no og:image in the raw HTML, so a pasted pinterest.com/pin/... link will
// fail here with a message pointing at the workaround - copying the actual
// image's address (right-click the photo on the pin, not the page) instead,
// which comes in as a direct image link and works the same as any other.
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
  const raw = (body?.url || "").trim();
  let pageUrl;
  try {
    pageUrl = new URL(raw);
  } catch {
    return Response.json({ error: "That doesn't look like a valid link" }, { status: 400 });
  }
  if (!["http:", "https:"].includes(pageUrl.protocol) || isBlockedHost(pageUrl.hostname)) {
    return Response.json({ error: "That link isn't supported" }, { status: 400 });
  }

  try {
    let res = await fetchWithLimits(pageUrl.toString(), "image/*,text/html;q=0.8,*/*;q=0.5");
    if (!res.ok) {
      return Response.json({ error: `Couldn't reach that link (${res.status})` }, { status: 400 });
    }
    let contentType = res.headers.get("content-type") || "";

    if (!contentType.startsWith("image/")) {
      const html = await res.text();
      const found = extractImageUrl(html, pageUrl.toString());
      if (!found) {
        return Response.json(
          {
            error:
              "Couldn't find an image on that page - right-click the actual photo (not the page) and copy its image address instead",
          },
          { status: 422 }
        );
      }
      // Referer set to the page the image came from - a real browser sends
      // this loading it as part of viewing that page, and some sites (fashion
      // retailers in particular) reject a bare image request without one.
      res = await fetchWithLimits(found, "image/*", pageUrl.toString());
      if (!res.ok) {
        return Response.json({ error: `Couldn't load the image from that page (${res.status})` }, { status: 400 });
      }
      contentType = res.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) {
        return Response.json({ error: "That page's preview image wasn't actually an image" }, { status: 422 });
      }
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      return Response.json({ error: "That image is too large to import" }, { status: 413 });
    }
    return new Response(buf, {
      status: 200,
      headers: { "Content-Type": contentType },
    });
  } catch (e) {
    const timedOut = e?.name === "AbortError";
    console.error("inspo-from-url fetch failed", e);
    return Response.json(
      { error: timedOut ? "That link took too long to load - try again" : "Couldn't load that link" },
      { status: 502 }
    );
  }
}
