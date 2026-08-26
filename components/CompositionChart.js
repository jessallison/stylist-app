"use client";

// Wardrobe composition: a category donut (single-value field, so shares sum
// to 100%) plus colour and formality breakdowns as bars (colours are
// multi-value per item, so these are "N of X pieces", not percentages of a
// whole). Pure SVG/CSS - no charting library, kept lightweight and themed to
// match the app's editorial palette rather than a default rainbow.

// Muted, editorial tones - cycles if there are more categories/formalities
// than colours (there won't be, in practice).
const PALETTE = [
  "#141210", // ink
  "#96502b", // rust (the app's alert colour, reused as a chart accent)
  "#7d8570", // sage
  "#a98f6b", // tan
  "#4f5d75", // slate blue
  "#8a6f5c", // walnut
  "#c9a227", // mustard
  "#5e3b4a", // plum
  "#6f6a60", // muted ink (matches --muted)
  "#3f6d9e", // denim blue
  "#c9bfae", // stone
  "#a8532e", // clay
];

// Approximate swatches for the wardrobe's colour vocabulary - recognisable
// at a glance, not exact garment matches.
const COLOUR_HEX = {
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
  "Multi / print": "linear-gradient(135deg, #a83232 25%, #3f6d9e 25% 50%, #c9a227 50% 75%, #4a6b4a 75%)",
};

function countBy(items, fn) {
  const counts = new Map();
  for (const w of items) {
    const v = fn(w) || "Unspecified";
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function countByMulti(items, fn) {
  const counts = new Map();
  for (const w of items) {
    for (const v of fn(w) || []) {
      counts.set(v, (counts.get(v) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

export default function CompositionChart({ items }) {
  if (items.length === 0) {
    return (
      <div className="empty">
        Nothing to chart yet - add a few owned, currently-wearable pieces
        first.
      </div>
    );
  }

  const catCounts = countBy(items, (w) => w.category);
  const total = items.length;
  const catSegments = catCounts.map(([label, count], i) => ({
    label,
    count,
    pct: Math.round((count / total) * 1000) / 10,
    colour: PALETTE[i % PALETTE.length],
  }));

  const colCounts = countByMulti(items, (w) => w.colours);
  const colMax = colCounts[0]?.[1] || 1;

  const formCounts = countBy(items, (w) => w.formality);
  const formMax = formCounts[0]?.[1] || 1;

  return (
    <div className="comp-panel">
      <div className="comp-scope">
        Based on {total} owned, currently-wearable piece{total === 1 ? "" : "s"}.
      </div>

      <div className="comp-donut-row">
        <Donut segments={catSegments} />
        <div className="comp-legend">
          {catSegments.map((s) => (
            <div key={s.label} className="comp-legend-row">
              <span className="comp-swatch" style={{ background: s.colour }} />
              <span className="comp-legend-label">{s.label}</span>
              <span className="comp-legend-count">
                {s.count} · {s.pct}%
              </span>
            </div>
          ))}
        </div>
      </div>

      <BarGroup title="Colour" rows={colCounts} max={colMax} swatches={COLOUR_HEX} />
      <BarGroup title="Formality" rows={formCounts} max={formMax} />
    </div>
  );
}

function Donut({ segments }) {
  let cumulative = 0;
  return (
    <svg viewBox="0 0 40 40" className="comp-donut" role="img" aria-label="Wardrobe by category">
      {segments.map((s) => {
        const offset = 25 + (100 - cumulative);
        cumulative += s.pct;
        return (
          <circle
            key={s.label}
            cx="20"
            cy="20"
            r="15.9155"
            fill="transparent"
            stroke={s.colour}
            strokeWidth="6"
            strokeDasharray={`${s.pct} ${100 - s.pct}`}
            strokeDashoffset={offset}
          />
        );
      })}
    </svg>
  );
}

function BarGroup({ title, rows, max, swatches }) {
  return (
    <div className="comp-bars">
      <div className="comp-bars-title">{title}</div>
      {rows.map(([label, count]) => (
        <div key={label} className="comp-bar-row">
          {swatches && (
            <span
              className="comp-swatch"
              style={{ background: swatches[label] || "var(--tile)" }}
            />
          )}
          <span className="comp-bar-label">{label}</span>
          <div className="comp-bar-track">
            <div
              className="comp-bar-fill"
              style={{ width: `${Math.max(4, (count / max) * 100)}%` }}
            />
          </div>
          <span className="comp-bar-count">{count}</span>
        </div>
      ))}
    </div>
  );
}
