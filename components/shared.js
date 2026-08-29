"use client";

import { COLOUR_TEXT_HEX } from "../lib/style-identity";

// Small shared pieces used by every tab.

export const norm = (s) => (s || "").trim().toLowerCase();

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export function toggleIn(set, value, setter) {
  const next = new Set(set);
  next.has(value) ? next.delete(value) : next.add(value);
  setter(next);
}

// HEIC/HEIF (iPhone's native photo format when "Most Compatible" isn't
// turned on, or anything pulled from the Files app rather than the photo
// picker) can't be decoded by <img> in any browser - it just fires onerror.
// Detected by MIME type and, since Safari/iOS often leaves the file's type
// blank, by extension too.
const HEIC_EXT_RE = /\.hei[cf]$/i;
function looksLikeHeic(file) {
  const type = (file.type || "").toLowerCase();
  return type === "image/heic" || type === "image/heif" || HEIC_EXT_RE.test(file.name || "");
}

// Dynamic import so the ~3MB decoder only loads for the rare HEIC upload,
// never adding to the bundle every other photo pick pays for.
async function convertHeicToJpeg(file) {
  const { heicTo } = await import("heic-to");
  const blob = await heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
  // Re-wrap as a File (not just a Blob) so downstream error messages still
  // reference a sensible name instead of "file".
  return new File([blob], (file.name || "photo").replace(HEIC_EXT_RE, ".jpg"), {
    type: "image/jpeg",
  });
}

// Read a picked file, downscale and re-encode as JPEG so a 4MB phone photo
// becomes a ~100KB record. Steps the size down further if the first pass is
// still too big (very long screenshots), so uploads never bounce off the
// server's size cap. Returns a data URL. HEIC/HEIF files are converted to
// JPEG first (see convertHeicToJpeg above), then flow through the same
// resize pipeline as everything else.
export function fileToDataUrl(file, maxDim = 900, quality = 0.8) {
  return new Promise((resolve, reject) => {
    (async () => {
      let source = file;
      if (looksLikeHeic(file)) {
        try {
          source = await convertHeicToJpeg(file);
        } catch (e) {
          reject(
            new Error(
              `Couldn't convert "${file.name || "that HEIC file"}" - try exporting it as JPEG first`
            )
          );
          return;
        }
      }
      const reader = new FileReader();
      reader.onerror = () =>
        reject(new Error(`Couldn't read "${file.name || "file"}"`));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () =>
          reject(
            new Error(
              `Couldn't read "${file.name || "file"}" as an image (HEIC files need converting to JPEG first)`
            )
          );
        img.onload = () => {
          try {
            const attempts = [
              [maxDim, quality],
              [700, 0.72],
              [550, 0.6],
            ];
            for (const [dim, q] of attempts) {
              const scale = Math.min(1, dim / Math.max(img.width, img.height));
              const canvas = document.createElement("canvas");
              canvas.width = Math.max(1, Math.round(img.width * scale));
              canvas.height = Math.max(1, Math.round(img.height * scale));
              canvas
                .getContext("2d")
                .drawImage(img, 0, 0, canvas.width, canvas.height);
              const out = canvas.toDataURL("image/jpeg", q);
              // Stay under the server's 900KB cap with headroom.
              if (out.length < 650_000) return resolve(out);
            }
            reject(new Error(`"${file.name || "Image"}" is too large to compress`));
          } catch (e) {
            reject(e);
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(source);
    })();
  });
}

// Cycled letter-by-letter for the "Multi / print" label, instead of a
// gradient clipped across the whole word - on a short label a clipped
// gradient often lands most letters in one washed-out band of the sweep.
// Pulled straight from COLOUR_TEXT_HEX, so every letter is already
// legibility-adjusted - none of them render too light to read.
const MULTI_LETTER_COLOURS = [
  COLOUR_TEXT_HEX.Red,
  COLOUR_TEXT_HEX.Blue,
  COLOUR_TEXT_HEX.Green,
  COLOUR_TEXT_HEX.Purple,
  COLOUR_TEXT_HEX.Orange,
  COLOUR_TEXT_HEX.Burgundy,
  COLOUR_TEXT_HEX.Denim,
  COLOUR_TEXT_HEX.Rust,
];

// A swatch value is either a plain hex string (applied as text colour) or
// the "Multi / print" gradient marker, rendered instead as rainbow letters.
// Returns plain `label` when there's no swatch to apply.
function swatchLabel(label, swatch) {
  if (!swatch) return label;
  if (swatch.startsWith("linear-gradient")) {
    return label.split("").map((ch, i) => (
      <span
        key={i}
        style={{ color: MULTI_LETTER_COLOURS[i % MULTI_LETTER_COLOURS.length] }}
      >
        {ch}
      </span>
    ));
  }
  return <span style={{ color: swatch }}>{label}</span>;
}

// Chip-set picker (single or multi select). `swatches` is an optional
// {option: hex} map (see COLOUR_TEXT_HEX in lib/style-identity) - when
// given, an unselected chip's text renders in that colour, so "Rust" reads
// as rust-coloured text. A SELECTED chip keeps the app's normal ink-fill
// look untouched (every other chip type means "chosen" that same way, and
// swatch-coloured text would lose contrast against the dark fill anyway).
export function ChipPick({ options, value, onChange, multi = false, swatches }) {
  const selected = multi ? new Set(value || []) : null;
  return (
    <div className="chip-pick">
      {options.map((opt) => {
        const on = multi ? selected.has(opt) : value === opt;
        return (
          <button
            type="button"
            key={opt}
            className={`chip ${on ? "on" : ""}`}
            onClick={() => {
              if (multi) {
                const next = new Set(selected);
                on ? next.delete(opt) : next.add(opt);
                onChange([...next]);
              } else {
                onChange(on ? "" : opt);
              }
            }}
          >
            {on ? opt : swatchLabel(opt, swatches?.[opt])}
          </button>
        );
      })}
    </div>
  );
}

// Tile-density toggle for the Wardrobe/Inspo grids - "compact" (more, smaller,
// no text) vs "large" (fewer, bigger, with name/meta), same idea as the
// grid-density switch on shopping sites. State lives in page.js (localStorage
// key "stylist-tile-size") so both tabs, which stay mounted the whole
// session, stay in sync with each other.
export function TileToggle({ size, onChange }) {
  return (
    <div className="tile-toggle">
      <button
        type="button"
        className={size === "compact" ? "on" : ""}
        onClick={() => onChange("compact")}
        aria-label="Small tiles"
        title="Small tiles, no text"
      >
        <svg viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="4" height="4" stroke="currentColor" />
          <rect x="6" y="1" width="4" height="4" stroke="currentColor" />
          <rect x="11" y="1" width="4" height="4" stroke="currentColor" />
          <rect x="1" y="6" width="4" height="4" stroke="currentColor" />
          <rect x="6" y="6" width="4" height="4" stroke="currentColor" />
          <rect x="11" y="6" width="4" height="4" stroke="currentColor" />
          <rect x="1" y="11" width="4" height="4" stroke="currentColor" />
          <rect x="6" y="11" width="4" height="4" stroke="currentColor" />
          <rect x="11" y="11" width="4" height="4" stroke="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className={size === "large" ? "on" : ""}
        onClick={() => onChange("large")}
        aria-label="Large tiles"
        title="Large tiles, with details"
      >
        <svg viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="6.5" height="6.5" stroke="currentColor" />
          <rect x="8.5" y="1" width="6.5" height="6.5" stroke="currentColor" />
          <rect x="1" y="8.5" width="6.5" height="6.5" stroke="currentColor" />
          <rect x="8.5" y="8.5" width="6.5" height="6.5" stroke="currentColor" />
        </svg>
      </button>
    </div>
  );
}

// Icon-only toggle for the duplicates panel - deliberately quieter than the
// primary toolbar actions (Filters, Composition, Bulk edit). Checking for
// duplicates is housekeeping, not something done every session, so it sits
// with the view controls rather than the pill row: a plain outline icon,
// a small neutral count badge only when there's something to see, and the
// same "currently open" highlight the tile-size toggle uses - no new colour
// language, just the existing active-state convention.
export function DupesToggle({ count, open, onToggle }) {
  return (
    <button
      type="button"
      className={`dupes-btn ${open ? "on" : ""}`}
      onClick={onToggle}
      aria-label="Duplicates"
      title={count ? `${count} possible duplicate${count === 1 ? "" : "s"}` : "Check for duplicates"}
    >
      <svg viewBox="0 0 16 16" fill="none">
        <rect x="5" y="1" width="9" height="10" rx="1" stroke="currentColor" />
        <path
          d="M3 5v6.5A1.5 1.5 0 0 0 4.5 13H10"
          stroke="currentColor"
          strokeLinecap="round"
        />
      </svg>
      {count > 0 && <span className="dupes-badge">{count}</span>}
    </button>
  );
}

// `swatches` is an optional {value: hex} map (see COLOUR_TEXT_HEX) - when
// given, each option's label renders in that colour so the Colour filter
// panel reads the same way the colour chip pickers do.
export function FilterGroup({ title, options, selected, onToggle, swatches }) {
  return (
    <div className="f-group">
      <div className="f-group-title">{title}</div>
      {options.map(([value, label, count]) => (
        <label key={value} className="f-opt">
          <input
            type="checkbox"
            checked={selected.has(value)}
            onChange={() => onToggle(value)}
          />
          <span>{swatchLabel(label, swatches?.[value])}</span>{" "}
          {count != null && <span className="f-count">({count})</span>}
        </label>
      ))}
    </div>
  );
}

// A photo file input styled as a button; hands back a compressed data URL.
// Unreadable files are reported through onError, never silently skipped.
export function PhotoButton({ label, onPhoto, onError, multiple = false, className }) {
  return (
    <label className={className || "btn"} style={{ cursor: "pointer" }}>
      {label}
      <input
        type="file"
        accept="image/*,.heic,.heif"
        multiple={multiple}
        style={{ display: "none" }}
        onChange={async (e) => {
          const files = [...e.target.files];
          e.target.value = "";
          for (const f of files) {
            try {
              await onPhoto(await fileToDataUrl(f));
            } catch (err) {
              onError?.(err.message || "Couldn't read that image");
            }
          }
        }}
      />
    </label>
  );
}

// Rotate a data URL 90 degrees clockwise, baking the turn into the pixels
// (not just a CSS transform) so it sticks once saved. Re-encodes as JPEG at
// the same quality fileToDataUrl already uses, since this always runs on an
// image that's already been through that pipeline once.
export function rotateDataUrl(dataUrl, degrees = 90) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Couldn't rotate that photo"));
    img.onload = () => {
      try {
        const swap = ((degrees / 90) % 2 + 2) % 2 === 1;
        const canvas = document.createElement("canvas");
        canvas.width = swap ? img.height : img.width;
        canvas.height = swap ? img.width : img.height;
        const ctx = canvas.getContext("2d");
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((degrees * Math.PI) / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      } catch (e) {
        reject(e);
      }
    };
    img.src = dataUrl;
  });
}

// Pull an already-saved photo down as a data URL so it can be rotated (or
// otherwise re-processed) client-side, same as a freshly-picked file would
// be. Needed because rotating an existing item's photo - one nobody just
// picked from the file input - starts from a photoId, not a data URL.
export async function fetchImageAsDataUrl(adminKey, photoId) {
  const res = await fetch(`/api/image/${photoId}`, {
    headers: { "x-admin-key": adminKey || "" },
  });
  if (!res.ok) throw new Error("Couldn't load that photo");
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that photo"));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

export function Thumb({ photoId, dataUrl, alt = "", className = "thumb" }) {
  const src = dataUrl || (photoId ? `/api/image/${photoId}` : null);
  if (!src) return <div className={`${className} thumb-empty`}>no photo</div>;
  return <img className={className} src={src} alt={alt} loading="lazy" />;
}

// Upload an image to the store. Returns { ok, error } - error carries the
// server's reason (too large, database down) for the toast.
// One automatic retry: a ~150-900KB photo body is exactly the size that gets
// cut off mid-upload on a flaky mobile connection, so a single silent retry
// resolves most of those before the user ever sees an error.
export async function uploadImage(adminKey, id, dataUrl) {
  let lastResult;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey || "" },
        body: JSON.stringify({ id, dataUrl }),
      });
      if (res.ok) return { ok: true };
      const j = await res.json().catch(() => ({}));
      lastResult = { ok: false, error: j.error || "Photo upload failed - try again" };
    } catch {
      lastResult = { ok: false, error: "No connection - photo upload failed" };
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
  }
  return lastResult;
}

// Best-effort cleanup; failures are logged, never surfaced.
export function deleteImage(adminKey, id) {
  return fetch(`/api/image/${id}`, {
    method: "DELETE",
    headers: { "x-admin-key": adminKey || "" },
  }).catch(() => {});
}

// --- Duplicate detection ----------------------------------------------------
// SHA-256 of an image's raw bytes. A genuine re-photograph of the same piece
// never hashes the same as an earlier shot, so a match here is reliably an
// accidental double-add (a double-tap, or re-adding an already-imported
// export) rather than a stylistic judgement call - free, deterministic, no
// AI call, no false positives.

async function digestHex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashDataUrl(dataUrl) {
  const base64 = (dataUrl.split(",")[1] || "").trim();
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return digestHex(bytes);
}

export async function hashBuffer(buffer) {
  return digestHex(new Uint8Array(buffer));
}

// Groups of 2+ items sharing an image hash - the "possible duplicates" view
// for a tab. Items that predate this feature and haven't been backfilled
// yet (no `hash`) are simply excluded until they are.
export function groupDuplicates(items) {
  const byHash = new Map();
  for (const item of items) {
    if (!item.hash) continue;
    if (!byHash.has(item.hash)) byHash.set(item.hash, []);
    byHash.get(item.hash).push(item);
  }
  return [...byHash.values()].filter((g) => g.length > 1);
}

// One-time backfill for items saved before hashing existed. Fetches each
// missing photo once and writes all the new hashes back in a single save.
//
// Deliberately bypasses the shared save() helper - it's best-effort (no
// rollback, no error toast, no login-modal-on-401 needed for a silent
// housekeeping write) and every tab stays mounted at once, so backfills
// for wardrobe/inspo/styleProfile can all be in flight together.
//
// `items` is a snapshot from whenever the caller's one-time effect fired -
// by the time the hash fetches above finish (a Promise.all over every
// un-hashed photo, which can take a couple of seconds), it can be stale.
// Writing `items` straight back would silently drop anything added, and
// resurrect anything removed, during that window - real data loss, not a
// display glitch, since this write also overwrites the server copy. `dataRef`
// is a ref page.js keeps in sync with live state on every render, so it's
// read fresh here, right before the write, instead of trusting the snapshot
// the backfill started with.
export async function backfillHashes(type, items, setData, adminKey, dataRef) {
  const missing = items.filter((it) => it.photoId && !it.hash);
  if (!missing.length) return;
  const hashes = {};
  await Promise.all(
    missing.map(async (it) => {
      try {
        const res = await fetch(`/api/image/${it.photoId}`, {
          headers: { "x-admin-key": adminKey || "" },
        });
        if (!res.ok) return;
        hashes[it.id] = await hashBuffer(await res.arrayBuffer());
      } catch {
        // Best-effort - picked up again on the next load.
      }
    })
  );
  if (!Object.keys(hashes).length) return;
  const current = (dataRef?.current?.[type]) || items;
  const next = current.map((it) => (hashes[it.id] ? { ...it, hash: hashes[it.id] } : it));
  setData((d) => ({ ...d, [type]: next }));
  try {
    await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": adminKey || "" },
      body: JSON.stringify({ type, data: next }),
    });
  } catch {
    // Best-effort - the local hashes still landed, and this is picked up
    // again next load if the write itself didn't make it.
  }
}

// Shared "possible duplicates" review panel - same shape across Wardrobe,
// Inspo and worn outfits, since all three are photo-driven lists under the
// hood. `renderLabel` supplies the per-type caption, `onRemove` the
// per-type delete (which also knows how to clean up its own photo).
export function DuplicatesPanel({ groups, renderLabel, onRemove }) {
  if (!groups.length) {
    return (
      <div className="empty">
        No duplicates found - nothing shares an identical photo.
      </div>
    );
  }
  return (
    <div className="dup-panel">
      {groups.map((g, gi) => (
        <div className="dup-group" key={gi}>
          {g.map((item) => (
            <div className="dup-item" key={item.id}>
              <Thumb photoId={item.photoId} className="thumb sq" />
              <div className="dup-meta">{renderLabel(item)}</div>
              <button type="button" className="chip" onClick={() => onRemove(item)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
