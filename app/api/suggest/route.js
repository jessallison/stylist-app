import { getData, getImage, checkAuth } from "../../../lib/store";
import { claude, hasClaude, imageBlock, parseJson } from "../../../lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// The suggestion engine. Three flows, one endpoint:
//   A - match an inspo image  { flow:"A", inspoId | image }
//   B - filters only          { flow:"B", filters:{ season, occasion, colour, justMe } }
//   C - anchor piece          { flow:"C", anchorId | image (new purchase photo) }
// Reasoning runs over structured tags plus the source image - wardrobe items
// go in as compact tag records, not photos, which is more reliable (and far
// cheaper) at this scale.

function itemLine(w) {
  const bits = [
    w.category,
    (w.colours || []).join("/"),
    w.season,
    w.formality,
    ...(w.tags || []),
  ].filter(Boolean);
  return `- ${w.id}: ${w.name} [${bits.join(", ")}]${w.notes ? ` - ${w.notes}` : ""}`;
}

function identityText(s) {
  return `THREE WORDS (every outfit must honour at least two):
${s.threeWords.map((t) => `- ${t.word}: ${t.meaning}`).join("\n")}

Extended vocabulary (secondary flavours): ${s.vocab.join(", ")}

CONFIRMED REGULARS - proven formulas. Reach for these before reasoning from scratch, and name the formula when an outfit follows one:
${s.regulars.map((r) => `- ${r}`).join("\n")}`;
}

export async function POST(request) {
  if (!checkAuth(request)) {
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  if (!hasClaude()) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY isn't set - suggestions need it." },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const { flow, filters = {} } = body || {};
  if (!["A", "B", "C"].includes(flow)) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  let wardrobe, inspo, styleProfile, settings;
  try {
    [wardrobe, inspo, styleProfile, settings] = await Promise.all([
      getData("wardrobe"),
      getData("inspo"),
      getData("styleProfile"),
      getData("settings"),
    ]);
  } catch (e) {
    console.error("suggest data error", e);
    return Response.json(
      { error: "Couldn't reach the database - try again in a moment" },
      { status: 502 }
    );
  }

  // Only owned, currently-wearable pieces are ever assembled into an outfit.
  const wearable = wardrobe.filter(
    (w) => w.status === "owned" && w.fitStatus !== "not_current"
  );
  const wanted = wardrobe.filter((w) => w.status === "wanted");

  // Flow C's anchor may itself be excluded from `wearable` rules? No - the
  // anchor is explicitly requested, so it only has to be owned.
  let anchor = null;
  if (flow === "C" && body.anchorId) {
    anchor = wardrobe.find((w) => w.id === body.anchorId);
    if (!anchor) {
      return Response.json({ error: "Anchor item not found" }, { status: 400 });
    }
  }

  const pool = anchor
    ? wearable.filter((w) => w.id !== anchor.id)
    : wearable;

  if (pool.length < 2) {
    return Response.json(
      { error: "Not enough owned items in the wardrobe yet - add a few more first." },
      { status: 400 }
    );
  }

  // Source image: an inspo library item (A), a fresh upload (A or C), or the
  // anchor item's own photo (C).
  let sourceImage = null;
  try {
    if (body.image) sourceImage = body.image;
    else if (flow === "A" && body.inspoId) {
      const item = inspo.find((i) => i.id === body.inspoId);
      if (item?.photoId) sourceImage = await getImage(item.photoId);
    } else if (anchor?.photoId) {
      sourceImage = await getImage(anchor.photoId);
    }
  } catch (e) {
    console.error("suggest image fetch error", e);
    return Response.json(
      { error: "Couldn't load the source image - try again in a moment" },
      { status: 502 }
    );
  }
  if ((flow === "A" || flow === "C") && !sourceImage && !anchor) {
    return Response.json({ error: "No source image provided" }, { status: 400 });
  }

  // The inspo item's own tags travel with the image when it came from the library.
  const inspoItem =
    flow === "A" && body.inspoId ? inspo.find((i) => i.id === body.inspoId) : null;

  const filterLines = [];
  if (filters.season) filterLines.push(`Season: ${filters.season}`);
  if (filters.occasion) filterLines.push(`Occasion: ${filters.occasion}`);
  if (filters.colour) filterLines.push(`Colour focus: ${filters.colour}`);
  if (filters.justMe)
    filterLines.push(
      `"Just me" - no occasion at all. Dress for her own pleasure: her Saturday-morning self, how she looks when nobody needs her to look like anything.`
    );

  const flowText =
    flow === "A"
      ? `TASK - MATCH THE INSPIRATION IMAGE (attached).
${
  inspoItem?.type === "flatlay"
    ? `The image is a FLAT-LAY moodboard: items laid out with no body, so it carries no silhouette or drape information. Use it only as an item-level signal - colour, texture, pairing logic. Do NOT infer proportion or fit from it.`
    : `Extract the look's silhouette, proportion, layering and colour logic, then rebuild that feeling from her wardrobe. Match the spirit, not literal garment-for-garment copies.`
}${inspoItem ? `\nHer own tags on this image: ${[inspoItem.occasion, inspoItem.season, (inspoItem.colours || []).join("/"), inspoItem.notes].filter(Boolean).join(", ") || "none"}` : ""}
Also report what's genuinely missing to complete the look (the "gaps" field).`
      : flow === "C"
      ? `TASK - STYLE AN ANCHOR PIECE.
${
  anchor
    ? `The required anchor is her own item ${anchor.id} (${anchor.name})${sourceImage ? " - photo attached" : ""}. EVERY outfit must include ${anchor.id} in item_ids.`
    : `The attached image is something she has just bought (possibly a resale-listing screenshot - ignore any interface or price in the shot). Treat that item as the required anchor: every outfit is built around it plus her owned wardrobe. Since it isn't catalogued yet, put "NEW" in item_ids where it belongs and mention it by name in the notes.`
}
Show its range: vary the direction across outfits (e.g. one everyday, one dressed up, one unexpected).`
      : `TASK - SUGGEST OUTFITS from the wardrobe alone, honouring the filters below.`;

  const profileNote =
    styleProfile.length > 0
      ? `\nShe keeps ${styleProfile.length} photos of worn outfits she was happy with (cold weather / warm weather / fancy)${
          filters.justMe ? " - a few are attached as reference for how she actually dresses" : ""
        }.`
      : "";

  const system = `You are Jess's personal stylist. You know her wardrobe and her style identity from a styling session, and you build real, wearable outfits ONLY from the items listed - never invent items she doesn't own.

${identityText(settings)}

RULES:
- item_ids may only contain ids from the OWNED WARDROBE list${anchor ? ` (plus the anchor ${anchor.id})` : ""}${flow === "C" && !anchor ? ` (plus "NEW" for the just-bought anchor)` : ""}.
- 2 to 6 items per outfit; complete looks (shoes/outerwear when the wardrobe has suitable ones), accessories encouraged.
- Before returning an outfit, check it against the three words. If it doesn't honour at least two, fix it or drop it.
- Where an outfit follows a CONFIRMED REGULAR, say which in "formula".
- Gaps: if a look genuinely needs something she doesn't own, check the WANTED list first - if a wanted item fits, reference it by id ("you've already got your eye on this") instead of a generic suggestion. Only note real gaps, not nice-to-haves.
- Voice: warm, specific, stylist-to-friend. British English. No filler.

Reply with ONLY a JSON object:
{
  "outfits": [
    {
      "title": "short evocative name",
      "item_ids": ["id", ...],
      "formula": "matching REGULAR or empty string",
      "why": "one or two sentences on why this works and how it fits her three words",
      "styling_notes": "tuck/layer/roll details, one sentence, or empty string",
      "gaps": [{ "need": "what's missing", "wanted_id": "id from WANTED list or empty string" }]
    }
  ],
  "overall_note": "optional single stylist's remark, or empty string"
}
Return 3 outfits (2 if the wardrobe genuinely can't support 3 good ones).`;

  const userText = `OWNED WARDROBE (currently wearable):
${pool.map(itemLine).join("\n")}
${anchor ? `\nANCHOR (required in every outfit):\n${itemLine(anchor)}` : ""}
${wanted.length ? `\nWANTED (eyeing, not owned - for gap references ONLY, never in item_ids):\n${wanted.map(itemLine).join("\n")}` : ""}
${filterLines.length ? `\nFILTERS:\n${filterLines.join("\n")}` : ""}
${profileNote}

${flowText}`;

  const content = [];
  const srcBlock = imageBlock(sourceImage);
  if (srcBlock && (flow === "A" || flow === "C")) content.push(srcBlock);
  // "Just me" gets a few worn-outfit photos as grounding for how she really
  // dresses. Best-effort: a photo that won't load just gets skipped.
  if (flow === "B" && filters.justMe) {
    for (const p of styleProfile.slice(0, 3)) {
      try {
        const img = imageBlock(await getImage(p.photoId));
        if (img) content.push(img);
      } catch {
        /* skip */
      }
    }
  }
  content.push({ type: "text", text: userText });

  try {
    const text = await claude({
      system,
      messages: [{ role: "user", content }],
      maxTokens: 2500,
    });
    const result = parseJson(text);

    // Validate: strip unknown ids, drop outfits that lost too much or (Flow C
    // with a catalogued anchor) lost the anchor.
    const validIds = new Set([
      ...pool.map((w) => w.id),
      ...(anchor ? [anchor.id] : []),
      ...(flow === "C" && !anchor ? ["NEW"] : []),
    ]);
    const wantedIds = new Set(wanted.map((w) => w.id));
    const outfits = (result.outfits || [])
      .map((o) => ({
        title: o.title || "Untitled look",
        item_ids: (o.item_ids || []).filter((id) => validIds.has(id)),
        formula: o.formula || "",
        why: o.why || "",
        styling_notes: o.styling_notes || "",
        gaps: (o.gaps || []).map((g) => ({
          need: g.need || "",
          wanted_id: wantedIds.has(g.wanted_id) ? g.wanted_id : "",
        })),
      }))
      .filter(
        (o) =>
          o.item_ids.length >= 2 && (!anchor || o.item_ids.includes(anchor.id))
      );

    if (!outfits.length) {
      return Response.json(
        { error: "Couldn't build a valid outfit - try loosening the filters." },
        { status: 502 }
      );
    }
    return Response.json({ outfits, overall_note: result.overall_note || "" });
  } catch (e) {
    console.error("suggest error", e);
    return Response.json(
      { error: "Suggestion failed - try again in a moment" },
      { status: 502 }
    );
  }
}
