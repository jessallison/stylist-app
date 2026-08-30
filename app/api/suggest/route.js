import { getData, getImage, checkAuth } from "../../../lib/store";
import { claude, hasClaude, imageBlock, parseJson } from "../../../lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// The suggestion engine. Three flows, one endpoint:
//   A - match an inspo image  { flow:"A", inspoId | image }
//   B - filters only          { flow:"B", filters:{ season, occasion, colour, justMe } }
//   C - anchor piece          { flow:"C", anchorId (owned or wanted) | image (new purchase photo) }
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

// Feedback is stored per-outfit ("not my thing" / "love this" on the whole
// combination), but an outfit rarely repeats verbatim from a fresh AI call -
// so blocking the exact combo again would almost never fire. What does
// recur is a PAIRING of two pieces, so that's what gets mined out and fed
// back to the model: the most recent feedback first, deduped, capped, and
// limited to pieces still actually in the wearable pool (a piece that's
// been sold or gone out of rotation can't reappear anyway).
function deriveFeedbackPairs(feedback, verdict, validIds, cap) {
  const seen = new Map();
  const entries = (feedback || [])
    .filter((f) => f.verdict === verdict)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  for (const f of entries) {
    const ids = (f.itemIds || []).filter((id) => validIds.has(id));
    for (let i = 0; i < ids.length && seen.size < cap; i++) {
      for (let j = i + 1; j < ids.length && seen.size < cap; j++) {
        const key = [ids[i], ids[j]].sort().join("|");
        if (!seen.has(key)) seen.set(key, [ids[i], ids[j]]);
      }
    }
    if (seen.size >= cap) break;
  }
  return [...seen.values()];
}

function identityText(s) {
  return `THREE WORDS (every outfit must honour at least two):
${s.threeWords.map((t) => `- ${t.word}: ${t.meaning}`).join("\n")}

Extended vocabulary (secondary flavours): ${s.vocab.join(", ")}

CONFIRMED REGULARS - proven formulas. Reach for these before reasoning from scratch, and name the formula when an outfit follows one:
${s.regulars.map((r) => `- ${r}`).join("\n")}`;
}

// No-AI fallback, used when ANTHROPIC_API_KEY isn't configured (a fresh
// deployment before someone's added a key, or one that never plans to).
// Flows B and C still work here - "suggest from filters" and "style a
// piece" are both really just "pick something valid", which needs no
// reasoning. Flow A (match an inspo image) genuinely needs vision, so it
// stays a hard error - see the caller.
//
// This can't check the three words or find real gaps (both need
// judgement), so it doesn't pretend to: titles and notes say plainly that
// this is a random pick, not a styled one. What it DOES still guarantee is
// every structural rule below - one-per-outfit categories, hard excludes,
// season/occasion/colour filters - the same rules the AI path enforces.
const OCCASION_TO_FORMALITY = {
  Everyday: ["Casual"],
  Work: ["Smart casual", "Casual"],
  "A little bit fancy": ["Dressy", "Smart casual"],
  "Going out": ["Fancy", "Dressy"],
};

function shuffled(arr) {
  return arr
    .map((v) => [Math.random(), v])
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
}

function buildRandomOutfits({ pool, anchor, filters, hardExcludePairs, count = 3 }) {
  const seasonOk = (w) =>
    !filters.season || w.season === filters.season || w.season === "All seasons";
  const occasionOk = (w) => {
    if (!filters.occasion) return true;
    const allowed = OCCASION_TO_FORMALITY[filters.occasion];
    return !allowed || allowed.includes(w.formality);
  };
  const eligible = pool.filter((w) => seasonOk(w) && occasionOk(w));
  const byId = new Map(eligible.map((w) => [w.id, w]));
  if (anchor) byId.set(anchor.id, anchor);
  const byCategory = {};
  for (const w of eligible) (byCategory[w.category] ||= []).push(w);

  function pairsOk(ids) {
    return !ids.some((a) =>
      ids.some((b) => a !== b && hardExcludePairs.has([a, b].sort().join("|")))
    );
  }

  function oneAttempt() {
    const chosen = [];
    const usedCats = new Set();
    if (anchor) {
      chosen.push(anchor.id);
      usedCats.add(anchor.category);
    }

    const hasBase = () =>
      ["Dresses", "Tops", "Bottoms", "Skirts", "Knitwear & jumpers"].some((c) => usedCats.has(c));
    const wantsDress =
      !hasBase() && Math.random() < 0.35 && byCategory["Dresses"]?.length > 0;
    if (wantsDress) {
      const d = shuffled(byCategory["Dresses"])[0];
      chosen.push(d.id);
      usedCats.add("Dresses");
    } else if (!hasBase()) {
      const topPool = shuffled([...(byCategory["Tops"] || []), ...(byCategory["Knitwear & jumpers"] || [])]);
      if (topPool[0]) {
        chosen.push(topPool[0].id);
        usedCats.add(topPool[0].category);
      }
      const bottomPool = shuffled([...(byCategory["Bottoms"] || []), ...(byCategory["Skirts"] || [])]);
      if (bottomPool[0]) {
        chosen.push(bottomPool[0].id);
        usedCats.add(bottomPool[0].category);
      }
    }

    // Outerwear - lean in for cold weather, otherwise a coin flip.
    if (!usedCats.has("Outerwear") && byCategory["Outerwear"]?.length) {
      const wantOuter = filters.season === "Cold weather" ? Math.random() < 0.7 : Math.random() < 0.3;
      if (wantOuter) {
        chosen.push(shuffled(byCategory["Outerwear"])[0].id);
        usedCats.add("Outerwear");
      }
    }
    // Shoes - almost always, when there's a pair available.
    if (!usedCats.has("Shoes") && byCategory["Shoes"]?.length && Math.random() < 0.9) {
      chosen.push(shuffled(byCategory["Shoes"])[0].id);
      usedCats.add("Shoes");
    }
    // One-per-outfit accessories, each a coin flip.
    for (const cat of ["Bags", "Sunglasses", "Belts"]) {
      if (!usedCats.has(cat) && byCategory[cat]?.length && Math.random() < 0.45) {
        chosen.push(shuffled(byCategory[cat])[0].id);
        usedCats.add(cat);
      }
    }
    // Jewellery and scarves can stack - no one-per-outfit limit on these.
    for (const cat of ["Jewellery", "Scarves & shawls"]) {
      if (byCategory[cat]?.length && Math.random() < 0.5) {
        chosen.push(shuffled(byCategory[cat])[0].id);
      }
    }
    return [...new Set(chosen)];
  }

  const results = [];
  const seen = new Set();
  let attempts = 0;
  let n = 0;
  while (results.length < count && attempts < 60) {
    attempts++;
    const ids = oneAttempt();
    if (ids.length < 2) continue;
    if (!pairsOk(ids)) continue;
    if (filters.colour && !ids.some((id) => (byId.get(id)?.colours || []).includes(filters.colour))) continue;
    const key = [...ids].sort().join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    n++;
    results.push({
      title: `Wardrobe shuffle ${n}`,
      item_ids: ids,
      formula: "",
      why: "Randomly assembled from what's owned and the filters - no styling reasoning behind this one.",
      styling_notes: "",
      gaps: [],
    });
  }
  return results;
}

export async function POST(request) {
  if (!checkAuth(request)) {
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    console.error("suggest: couldn't parse request body", e);
    return Response.json(
      { error: "That request didn't come through - try again (a flaky connection can cut it off)" },
      { status: 400 }
    );
  }
  const { flow, filters = {} } = body || {};
  if (!["A", "B", "C"].includes(flow)) {
    console.error("suggest: bad flow value", flow);
    return Response.json(
      { error: "Something's wrong with that request - refresh the page and try again" },
      { status: 400 }
    );
  }

  let wardrobe, inspo, styleProfile, settings, feedback;
  try {
    [wardrobe, inspo, styleProfile, settings, feedback] = await Promise.all([
      getData("wardrobe"),
      getData("inspo"),
      getData("styleProfile"),
      getData("settings"),
      getData("feedback"),
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

  // Flow C's anchor is explicitly requested, so it doesn't have to pass the
  // `wearable` rules - it can be "wanted" (not bought yet) as well as owned.
  // The prompt below adjusts its wording accordingly so a wanted anchor
  // isn't described as something they already own.
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

  // Pairs mined from past "not my thing" / "love this" feedback - see
  // deriveFeedbackPairs above for why this is pair-level, not outfit-level.
  const wearableIds = new Set(wearable.map((w) => w.id));
  const nameOf = (id) => wearable.find((w) => w.id === id)?.name || id;
  const avoidPairs = deriveFeedbackPairs(feedback, "not_for_me", wearableIds, 15);
  const lovedPairs = deriveFeedbackPairs(feedback, "loved", wearableIds, 15);
  const avoidLines = avoidPairs.map(([a, b]) => `- ${nameOf(a)} + ${nameOf(b)}`);
  const lovedLines = lovedPairs.map(([a, b]) => `- ${nameOf(a)} + ${nameOf(b)}`);

  // Hard "doesn't pair with" rules, set directly on wardrobe items (Wardrobe
  // tab item form) - unlike avoidPairs above, these aren't a taste signal
  // mined from feedback and softly steered around, they're a structural
  // incompatibility (two jumpers, redundant layering) the person has
  // declared outright. Enforced twice: told to the model here so it doesn't
  // waste an outfit slot on one, then hard-filtered out below regardless of
  // what comes back - the model instruction is the efficiency layer, the
  // filter is the actual guarantee.
  const hardExcludePairs = new Set();
  for (const w of wardrobe) {
    for (const exId of w.excludeWith || []) {
      hardExcludePairs.add([w.id, exId].sort().join("|"));
    }
  }
  const hardExcludeLines = [...hardExcludePairs].map((key) => {
    const [a, b] = key.split("|");
    return `- ${nameOf(a)} + ${nameOf(b)}`;
  });

  if (pool.length < 2) {
    return Response.json(
      { error: "Not enough owned items in the wardrobe yet - add a few more first." },
      { status: 400 }
    );
  }

  // Category lookup for the one-per-outfit guard below - "NEW" (an
  // uncatalogued Flow C anchor) has no category yet, so it never counts
  // towards any of these either way. Needed by both the AI path (post-call
  // validation) and the no-AI fallback below, so it's computed once here.
  const categoryOf = new Map(wardrobe.map((w) => [w.id, w.category]));
  // Categories a real outfit only ever wears one of at a time. Earrings
  // belong here too in spirit, but they still share the "Jewellery"
  // category with bracelets/necklaces, which SHOULD be allowed to stack -
  // splitting that out needs its own subfield, not just a category, so
  // it's parked in IDEAS.md rather than guessed at with name-matching.
  const ONE_PER_OUTFIT_CATEGORIES = ["Shoes", "Bags", "Sunglasses", "Belts", "Hats", "Gloves"];

  // No ANTHROPIC_API_KEY configured - a fresh deployment before someone's
  // added a key, or one that never plans to. Flow A needs actual image
  // reasoning (matching a look's silhouette/colour logic), which has no
  // sensible non-AI version, so it stays a clear error. Flows B and C are
  // really just "pick something valid", which a random assembly can do -
  // see buildRandomOutfits above.
  if (!hasClaude()) {
    if (flow === "A") {
      return Response.json(
        {
          error:
            "Matching an inspo image needs AI vision, which isn't configured (no ANTHROPIC_API_KEY). \"Suggest outfits\" and \"Style a piece\" still work without it, as a random shuffle.",
        },
        { status: 503 }
      );
    }
    const randomOutfits = buildRandomOutfits({ pool, anchor, filters, hardExcludePairs, count: 3 }).filter(
      (o) =>
        o.item_ids.length >= 2 &&
        ONE_PER_OUTFIT_CATEGORIES.every(
          (cat) => o.item_ids.filter((id) => categoryOf.get(id) === cat).length <= 1
        )
    );
    if (!randomOutfits.length) {
      return Response.json(
        { error: "Couldn't build an outfit from what's owned and the filters - try loosening them." },
        { status: 502 }
      );
    }
    return Response.json({
      outfits: randomOutfits,
      overall_note:
        "Randomly assembled, not AI-styled - no ANTHROPIC_API_KEY configured. Structural rules (no doubling up on shoes/bags/etc., hard excludes, season and occasion) are still respected; the three-words check and gap-finding aren't. Add a key to turn full suggestions back on.",
    });
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
      `"Just me" - no occasion at all. Dress for their own pleasure: their Saturday-morning self, how they look when nobody needs them to look like anything.`
    );

  const flowText =
    flow === "A"
      ? `TASK - MATCH THE INSPIRATION IMAGE (attached).
${
  inspoItem?.type === "flatlay"
    ? `The image is a FLAT-LAY moodboard: items laid out with no body, so it carries no silhouette or drape information. Use it only as an item-level signal - colour, texture, pairing logic. Do NOT infer proportion or fit from it.`
    : `Extract the look's silhouette, proportion, layering and colour logic, then rebuild that feeling from their wardrobe. Match the spirit, not literal garment-for-garment copies.`
}${inspoItem ? `\nHer own tags on this image: ${[inspoItem.occasion, inspoItem.season, (inspoItem.colours || []).join("/"), inspoItem.notes].filter(Boolean).join(", ") || "none"}` : ""}
Also report what's genuinely missing to complete the look (the "gaps" field).`
      : flow === "C"
      ? `TASK - STYLE AN ANCHOR PIECE.
${
  anchor
    ? `The required anchor is ${anchor.status === "wanted" ? "a piece they're considering buying - they don't own it yet" : "their own item"} ${anchor.id} (${anchor.name})${sourceImage ? " - photo attached" : ""}. EVERY outfit must include ${anchor.id} in item_ids.${anchor.status === "wanted" ? " Don't refer to it as something they already own or wear - frame it as how it would work if they bought it." : ""}`
    : `The attached image is something they have just bought (possibly a resale-listing screenshot - ignore any interface or price in the shot). Treat that item as the required anchor: every outfit is built around it plus their owned wardrobe. Since it isn't catalogued yet, put "NEW" in item_ids where it belongs and mention it by name in the notes.`
}
Show its range: vary the direction across outfits (e.g. one everyday, one dressed up, one unexpected).`
      : `TASK - SUGGEST OUTFITS from the wardrobe alone, honouring the filters below.`;

  const profileNote =
    styleProfile.length > 0
      ? `\nThey keep ${styleProfile.length} photos of worn outfits they were happy with (cold weather / warm weather / fancy)${
          filters.justMe ? " - a few are attached as reference for how they actually dress" : ""
        }.`
      : "";

  const system = `You are a personal stylist. You know their wardrobe and their style identity from a styling session, and you build real, wearable outfits ONLY from the items listed - never invent items they don't own.

${identityText(settings)}

RULES:
- item_ids may only contain ids from the OWNED WARDROBE list${anchor ? ` (plus the anchor ${anchor.id})` : ""}${flow === "C" && !anchor ? ` (plus "NEW" for the just-bought anchor)` : ""}.
- 2 to 6 items per outfit; complete looks (shoes/outerwear when the wardrobe has suitable ones), accessories encouraged.
- Never more than one pair of shoes, one bag, one pair of sunglasses, or one belt in the same outfit.
- Before returning an outfit, check it against the three words. If it doesn't honour at least two, fix it or drop it.
- Where an outfit follows a CONFIRMED REGULAR, say which in "formula".
- Gaps: if a look genuinely needs something they don't own, check the WANTED list first - if a wanted item fits, reference it by id ("you've already got your eye on this") instead of a generic suggestion. Only note real gaps, not nice-to-haves.
- Voice: warm, specific, stylist-to-friend. British English. No filler.
${hardExcludeLines.length ? `- These pairs NEVER go in the same outfit, no exceptions - not a preference, a hard incompatibility:\n${hardExcludeLines.join("\n")}` : ""}
${avoidLines.length ? `- They've said no before to these specific pairings - avoid combining them in the same outfit unless there's genuinely no other way to build a good look:\n${avoidLines.join("\n")}` : ""}
${lovedLines.length ? `- They've responded well to these pairings before - it's fine to lean into the spirit of them where it genuinely fits, not force them in:\n${lovedLines.join("\n")}` : ""}

Reply with ONLY a JSON object:
{
  "outfits": [
    {
      "title": "short evocative name, sentence case (e.g. 'Effortless weekend layers', not 'Effortless Weekend Layers')",
      "item_ids": ["id", ...],
      "formula": "matching REGULAR or empty string",
      "why": "one or two sentences on why this works and how it fits their three words",
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
  // "Just me" gets a few worn-outfit photos as grounding for how they really
  // dress. Best-effort: a photo that won't load just gets skipped.
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
    // categoryOf and ONE_PER_OUTFIT_CATEGORIES are computed once, earlier,
    // above the no-AI fallback branch - shared by both paths.
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
          o.item_ids.length >= 2 &&
          (!anchor || o.item_ids.includes(anchor.id)) &&
          // The actual guarantee behind hardExcludeLines above - dropped
          // here even if the model ignored the instruction.
          ![...hardExcludePairs].some((key) => {
            const [a, b] = key.split("|");
            return o.item_ids.includes(a) && o.item_ids.includes(b);
          }) &&
          // Same belt-and-braces pattern for the one-per-outfit rule above -
          // the prompt line is the efficiency layer, this is the actual
          // guarantee.
          ONE_PER_OUTFIT_CATEGORIES.every(
            (cat) => o.item_ids.filter((id) => categoryOf.get(id) === cat).length <= 1
          )
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
