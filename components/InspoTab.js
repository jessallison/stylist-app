"use client";

import { useState } from "react";
import {
  SEASONS,
  OCCASIONS,
  COLOURS,
  INSPO_TYPES,
} from "../lib/style-identity";
import {
  newId,
  toggleIn,
  ChipPick,
  FilterGroup,
  PhotoButton,
  Thumb,
  TileToggle,
  uploadImage,
  deleteImage,
} from "./shared";

const TYPE_LABEL = Object.fromEntries(INSPO_TYPES);

export default function InspoTab({
  data,
  save,
  unlocked,
  needAuth,
  adminKey,
  flash,
  onMatch,
  onAddWanted,
  tileSize,
  setTileSize,
}) {
  const inspo = data.inspo;
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(0); // uploads in flight
  const [showFilters, setShowFilters] = useState(false);
  const [types, setTypes] = useState(new Set());
  const [occs, setOccs] = useState(new Set());
  const [seas, setSeas] = useState(new Set());

  function requireUnlock() {
    if (!unlocked) {
      needAuth();
      return false;
    }
    return true;
  }

  // Upload → classify (Claude vision) → save, one image at a time so a batch
  // of screenshots can be dropped in together.
  async function addPhoto(dataUrl) {
    if (!requireUnlock()) return;
    setBusy((b) => b + 1);
    try {
      const photoId = newId("ip");
      const up = await uploadImage(adminKey, photoId, dataUrl);
      if (!up.ok) {
        flash(up.error);
        return;
      }
      let tags = {};
      if (data.ai) {
        try {
          const res = await fetch("/api/tag", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-admin-key": adminKey || "",
            },
            body: JSON.stringify({ image: dataUrl, kind: "inspo" }),
          });
          if (res.ok) tags = await res.json();
        } catch {
          /* classification is best-effort */
        }
      }
      const item = {
        id: newId("i"),
        photoId,
        source: "",
        type: ["outfit", "flatlay", "product"].includes(tags.type)
          ? tags.type
          : "outfit",
        occasion: OCCASIONS.includes(tags.occasion) ? tags.occasion : "",
        season: SEASONS.includes(tags.season) ? tags.season : "",
        colours: (tags.colours || []).filter((c) => COLOURS.includes(c)),
        notes: tags.description || "",
        productName: tags.productName || "",
        addedAt: Date.now(),
      };
      // Functional update so a multi-file batch appends cleanly instead of
      // each file clobbering the previous one's save.
      const ok = await save("inspo", (cur) => [...cur, item]);
      if (!ok) {
        deleteImage(adminKey, photoId);
        return;
      }
      if (item.type === "product") {
        flash("Saved - looks like a product pin. Add it to the wardrobe as wanted?");
      }
    } finally {
      setBusy((b) => b - 1);
    }
  }

  function startEdit(item) {
    if (!requireUnlock()) return;
    setForm({ ...item });
    setEditingId(item.id);
  }

  async function submit(e) {
    e.preventDefault();
    const ok = await save(
      "inspo",
      inspo.map((i) => (i.id === editingId ? { ...form, notes: form.notes.trim() } : i))
    );
    if (ok) {
      setEditingId(null);
      flash("Saved");
    }
  }

  async function remove() {
    const item = inspo.find((i) => i.id === editingId);
    if (!item || !confirm("Delete this inspo image?")) return;
    const ok = await save(
      "inspo",
      inspo.filter((i) => i.id !== editingId)
    );
    if (ok) {
      if (item.photoId) deleteImage(adminKey, item.photoId);
      setEditingId(null);
      flash("Deleted");
    }
  }

  // --- edit form ------------------------------------------------------------

  if (editingId !== null && form) {
    return (
      <form className="form" onSubmit={submit}>
        <div className="form-photo-row">
          <Thumb photoId={form.photoId} className="form-thumb" />
          <div className="count">
            Fix anything the auto-classification got wrong.
          </div>
        </div>
        <div>
          <label>Type</label>
          <div className="chip-pick">
            {INSPO_TYPES.map(([v, label]) => (
              <button
                type="button"
                key={v}
                className={`chip ${form.type === v ? "on" : ""}`}
                onClick={() => setForm({ ...form, type: v })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="cols">
          <div>
            <label>Occasion</label>
            <select
              value={form.occasion}
              onChange={(e) => setForm({ ...form, occasion: e.target.value })}
            >
              <option value="">(none)</option>
              {OCCASIONS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Season</label>
            <select
              value={form.season}
              onChange={(e) => setForm({ ...form, season: e.target.value })}
            >
              <option value="">(none)</option>
              {SEASONS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Source</label>
            <input
              value={form.source || ""}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              placeholder="Pinterest, Depop, screenshot…"
            />
          </div>
        </div>
        <div>
          <label>Colours</label>
          <ChipPick
            options={COLOURS}
            value={form.colours || []}
            multi
            onChange={(v) => setForm({ ...form, colours: v })}
          />
        </div>
        <div>
          <label>Notes</label>
          <input
            value={form.notes || ""}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
        <div className="row" style={{ marginBottom: 0 }}>
          <button className="btn" type="submit">
            Save
          </button>
          <button className="btn ghost" type="button" onClick={() => setEditingId(null)}>
            Cancel
          </button>
          <button
            className="btn danger"
            type="button"
            onClick={remove}
            style={{ marginLeft: "auto" }}
          >
            Delete
          </button>
        </div>
      </form>
    );
  }

  // --- list -----------------------------------------------------------------

  function passes(i, skip) {
    if (skip !== "type" && types.size && !types.has(i.type)) return false;
    if (skip !== "occ" && occs.size && !occs.has(i.occasion)) return false;
    if (skip !== "sea" && seas.size && !seas.has(i.season)) return false;
    return true;
  }
  const countsFor = (group, values, match) => {
    const pool = inspo.filter((i) => passes(i, group));
    return values.map((v) => [v[0], v[1], pool.filter((i) => match(i, v[0])).length]);
  };
  const shown = inspo.filter((i) => passes(i)).sort((a, b) => b.addedAt - a.addedAt);
  const activeCount = types.size + occs.size + seas.size;

  return (
    <div>
      <div className="count">
        {inspo.length} saved · screenshots from Pinterest, Depop, Vinted, anywhere
      </div>
      {/* One-tap type filter - the everyday facet, no panel required. */}
      {inspo.length > 0 && (
        <div className="chip-pick" style={{ marginBottom: 12 }}>
          <button
            className={`chip ${types.size === 0 ? "on" : ""}`}
            onClick={() => setTypes(new Set())}
          >
            All
          </button>
          {INSPO_TYPES.map(([v, label]) => (
            <button
              key={v}
              className={`chip ${types.size === 1 && types.has(v) ? "on" : ""}`}
              onClick={() =>
                setTypes(
                  types.size === 1 && types.has(v) ? new Set() : new Set([v])
                )
              }
            >
              {label} ({inspo.filter((i) => i.type === v).length})
            </button>
          ))}
        </div>
      )}
      <div className="toolbar">
        <button
          className={`btn ghost ${activeCount ? "has-filters" : ""}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          Filters{activeCount ? ` (${activeCount})` : ""}
        </button>
        <PhotoButton
          className="btn"
          label={busy ? `Adding… (${busy})` : "+ Add images"}
          onPhoto={addPhoto}
          onError={flash}
          multiple
        />
        <TileToggle size={tileSize} onChange={setTileSize} />
      </div>
      {showFilters && (
        <div className="filter-panel">
          <FilterGroup
            title="Type"
            options={countsFor("type", INSPO_TYPES, (i, v) => i.type === v)}
            selected={types}
            onToggle={(v) => toggleIn(types, v, setTypes)}
          />
          <FilterGroup
            title="Occasion"
            options={countsFor("occ", OCCASIONS.map((o) => [o, o]), (i, v) => i.occasion === v)}
            selected={occs}
            onToggle={(v) => toggleIn(occs, v, setOccs)}
          />
          <FilterGroup
            title="Season"
            options={countsFor("sea", SEASONS.map((s) => [s, s]), (i, v) => i.season === v)}
            selected={seas}
            onToggle={(v) => toggleIn(seas, v, setSeas)}
          />
        </div>
      )}

      {inspo.length === 0 && (
        <div className="empty">
          No inspiration saved yet. Add screenshots with <b>+ Add images</b> -
          each one gets auto-sorted into outfit photo, flat-lay or product pin.
        </div>
      )}

      <div className={`grid ${tileSize === "compact" ? "compact" : ""}`}>
        {shown.map((i) => (
          <div
            key={i.id}
            className="card item-card clickable"
            onClick={() => startEdit(i)}
          >
            <Thumb photoId={i.photoId} className="thumb tall" />
            <div className="card-body">
              <div className="badges">
                <span className={`badge type-${i.type}`}>{TYPE_LABEL[i.type]}</span>
                {i.occasion && <span className="badge soft">{i.occasion}</span>}
                {i.season && <span className="badge soft">{i.season}</span>}
              </div>
              {i.notes && <div className="meta">{i.notes}</div>}
              <div className="card-actions">
                {i.type === "product" ? (
                  <button
                    className="chip"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddWanted(i);
                    }}
                  >
                    Add to wardrobe as wanted
                  </button>
                ) : (
                  <button
                    className="chip"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMatch(i.id);
                    }}
                  >
                    Style me
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
