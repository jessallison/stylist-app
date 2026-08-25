// Style identity from the Allison Bornstein styling session - the durable
// reference for what "on brand" means. Stored in the settings record so it
// can be edited in the app; these are the seed values.

export const DEFAULT_SETTINGS = {
  threeWords: [
    { word: "Comfortable", meaning: "sporty / active / easy" },
    { word: "Lounge", meaning: "oversized / slouchy / relaxed" },
    { word: "Vibey", meaning: "expressive / artsy / 70s / intentional" },
  ],
  // Secondary tags, finer-grained than the three words.
  vocab: [
    "70s",
    "romantic",
    "sexy",
    "monochromatic",
    "maximalist",
    "witchy",
    "textural",
    "artsy",
    "oversized",
    "slouchy",
  ],
  // Proven formulas - the engine reaches for these before reasoning from scratch.
  regulars: [
    "Maxi skirt + oversized jumper or tee",
    "Palazzo pants + fitted top",
    "Wide-leg black pants + fun top",
    "Jeans + white tee + cream blazer",
    "One special piece (lace dress, peacock shawl) over simple basics",
    "Black leather skirt + fun jumper, tucked in",
  ],
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

export const COLOURS = [
  "Black",
  "White",
  "Cream",
  "Grey",
  "Brown",
  "Tan",
  "Denim",
  "Navy",
  "Blue",
  "Green",
  "Olive",
  "Yellow",
  "Mustard",
  "Orange",
  "Rust",
  "Red",
  "Burgundy",
  "Pink",
  "Purple",
  "Metallic",
  "Multi / print",
];

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
