"use client";

import { useState } from "react";
import {
  CATEGORIES,
  SEASONS,
  FORMALITY,
  COLOURS,
} from "../lib/style-identity";
import {
  norm,
  newId,
  toggleIn,
  ChipPick,
  FilterGroup,
  PhotoButton,
  Thumb,
  uploadImage,
  deleteImage,
} from "./shared";

const EMPTY_FORM = {
  name: "",
  brand: "",
  category: "Tops",
  colours: [],
  season: "All year",
  formality: "Casual",
  tags: [],
  status: "owned",
  fitStatus: "current",
  needsStyling: false,
  notes: "",
};

export default function WardrobeTab({
  data,
  save,
  unlocked,
  needAuth,
  adminKey,
  flash,
  onStyle,
}) {
  const wardrobe = data.wardrobe;
  const vocab = data.settings.vocab || [];
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null); // id, "new", or null
  const [form, setForm] = useState(EMPTY_FORM);
  const [photo, setPhoto] = useState(null); // pending data URL for new/replaced photo
  const [tagging, setTagging] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [cats, setCats] = useState(new Set());
  const [brands, setBrands] = useState(new Set());
  const [cols, setCols] = useState(new Set());
  const [seas, setSeas] = useState(new Set());
  const [status, setStatus] = useState(new Set());
  const [flags, setFlags] = useState(new Set());

  function requireUnlock() {
    if (!unlocked) {
      needAuth();
      return false;
    }
    return true;
  }

  // --- add / edit -----------------------------------------------------------

  async function startNew(dataUrl) {
    if (!requireUnlock()) return;
    setForm(EMPTY_FORM);
    setPhoto(dataUrl);
    setEditingId("new");
    if (!data.ai) return;
    // AI-suggested tags, prefilled for approval - never saved unseen.
    setTagging(true);
    try {
      const res = await fetch("/api/tag", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey || "" },
        body: JSON.stringify({ image: dataUrl, kind: "wardrobe" }),
      });
      if (res.ok) {
        const t = await res.json();
        setForm((f) => ({
          ...f,
          name: t.name || f.name,
          brand: t.brand || f.brand,
          category: CATEGORIES.includes(t.category) ? t.category : f.category,
          colours: (t.colours || []).filter((c) => COLOURS.includes(c)),
          season: SEASONS.includes(t.season) ? t.season : f.season,
          formality: FORMALITY.includes(t.formality) ? t.formality : f.formality,
          tags: (t.tags || []).filter((x) => vocab.includes(x)),
          notes: t.notes || "",
        }));
        flash("Tags suggested - check and edit before saving");
      } else {
        flash("Tag suggestion failed - fill in by hand");
      }
    } catch {
      flash("Tag suggestion failed - fill in by hand");
    }
    setTagging(false);
  }

  function startEdit(item) {
    if (!requireUnlock()) return;
    setForm({
      name: item.name,
      brand: item.brand || "",
      category: item.category || "Tops",
      colours: item.colours || [],
      season: item.season || "All year",
      formality: item.formality || "Casual",
      tags: item.tags || [],
      status: item.status || "owned",
      fitStatus: item.fitStatus || "current",
      needsStyling: !!item.needsStyling,
      notes: item.notes || "",
    });
    setPhoto(null);
    setEditingId(item.id);
  }

  async function submit(e) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    const isNew = editingId === "new";
    const original = isNew ? null : wardrobe.find((w) => w.id === editingId);
    const id = isNew ? newId("w") : editingId;
    let photoId = original?.photoId;

    let uploadedNew = false;
    if (photo) {
      photoId = newId("wp");
      const up = await uploadImage(adminKey, photoId, photo);
      if (!up.ok) {
        flash(up.error);
        return;
      }
      uploadedNew = true;
    }

    const item = {
      id,
      name,
      brand: form.brand.trim(),
      photoId,
      category: form.category,
      colours: form.colours,
      season: form.season,
      formality: form.formality,
      tags: form.tags,
      status: form.status,
      fitStatus: form.fitStatus,
      needsStyling: form.needsStyling,
      notes: form.notes.trim(),
      addedAt: original?.addedAt || Date.now(),
    };
    const ok = await save(
      "wardrobe",
      isNew ? [...wardrobe, item] : wardrobe.map((w) => (w.id === id ? item : w))
    );
    if (!ok) {
      // Save failed: clean up the just-uploaded photo so nothing orphans,
      // and leave the form open so the entry isn't lost.
      if (uploadedNew) deleteImage(adminKey, photoId);
      return;
    }
    // Only retire the old photo once the item actually points at the new one.
    if (uploadedNew && original?.photoId) deleteImage(adminKey, original.photoId);
    setEditingId(null);
    setPhoto(null);
    // wanted -> owned means "I bought it": offer styling ideas straight away.
    if (original?.status === "wanted" && item.status === "owned") {
      flash("Bought! Let's style it");
      onStyle(id);
    } else {
      flash(isNew ? "Added to wardrobe" : "Saved");
    }
  }

  async function remove() {
    const item = wardrobe.find((w) => w.id === editingId);
    if (!item || !confirm(`Delete "${item.name}"?`)) return;
    const ok = await save(
      "wardrobe",
      wardrobe.filter((w) => w.id !== editingId)
    );
    if (ok) {
      if (item.photoId) deleteImage(adminKey, item.photoId);
      setEditingId(null);
      flash("Deleted");
    }
  }

  async function markOwned(item) {
    if (!requireUnlock()) return;
    const ok = await save(
      "wardrobe",
      wardrobe.map((w) => (w.id === item.id ? { ...w, status: "owned" } : w))
    );
    if (ok) {
      flash("Bought! Let's style it");
      onStyle(item.id);
    }
  }

  // --- form view ------------------------------------------------------------

  if (editingId !== null) {
    const isNew = editingId === "new";
    const original = isNew ? null : wardrobe.find((w) => w.id === editingId);
    return (
      <form className="form" onSubmit={submit}>
        <div className="form-photo-row">
          <Thumb
            dataUrl={photo}
            photoId={original?.photoId}
            className="form-thumb"
          />
          <div>
            <PhotoButton
              className="btn ghost"
              label={photo || original?.photoId ? "Replace photo" : "Add photo"}
              onPhoto={setPhoto}
              onError={flash}
            />
            {tagging && <div className="count" style={{ marginTop: 8 }}>Suggesting tags…</div>}
          </div>
        </div>
        <div className="cols name-brand">
          <div>
            <label>Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Cream wide-leg pants"
            />
          </div>
          <div>
            <label>Brand (optional)</label>
            <input
              value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
              placeholder="e.g. Esse"
            />
          </div>
        </div>
        <div>
          <label>Category</label>
          <ChipPick
            options={CATEGORIES}
            value={form.category}
            onChange={(v) => setForm({ ...form, category: v || form.category })}
          />
        </div>
        <div>
          <label>Colours</label>
          <ChipPick
            options={COLOURS}
            value={form.colours}
            multi
            onChange={(v) => setForm({ ...form, colours: v })}
          />
        </div>
        <div className="cols">
          <div>
            <label>Season</label>
            <select
              value={form.season}
              onChange={(e) => setForm({ ...form, season: e.target.value })}
            >
              {SEASONS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Formality</label>
            <select
              value={form.formality}
              onChange={(e) => setForm({ ...form, formality: e.target.value })}
            >
              {FORMALITY.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Status</label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="owned">Owned</option>
              <option value="wanted">Wanted</option>
            </select>
          </div>
        </div>
        <div>
          <label>Style tags</label>
          <ChipPick
            options={vocab}
            value={form.tags}
            multi
            onChange={(v) => setForm({ ...form, tags: v })}
          />
        </div>
        {form.status === "owned" && (
          <div className="flag-row">
            <label className="f-opt">
              <input
                type="checkbox"
                checked={form.fitStatus === "not_current"}
                onChange={(e) =>
                  setForm({
                    ...form,
                    fitStatus: e.target.checked ? "not_current" : "current",
                  })
                }
              />
              Not my current size (kept, but left out of suggestions)
            </label>
            <label className="f-opt">
              <input
                type="checkbox"
                checked={form.needsStyling}
                onChange={(e) => setForm({ ...form, needsStyling: e.target.checked })}
              />
              I don&rsquo;t know how to wear this yet
            </label>
          </div>
        )}
        <div>
          <label>Notes</label>
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="fabric, cut, styling detail…"
          />
        </div>
        <div className="row" style={{ marginBottom: 0 }}>
          <button className="btn" type="submit">
            Save
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              setEditingId(null);
              setPhoto(null);
            }}
          >
            Cancel
          </button>
          {!isNew && (
            <button
              className="btn danger"
              type="button"
              onClick={remove}
              style={{ marginLeft: "auto" }}
            >
              Delete
            </button>
          )}
        </div>
      </form>
    );
  }

  // --- list view ------------------------------------------------------------

  const q = norm(search);
  const inSearch = (w) =>
    !q ||
    norm(w.name).includes(q) ||
    norm(w.brand).includes(q) ||
    norm(w.category).includes(q) ||
    (w.colours || []).some((c) => norm(c).includes(q)) ||
    (w.tags || []).some((t) => norm(t).includes(q));

  function passes(w, skip) {
    if (skip !== "brand" && brands.size && !brands.has(w.brand || "")) return false;
    if (skip !== "cat" && cats.size && !cats.has(w.category)) return false;
    if (skip !== "col" && cols.size && !(w.colours || []).some((c) => cols.has(c)))
      return false;
    if (skip !== "sea" && seas.size && !seas.has(w.season)) return false;
    if (skip !== "status" && status.size && !status.has(w.status)) return false;
    if (skip !== "flags") {
      if (flags.has("needs") && !w.needsStyling) return false;
      if (flags.has("notsize") && w.fitStatus !== "not_current") return false;
    }
    return true;
  }

  const base = wardrobe.filter(inSearch);
  const countsFor = (group, values, match) => {
    const pool = base.filter((w) => passes(w, group));
    return values.map((v) => [v[0], v[1], pool.filter((w) => match(w, v[0])).length]);
  };

  const shown = base
    .filter((w) => passes(w))
    .sort((a, b) => a.name.localeCompare(b.name));
  const ownedCount = wardrobe.filter((w) => w.status === "owned").length;
  const activeCount =
    cats.size + brands.size + cols.size + seas.size + status.size + flags.size;
  // Brand facet is derived from whatever's been entered - no maintained list.
  const allBrands = [...new Set(wardrobe.map((w) => w.brand).filter(Boolean))].sort();

  return (
    <div>
      <div className="count">
        {ownedCount} pieces owned · {wardrobe.length - ownedCount} wanted
      </div>
      <div className="toolbar">
        <input
          placeholder="Search the wardrobe…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className={`btn ghost ${activeCount ? "has-filters" : ""}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          Filters{activeCount ? ` (${activeCount})` : ""}
        </button>
        <PhotoButton
          className="btn"
          label="+ Add from photo"
          onPhoto={startNew}
          onError={flash}
        />
      </div>
      {showFilters && (
        <div className="filter-panel">
          <FilterGroup
            title="Category"
            options={countsFor("cat", CATEGORIES.map((c) => [c, c]), (w, v) => w.category === v)}
            selected={cats}
            onToggle={(v) => toggleIn(cats, v, setCats)}
          />
          {allBrands.length > 0 && (
            <FilterGroup
              title="Brand"
              options={countsFor("brand", allBrands.map((b) => [b, b]), (w, v) => w.brand === v)}
              selected={brands}
              onToggle={(v) => toggleIn(brands, v, setBrands)}
            />
          )}
          <FilterGroup
            title="Colour"
            options={countsFor("col", COLOURS.map((c) => [c, c]), (w, v) =>
              (w.colours || []).includes(v)
            )}
            selected={cols}
            onToggle={(v) => toggleIn(cols, v, setCols)}
          />
          <FilterGroup
            title="Season"
            options={countsFor("sea", SEASONS.map((s) => [s, s]), (w, v) => w.season === v)}
            selected={seas}
            onToggle={(v) => toggleIn(seas, v, setSeas)}
          />
          <FilterGroup
            title="Status"
            options={countsFor(
              "status",
              [
                ["owned", "Owned"],
                ["wanted", "Wanted"],
              ],
              (w, v) => w.status === v
            )}
            selected={status}
            onToggle={(v) => toggleIn(status, v, setStatus)}
          />
          <FilterGroup
            title="Flags"
            options={countsFor(
              "flags",
              [
                ["needs", "Needs styling"],
                ["notsize", "Not current size"],
              ],
              (w, v) => (v === "needs" ? w.needsStyling : w.fitStatus === "not_current")
            )}
            selected={flags}
            onToggle={(v) => toggleIn(flags, v, setFlags)}
          />
        </div>
      )}

      {wardrobe.length === 0 && (
        <div className="empty">
          The wardrobe is empty. Snap or screenshot each capsule piece and add it
          with <b>+ Add from photo</b> - tags get suggested for you.
        </div>
      )}

      <div className="grid">
        {shown.map((w) => (
          <div
            key={w.id}
            className="card item-card clickable"
            onClick={() => startEdit(w)}
          >
            <Thumb photoId={w.photoId} alt={w.name} />
            <div className="card-body">
              <h3>{w.name}</h3>
              <div className="meta">
                {[w.brand, w.category, (w.colours || []).join(", "), w.season]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              <div className="badges">
                {w.status === "wanted" && <span className="badge want">wanted</span>}
                {w.needsStyling && <span className="badge needs">needs styling</span>}
                {w.fitStatus === "not_current" && (
                  <span className="badge notsize">not current size</span>
                )}
                {(w.tags || []).map((t) => (
                  <span key={t} className="badge soft">
                    {t}
                  </span>
                ))}
              </div>
              <div className="card-actions">
                {w.status === "owned" ? (
                  <button
                    className="chip"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStyle(w.id);
                    }}
                  >
                    Style this
                  </button>
                ) : (
                  <button
                    className="chip"
                    onClick={(e) => {
                      e.stopPropagation();
                      markOwned(w);
                    }}
                  >
                    I bought it
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {q && shown.length === 0 && wardrobe.length > 0 && (
        <div className="empty">Nothing matches &ldquo;{search}&rdquo;.</div>
      )}
    </div>
  );
}
