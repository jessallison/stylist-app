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

// Read a picked file, downscale to max 900px and re-encode as JPEG so a
// 4MB phone photo becomes a ~100KB record. Returns a data URL.
export function fileToDataUrl(file, maxDim = 900, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Not an image"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
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
export function PhotoButton({ label, onPhoto, multiple = false, className }) {
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
              onPhoto(await fileToDataUrl(f));
            } catch {
              /* skip unreadable file */
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

// Upload an image to the store; returns true on success.
export async function uploadImage(adminKey, id, dataUrl) {
  const res = await fetch("/api/image", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-key": adminKey || "" },
    body: JSON.stringify({ id, dataUrl }),
  });
  return res.ok;
}

export function deleteImage(adminKey, id) {
  return fetch(`/api/image/${id}`, {
    method: "DELETE",
    headers: { "x-admin-key": adminKey || "" },
  });
}
