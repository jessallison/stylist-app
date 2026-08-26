"use client";

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

// Read a picked file, downscale and re-encode as JPEG so a 4MB phone photo
// becomes a ~100KB record. Steps the size down further if the first pass is
// still too big (very long screenshots), so uploads never bounce off the
// server's size cap. Returns a data URL.
// Note: browsers can't decode HEIC via <img> - iOS converts photo-picker
// picks to JPEG automatically, but a raw .heic from the Files app will fail
// here and surfaces as "couldn't read" rather than a silent skip.
export function fileToDataUrl(file, maxDim = 900, quality = 0.8) {
  return new Promise((resolve, reject) => {
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
    reader.readAsDataURL(file);
  });
}

// Chip-set picker (single or multi select).
export function ChipPick({ options, value, onChange, multi = false }) {
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
            {opt}
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

export function FilterGroup({ title, options, selected, onToggle }) {
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
          {label} {count != null && <span className="f-count">({count})</span>}
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
        accept="image/*"
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
// Deliberately bypasses the shared save() helper: every tab stays mounted
// at once (display:none, not unmounted), so all three tabs' backfills fire
// together on first load - and save() computes its POST body *inside* a
// setData updater, which React doesn't guarantee runs before the very next
// line reads it back out. A single call usually gets away with it; several
// landing close together is exactly what surfaced the same bug in the
// outfit-feedback recorder (see StyleTab). The fix there was the same as
// here: compute the full next value as a plain value first, then setData
// and POST from that - nothing left for timing to race.
export async function backfillHashes(type, items, setData, adminKey) {
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
  const next = items.map((it) => (hashes[it.id] ? { ...it, hash: hashes[it.id] } : it));
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
