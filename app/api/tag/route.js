import { checkAuth } from "../../../lib/store";
import { claude, hasClaude, imageBlock, parseJson } from "../../../lib/claude";
import {
  CATEGORIES,
  SEASONS,
  FORMALITY,
  OCCASIONS,
  COLOURS,
  DEFAULT_SETTINGS,
} from "../../../lib/style-identity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const list = (a) => a.map((x) => `"${x}"`).join(", ");

// AI tag suggestion on entry. kind "wardrobe" tags a single garment;
// kind "inspo" classifies an inspiration image (outfit / flat-lay / product)
// and tags it. Suggestions only - the user approves or edits before saving.
export async function POST(request) {
  if (!checkAuth(request)) {
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  if (!hasClaude()) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY isn't set - add tags by hand for now." },
      { status: 503 }
    );
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const { image, kind } = body || {};
  const img = imageBlock(image);
  if (!img || !["wardrobe", "inspo"].includes(kind)) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  const prompt =
    kind === "wardrobe"
      ? `This is a photo of one clothing item, accessory or pair of shoes for a personal wardrobe catalogue (it may be a product listing screenshot - ignore any text, price or interface in the shot and tag the item itself).

Reply with ONLY a JSON object, no other text:
{
  "name": "short natural name for the item, e.g. 'Cream wide-leg trousers'",
  "brand": "brand name ONLY if clearly legible on a label, tag or listing in the shot, else empty string - never guess",
  "category": one of [${list(CATEGORIES)}],
  "colours": array of 1-3 from [${list(COLOURS)}],
  "season": one of [${list(SEASONS)}],
  "formality": one of [${list(FORMALITY)}],
  "tags": array of 0-3 from [${list(DEFAULT_SETTINGS.vocab)}] that clearly apply,
  "notes": "one short sentence on anything useful for styling (fabric, cut, standout detail), or empty string"
}`
      : `This is a saved fashion-inspiration image. Classify and tag it.

Types:
- "outfit": a full look worn on a body (street style, mirror selfie, editorial)
- "flatlay": items laid out separately with no body - a moodboard or collage
- "product": a single item for sale - a shop, Depop or Vinted style listing, often with a price

Reply with ONLY a JSON object, no other text:
{
  "type": "outfit" | "flatlay" | "product",
  "occasion": one of [${list(OCCASIONS)}] or "" if none obviously applies,
  "season": one of [${list(SEASONS)}],
  "colours": array of 1-3 dominant colours from [${list(COLOURS)}],
  "tags": array of 0-3 from [${list(DEFAULT_SETTINGS.vocab)}] that clearly apply to the vibe of this image,
  "description": "one sentence on what the look or item is",
  "productName": "if type is product: a short natural name for the item, else empty string"
}`;

  try {
    const text = await claude({
      messages: [
        { role: "user", content: [img, { type: "text", text: prompt }] },
      ],
      maxTokens: 500,
    });
    return Response.json(parseJson(text));
  } catch (e) {
    console.error("tag error", e);
    return Response.json({ error: "Tagging failed - try again" }, { status: 502 });
  }
}
