// Style identity, in the spirit of the Allison Bornstein three-words method
// (https://www.allisonbornstein.com) - the durable reference for what "on
// brand" means. Stored in the settings record so it can be edited in the
// app (Profile > Edit identity); these are the seed values a brand new,
// never-configured database starts from - deliberately empty, not Jess's
// own words, so a second person's own deployment (their own Vercel project,
// their own Redis database - see lib/store.js) starts as a blank slate
// instead of inheriting hers. Editing this file has no effect on a database
// that's already been used, since getData() only ever seeds a key the first
// time it's read - see getData in lib/store.js.
export const DEFAULT_SETTINGS = {
  threeWords: [],
  // Secondary tags, finer-grained than the three words.
  vocab: [],
  // Proven formulas - the engine reaches for these before reasoning from scratch.
  regulars: [],
};

// Option lists shared by the entry forms, the filters, and the AI tagging
// prompts (the model is constrained to suggest only from these).

export const CATEGORIES = [
  "Tops",
  "Bottoms",
  "Dresses",
  "Skirts",
  "Knitwear",
  "Outerwear",
  "Shoes",
  "Bags",
  "Jewellery",
  "Sunglasses",
  "Belts",
  "Scarves & shawls",
  "Other",
];

export const SEASONS = ["All year", "Warm weather", "Cold weather"];

export const FORMALITY = ["Casual", "Smart casual", "Dressy", "Fancy"];

export const OCCASIONS = ["Everyday", "Work", "A little bit fancy", "Going out"];

// Achromatic neutrals, then warm neutrals light-to-dark, then a straight
// ascending sweep round the colour wheel (Red 0° through Pink 351°), with
// the one non-colour catch-all at the very end. Both the colour chip
// pickers and the colour filter panels just map over this array, so this
// order is what "colour order" means everywhere in the app.
export const COLOURS = [
  "Black",
  "White",
  "Grey",
  "Metallic",
  "Cream",
  "Tan",
  "Brown",
  "Red",
  "Rust",
  "Orange",
  "Mustard",
  "Yellow",
  "Olive",
  "Green",
  "Blue",
  "Denim",
  "Navy",
  "Purple",
  "Burgundy",
  "Pink",
  "Multi / print",
];

// Swatch hex per colour - a recognisable approximation, not an exact
// garment match. "Multi / print" has no single hue, so it's a CSS gradient
// string instead; consumers that need a solid colour (not this one) can use
// it directly as a background, and COLOUR_TEXT_HEX below for text.
export const COLOUR_HEX = {
  Black: "#1a1a1a",
  White: "#faf9f6",
  Cream: "#f0e6d2",
  Grey: "#9b9891",
  Brown: "#6b4a35",
  Tan: "#c8a876",
  Denim: "#4a5d7a",
  Navy: "#1f2b47",
  Blue: "#3f6d9e",
  Green: "#4a6b4a",
  Olive: "#6b6b3f",
  Yellow: "#e0c34a",
  Mustard: "#c9a227",
  Orange: "#d17a3a",
  Rust: "#a8532e",
  Red: "#a83232",
  Burgundy: "#5e1f2e",
  Pink: "#dba3ab",
  Purple: "#6b4a7a",
  Metallic: "#b8b0a0",
  "Multi / print":
    "linear-gradient(135deg, #a83232 25%, #3f6d9e 25% 50%, #c9a227 50% 75%, #4a6b4a 75%)",
};

// Text-legible variant of COLOUR_HEX - the swatch hex darkened/deepened just
// enough to read as small text on a light chip background (a literal White
// or Cream swatch is invisible as text). True near-achromatic entries
// (White, Grey, Metallic - low saturation, no real hue to lean on) render as
// one shared neutral grey rather than an amplified, misleading colour cast.
export const COLOUR_TEXT_HEX = {
  Black: "#1a1a1a",
  White: "#6b6861",
  Cream: "#997733",
  Grey: "#6b6861",
  Brown: "#6c4a34",
  Tan: "#92703a",
  Denim: "#405b84",
  Navy: "#1f2b47",
  Blue: "#3a6592",
  Green: "#3b7a3b",
  Olive: "#737337",
  Yellow: "#ae921e",
  Mustard: "#ab8a21",
  Orange: "#a55c27",
  Rust: "#a04f2c",
  Red: "#9d2f2f",
  Burgundy: "#5e1f2e",
  Pink: "#933946",
  Purple: "#6f4084",
  Metallic: "#6b6861",
  "Multi / print": COLOUR_HEX["Multi / print"],
};

export const INSPO_TYPES = [
  ["outfit", "Outfit photo"],
  ["flatlay", "Flat-lay moodboard"],
  ["product", "Product / resale pin"],
];

export const PROFILE_CONTEXTS = [
  ["cold", "Cold weather"],
  ["warm", "Warm weather"],
  ["fancy", "Fancy"],
];
