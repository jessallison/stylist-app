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
