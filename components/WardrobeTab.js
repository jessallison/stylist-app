"use client";

import { useState, useEffect, useRef } from "react";
import {
  CATEGORIES,
  SEASONS,
  FORMALITY,
  COLOURS,
  COLOUR_TEXT_HEX,
} from "../lib/style-identity";
import {
  norm,
  newId,
  toggleIn,
  ChipPick,
  FilterGroup,
  PhotoButton,
  Thumb,
  TileToggle,
  uploadImage,
  deleteImage,
  hashDataUrl,
  groupDuplicates,
  backfillHashes,
  DuplicatesPanel,
  DupesToggle,
  rotateDataUrl,
  fetchImageAsDataUrl,
} from "./shared";
import CompositionChart from "./CompositionChart";

// Tile meta line ("Uniqlo · Tops · Grey · Cold weather") with the brand as a
// live shortcut into the Brand filter, rather than a link to a separate
// brand directory - the filter facet already has counts and already hides
// brands with nothing in them, so this just puts a faster door into it.
// onBrandClick is omitted (not just a no-op) for the "Today's pick" card,
// which sits outside the wardrobe grid it would be filtering.
function ItemMeta({ item, onBrandClick }) {
  const rest = [item.category, (item.colours || []).join(", "), item.season].filter(Boolean);
  return (
    <div className="meta">
      {item.brand &&
        (onBrandClick ? (
          <span
            className="brand-link"
            onClick={(e) => {
              e.stopPropagation();
              onBrandClick(item.brand);
            }}
          >
            {item.brand}
          </span>
        ) : (
          item.brand
        ))}
      {item.brand && rest.length > 0 ? " · " : ""}
      {rest.join(" · ")}
    </div>
  );
}

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
  // Named "heavy rotation" rather than "regular" on purpose - settings.regulars
  // is already a list of confirmed outfit formulas shown on the Profile page,
  // and this is a different thing entirely: a per-item "I wear this a lot"
  // flag set at add time, not an outfit combination.
  heavyRotation: false,
  notes: "",
  // Hard "never suggest these together" rule, set directly on the item -
  // structural incompatibilities (two jumpers, redundant layering) rather
  // than a taste call the AI could plausibly learn from feedback over time.
  // Kept in sync both ways at save time - see submit() below.
  excludeWith: [],
};

export default function WardrobeTab({
  data,
  save,
  setData,
  dataRef,
  unlocked,
  needAuth,
  adminKey,
  flash,
  onStyle,
  tileSize,
  setTileSize,
}) {
  const wardrobe = data.wardrobe;
  const vocab = data.settings.vocab || [];
  // Brand facet is derived from whatever's been entered - no maintained list.
  // Declared up here (not just where the filter panel uses it) because the
  // item form's brand autocomplete needs it too, and the form can render
  // before the rest of this function body runs (early return below).
  const allBrands = [...new Set(wardrobe.map((w) => w.brand).filter(Boolean))].sort();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null); // id, "new", or null
  const [form, setForm] = useState(EMPTY_FORM);
  const [excludeSearch, setExcludeSearch] = useState(""); // pending search text for "Doesn't pair with"
  const [newTag, setNewTag] = useState(""); // pending text for "add a new style tag"
  const [photo, setPhoto] = useState(null); // pending data URL for new/replaced photo
  const [tagging, setTagging] = useState(false);
  const [bgBusy, setBgBusy] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showComposition, setShowComposition] = useState(false);
  const [luckyId, setLuckyId] = useState(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkSeason, setBulkSeason] = useState("");
  const [bulkFormality, setBulkFormality] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  const [bulkColour, setBulkColour] = useState("");
  const [cats, setCats] = useState(new Set());
  const [tagsSel, setTagsSel] = useState(new Set());
  const [brands, setBrands] = useState(new Set());
  const [cols, setCols] = useState(new Set());
  const [seas, setSeas] = useState(new Set());
  const [status, setStatus] = useState(new Set());
  const [flags, setFlags] = useState(new Set());
  const [photoHash, setPhotoHash] = useState(null);
  const [dupMatch, setDupMatch] = useState(null);
  const [rotating, setRotating] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);

  // One-time backfill so items added before duplicate detection existed get
  // a hash too, and show up in the duplicates panel like anything new.
  const backfillRan = useRef(false);
  useEffect(() => {
    if (backfillRan.current) return;
    backfillRan.current = true;
    backfillHashes("wardrobe", wardrobe, setData, adminKey, dataRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-time fix for items still carrying the pre-rename "Knitwear" category
  // string (see lib/style-identity.js - CATEGORIES now has "Knitwear &
  // jumpers" instead). A stale value here doesn't error, it just silently
  // stops matching any category chip or filter, so an item can look
  // uncategorised without anything visibly failing. Self-healing: runs once
  // per load, a no-op as soon as nothing matches any more.
  const categoryMigrationRan = useRef(false);
  useEffect(() => {
    if (categoryMigrationRan.current) return;
    categoryMigrationRan.current = true;
    if (!wardrobe.some((w) => w.category === "Knitwear")) return;
    save(
      "wardrobe",
      wardrobe.map((w) =>
        w.category === "Knitwear" ? { ...w, category: "Knitwear & jumpers" } : w
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dupGroups = groupDuplicates(wardrobe);

  function requireUnlock() {
    if (!unlocked) {
      needAuth();
      return false;
    }
    return true;
  }

  async function removeDupItem(item) {
    if (!confirm(`Remove "${item.name}"?`)) return;
    const ok = await save("wardrobe", wardrobe.filter((w) => w.id !== item.id));
    if (ok) {
      if (item.photoId) deleteImage(adminKey, item.photoId);
      flash("Removed");
    }
  }

  // --- add / edit -----------------------------------------------------------

  // Wardrobe photos only (see lib/bgremove.js) - composites the garment onto
  // white so the grid reads as a catalogue rather than a phone snapshot.
  // Best-effort: a failure just keeps the original photo, flagged once.
  async function cleanBackground(rawDataUrl) {
    if (!data.bgRemoval) return rawDataUrl;
    setBgBusy(true);
    try {
      const res = await fetch("/api/bg-remove", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey || "" },
        body: JSON.stringify({ dataUrl: rawDataUrl }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        if (j.error !== "no-key") flash("Background removal failed - kept the original photo");
        return rawDataUrl;
      }
      const j = await res.json();
      return j.dataUrl;
    } catch {
      flash("Background removal failed - kept the original photo");
      return rawDataUrl;
    } finally {
      setBgBusy(false);
    }
  }

  async function startNew(rawDataUrl) {
    if (!requireUnlock()) return;
    setForm(EMPTY_FORM);
    setNewTag("");
    setExcludeSearch("");
    setPhoto(rawDataUrl);
    setEditingId("new");
    // Hash the untouched photo, before background removal can change its
    // bytes - that's what makes an exact match a reliable duplicate signal.
    const h = await hashDataUrl(rawDataUrl);
    setPhotoHash(h);
    setDupMatch(wardrobe.find((w) => w.hash === h) || null);
    const dataUrl = await cleanBackground(rawDataUrl);
    setPhoto(dataUrl);
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

  // Tapping a brand on a tile jumps straight to "only this brand" rather
  // than adding to whatever's already selected - it's a shortcut in, not
  // another way to build up a multi-brand filter.
  function filterByBrand(brand) {
    setBrands(new Set([brand]));
    setShowFilters(true);
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
      heavyRotation: !!item.heavyRotation,
      notes: item.notes || "",
      excludeWith: item.excludeWith || [],
    });
    setNewTag("");
    setExcludeSearch("");
    setPhoto(null);
    setPhotoHash(null);
    setDupMatch(null);
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
      hash: photo ? photoHash : original?.hash || null,
      category: form.category,
      colours: form.colours,
      season: form.season,
      formality: form.formality,
      tags: form.tags,
      status: form.status,
      fitStatus: form.fitStatus,
      needsStyling: form.needsStyling,
      heavyRotation: form.heavyRotation,
      notes: form.notes.trim(),
      addedAt: original?.addedAt || Date.now(),
      excludeWith: form.excludeWith,
    };
    const withItem = isNew
      ? [...wardrobe, item]
      : wardrobe.map((w) => (w.id === id ? item : w));
    // "Doesn't pair with" is symmetric - if this item now excludes another,
    // that other item needs this one added to its own list too (and removed
    // if it was dropped here), whichever side it was actually edited from.
    const nextWardrobe = withItem.map((w) => {
      if (w.id === id) return w;
      const should = item.excludeWith.includes(w.id);
      const does = (w.excludeWith || []).includes(id);
      if (should === does) return w;
      return {
        ...w,
        excludeWith: should
          ? [...(w.excludeWith || []), id]
          : (w.excludeWith || []).filter((x) => x !== id),
      };
    });
    const ok = await save("wardrobe", nextWardrobe);
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
    setPhotoHash(null);
    setDupMatch(null);
    // wanted -> owned means "I bought it": offer styling ideas straight away.
    if (original?.status === "wanted" && item.status === "owned") {
      flash("Bought! Let's style it");
      onStyle(id);
    } else {
      flash(isNew ? "Added to wardrobe" : "Saved");
    }
  }

  // Style tags only offer whatever's already in the vocab list (ChipPick has
  // no free-text option) - this is the same "add new, right where you need
  // it" gap the brand field had. A new word joins the vocab (so it's there
  // for every future item) and gets selected on this item immediately.
  // Matching case-insensitively against the existing list avoids "Oversized"
  // and "oversized" quietly becoming two different tags.
  async function addNewTag() {
    const word = newTag.trim();
    if (!word) return;
    const existing = vocab.find((v) => norm(v) === norm(word));
    if (existing) {
      if (!form.tags.includes(existing)) setForm({ ...form, tags: [...form.tags, existing] });
      setNewTag("");
      return;
    }
    const ok = await save("settings", (prev) => ({ ...prev, vocab: [...(prev.vocab || []), word] }));
    if (ok) {
      setForm({ ...form, tags: [...form.tags, word] });
      setNewTag("");
    }
  }

  async function remove() {
    const item = wardrobe.find((w) => w.id === editingId);
    if (!item || !confirm(`Delete "${item.name}"?`)) return;
    const ok = await save(
      "wardrobe",
      wardrobe
        .filter((w) => w.id !== editingId)
        // Clear the deleted item out of anything that excluded it, so the
        // list doesn't quietly carry a dangling id.
        .map((w) =>
          (w.excludeWith || []).includes(editingId)
            ? { ...w, excludeWith: w.excludeWith.filter((x) => x !== editingId) }
            : w
        )
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

  // --- bulk edit --------------------------------------------------------------

  function toggleBulk(id) {
    setBulkSelected((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function exitBulk() {
    setBulkMode(false);
    setBulkSelected(new Set());
  }

  // Applies a patch to every selected item in one save, so a batch of 20
  // edits is one write, not twenty.
  async function bulkApply(patch, label) {
    if (bulkSelected.size === 0) return;
    const n = bulkSelected.size;
    const ok = await save(
      "wardrobe",
      wardrobe.map((w) => (bulkSelected.has(w.id) ? { ...w, ...patch(w) } : w))
    );
    if (ok) flash(`${label} - ${n} item${n === 1 ? "" : "s"}`);
  }

  async function bulkDelete() {
    if (bulkSelected.size === 0) return;
    const n = bulkSelected.size;
    if (!confirm(`Delete ${n} item${n === 1 ? "" : "s"}? This can't be undone.`)) return;
    const toDelete = wardrobe.filter((w) => bulkSelected.has(w.id));
    const ok = await save(
      "wardrobe",
      wardrobe.filter((w) => !bulkSelected.has(w.id))
    );
    if (ok) {
      toDelete.forEach((w) => w.photoId && deleteImage(adminKey, w.photoId));
      flash(`Deleted ${n} item${n === 1 ? "" : "s"}`);
      setBulkSelected(new Set());
    }
  }

  // --- form view ------------------------------------------------------------

  if (editingId !== null) {
    const isNew = editingId === "new";
    const original = isNew ? null : wardrobe.find((w) => w.id === editingId);

    // Rotates whatever's currently showing 90° clockwise. If a new/replaced
    // photo is pending in state, turn that; otherwise pull the saved photo
    // down first. Either way it lands in `photo`, so Save uploads the turned
    // version as normal - the rotation is baked into the pixels, not a CSS
    // transform that would only hold in this app.
    async function handleRotate() {
      if (!requireUnlock()) return;
      setRotating(true);
      try {
        const source = photo || (original?.photoId ? await fetchImageAsDataUrl(adminKey, original.photoId) : null);
        if (!source) return;
        const rotated = await rotateDataUrl(source, 90);
        setPhoto(rotated);
        const h = await hashDataUrl(rotated);
        setPhotoHash(h);
        setDupMatch(wardrobe.find((w) => w.hash === h && w.id !== editingId) || null);
      } catch (e) {
        flash(e.message || "Couldn't rotate that photo");
      } finally {
        setRotating(false);
      }
    }

    // Same idea as handleRotate, but for the retroactive case: photos added
    // before background removal was configured, or that were saved without
    // it for whatever reason. Same source-then-target dance - use the
    // pending `photo` if there is one, otherwise pull the saved photo down
    // first - then run it through the same remove.bg pass startNew() uses.
    async function handleRemoveBg() {
      if (!requireUnlock()) return;
      try {
        const source = photo || (original?.photoId ? await fetchImageAsDataUrl(adminKey, original.photoId) : null);
        if (!source) return;
        const cleaned = await cleanBackground(source);
        setPhoto(cleaned);
        const h = await hashDataUrl(cleaned);
        setPhotoHash(h);
        setDupMatch(wardrobe.find((w) => w.hash === h && w.id !== editingId) || null);
      } catch (e) {
        flash(e.message || "Couldn't remove the background");
      }
    }

    return (
      <form className="form" onSubmit={submit}>
        <div className="form-photo-row">
          <Thumb
            dataUrl={photo}
            photoId={original?.photoId}
            className="form-thumb"
          />
          <div>
            <div className="photo-actions-row">
              <PhotoButton
                className="btn ghost"
                label={photo || original?.photoId ? "Replace photo" : "Add photo"}
                onPhoto={async (raw) => {
                  const h = await hashDataUrl(raw);
                  setPhotoHash(h);
                  setDupMatch(wardrobe.find((w) => w.hash === h && w.id !== editingId) || null);
                  setPhoto(await cleanBackground(raw));
                }}
                onError={flash}
              />
              {(photo || original?.photoId) && (
                <button
                  type="button"
                  className="photo-icon-btn"
                  onClick={handleRotate}
                  disabled={rotating}
                  aria-label="Rotate photo"
                  title="Rotate 90°"
                >
                  <svg viewBox="0 0 16 16" fill="none">
                    <path
                      d="M13 8A5 5 0 1 1 11.5 4.4"
                      stroke="currentColor"
                      strokeLinecap="round"
                    />
                    <path
                      d="M13 3.5V7h-3.5"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
              {(photo || original?.photoId) && data.bgRemoval && (
                <button
                  type="button"
                  className="photo-icon-btn"
                  onClick={handleRemoveBg}
                  disabled={bgBusy}
                  aria-label="Remove background"
                  title="Remove background"
                >
                  <svg viewBox="0 0 16 16" fill="none">
                    <rect
                      x="1"
                      y="1"
                      width="14"
                      height="14"
                      rx="1"
                      stroke="currentColor"
                      strokeDasharray="2 2"
                    />
                    <rect x="5" y="5" width="6" height="6" fill="currentColor" />
                  </svg>
                </button>
              )}
            </div>
            {bgBusy && <div className="count" style={{ marginTop: 8 }}>Removing background…</div>}
            {tagging && <div className="count" style={{ marginTop: 8 }}>Suggesting tags…</div>}
          </div>
        </div>
        {dupMatch && (
          <div className="dup-warning">
            Looks identical to <b>{dupMatch.name}</b>, already in your wardrobe.
            <button type="button" className="chip" onClick={() => setDupMatch(null)}>
              Dismiss
            </button>
          </div>
        )}
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
              list="brand-options"
              autoComplete="off"
            />
            {/* Suggests brands already in the wardrobe as you type, so the
                same brand doesn't fragment into near-duplicate spellings -
                still a free-text field, so a genuinely new brand types in
                same as always. */}
            <datalist id="brand-options">
              {allBrands.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
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
            swatches={COLOUR_TEXT_HEX}
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
          <div className="row" style={{ marginTop: 8 }}>
            <input
              type="text"
              placeholder="Add a new tag…"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addNewTag();
                }
              }}
            />
            <button type="button" className="chip" onClick={addNewTag} disabled={!newTag.trim()}>
              Add
            </button>
          </div>
        </div>
        <div>
          <label>Doesn&rsquo;t pair with</label>
          <div className="section-sub" style={{ marginTop: -2, marginBottom: 6 }}>
            A hard no, so they&rsquo;ve never suggested in outfits together.
          </div>
          {form.excludeWith.length > 0 && (
            <div className="chip-pick" style={{ marginBottom: 8 }}>
              {form.excludeWith.map((exId) => (
                <button
                  type="button"
                  key={exId}
                  className="chip on"
                  onClick={() =>
                    setForm({
                      ...form,
                      excludeWith: form.excludeWith.filter((x) => x !== exId),
                    })
                  }
                  title="Remove"
                >
                  {wardrobe.find((w) => w.id === exId)?.name || "Removed item"} ✕
                </button>
              ))}
            </div>
          )}
          <input
            type="text"
            placeholder="Search wardrobe to add…"
            value={excludeSearch}
            onChange={(e) => setExcludeSearch(e.target.value)}
          />
          {excludeSearch.trim() && (
            <div className="chip-pick" style={{ marginTop: 8 }}>
              {wardrobe
                .filter(
                  (w) =>
                    w.id !== editingId &&
                    !form.excludeWith.includes(w.id) &&
                    norm(w.name).includes(norm(excludeSearch))
                )
                .slice(0, 8)
                .map((w) => (
                  <button
                    type="button"
                    key={w.id}
                    className="chip"
                    onClick={() => {
                      setForm({ ...form, excludeWith: [...form.excludeWith, w.id] });
                      setExcludeSearch("");
                    }}
                  >
                    {w.name}
                  </button>
                ))}
              {wardrobe.filter(
                (w) =>
                  w.id !== editingId &&
                  !form.excludeWith.includes(w.id) &&
                  norm(w.name).includes(norm(excludeSearch))
              ).length === 0 && <span className="count">No match</span>}
            </div>
          )}
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
            <label className="f-opt">
              <input
                type="checkbox"
                checked={form.heavyRotation}
                onChange={(e) => setForm({ ...form, heavyRotation: e.target.checked })}
              />
              I wear this a lot
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
          <button className="btn" type="submit" disabled={bgBusy}>
            Save
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              setEditingId(null);
              setPhoto(null);
              setPhotoHash(null);
              setDupMatch(null);
              setNewTag("");
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
    if (skip !== "cat" && cats.size && !cats.has(w.category)) return false;
    if (skip !== "tags" && tagsSel.size && !(w.tags || []).some((t) => tagsSel.has(t)))
      return false;
    if (skip !== "col" && cols.size && !(w.colours || []).some((c) => cols.has(c)))
      return false;
    if (skip !== "sea" && seas.size && !seas.has(w.season)) return false;
    if (skip !== "brand" && brands.size && !brands.has(w.brand || "")) return false;
    if (skip !== "status" && status.size && !status.has(w.status)) return false;
    if (skip !== "flags") {
      if (flags.has("needs") && !w.needsStyling) return false;
      if (flags.has("notsize") && w.fitStatus !== "not_current") return false;
      if (flags.has("regular") && !w.heavyRotation) return false;
    }
    return true;
  }

  const base = wardrobe.filter(inSearch);
  // Drops options nothing in the wardrobe currently has - e.g. "Dresses"
  // never shows up in a menswear wardrobe's filter panel. A selected option
  // stays visible even at zero (from combining with another active filter),
  // so it's never possible to select something you then can't un-select.
  const countsFor = (group, values, match, selected) => {
    const pool = base.filter((w) => passes(w, group));
    return values
      .map((v) => [v[0], v[1], pool.filter((w) => match(w, v[0])).length])
      .filter(([v, , count]) => count > 0 || selected.has(v));
  };

  const shown = base
    .filter((w) => passes(w))
    .sort((a, b) => a.name.localeCompare(b.name));
  const ownedCount = wardrobe.filter((w) => w.status === "owned").length;
  const activeCount =
    cats.size + tagsSel.size + brands.size + cols.size + seas.size + status.size + flags.size;

  // Shuffle: picks from whatever's currently shown and wearable, respecting
  // active search/filters - same "🎲 Surprise me" pattern as the recipe app.
  const luckyPool = shown.filter(
    (w) => w.status === "owned" && w.fitStatus !== "not_current"
  );
  const luckyEntry = luckyId ? luckyPool.find((w) => w.id === luckyId) : null;
  function pickLucky() {
    if (luckyPool.length === 0) return;
    const pool =
      luckyPool.length > 1 ? luckyPool.filter((w) => w.id !== luckyId) : luckyPool;
    setLuckyId(pool[Math.floor(Math.random() * pool.length)].id);
  }

  // Composition chart: the whole owned, currently-wearable wardrobe, not
  // narrowed by whatever search/filters happen to be active - it's an audit
  // view, not a filtered list.
  const wearable = wardrobe.filter(
    (w) => w.status === "owned" && w.fitStatus !== "not_current"
  );

  // One-tap category filter, same pattern as Inspo's type chips: only
  // categories actually in use, counts against the whole wardrobe (not
  // narrowed by other active filters or search).
  const categoryCounts = CATEGORIES.map((c) => [
    c,
    wardrobe.filter((w) => w.category === c).length,
  ]).filter(([, n]) => n > 0);

  return (
    <div>
      <div className="count">
        {ownedCount} pieces owned · {wardrobe.length - ownedCount} wanted
      </div>
      {categoryCounts.length > 1 && (
        <div className="chip-pick" style={{ marginBottom: 12 }}>
          <button
            className={`chip ${cats.size === 0 ? "sel" : ""}`}
            onClick={() => setCats(new Set())}
          >
            All
          </button>
          {categoryCounts.map(([c, n]) => (
            <button
              key={c}
              className={`chip ${cats.size === 1 && cats.has(c) ? "sel" : ""}`}
              onClick={() =>
                setCats(cats.size === 1 && cats.has(c) ? new Set() : new Set([c]))
              }
            >
              {c} ({n})
            </button>
          ))}
        </div>
      )}
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
        {activeCount > 0 && (
          <button
            type="button"
            className="chip"
            onClick={() => {
              setCats(new Set());
              setTagsSel(new Set());
              setBrands(new Set());
              setCols(new Set());
              setSeas(new Set());
              setStatus(new Set());
              setFlags(new Set());
            }}
          >
            Clear filters
          </button>
        )}
        <button
          className="chip"
          onClick={pickLucky}
          disabled={luckyPool.length === 0}
        >
          🎲 {luckyEntry ? "Pick again" : "Surprise me"}
        </button>
        <button
          className={`btn ghost ${showComposition ? "has-filters" : ""}`}
          onClick={() => setShowComposition(!showComposition)}
        >
          Composition
        </button>
        <button
          className={`btn ghost ${bulkMode ? "has-filters" : ""}`}
          onClick={() => {
            if (bulkMode) return exitBulk();
            if (!requireUnlock()) return;
            setBulkMode(true);
          }}
        >
          {bulkMode ? "Done" : "Bulk edit"}
        </button>
        <PhotoButton
          className="btn"
          label="+ Add from photo"
          onPhoto={startNew}
          onError={flash}
        />
        <DupesToggle
          count={dupGroups.length}
          open={showDuplicates}
          onToggle={() => setShowDuplicates(!showDuplicates)}
        />
        <TileToggle size={tileSize} onChange={setTileSize} />
      </div>

      {showComposition && <CompositionChart items={wearable} />}

      {showDuplicates && (
        <DuplicatesPanel
          groups={dupGroups}
          renderLabel={(w) => (
            <>
              {w.name}
              <span className="dup-sub">
                {w.brand ? `${w.brand} · ` : ""}
                {w.category}
              </span>
            </>
          )}
          onRemove={removeDupItem}
        />
      )}

      {bulkMode && (
        <div className="bulk-panel">
          <div className="bulk-head">
            <span>
              {bulkSelected.size} selected of {shown.length} shown
            </span>
            <button className="lucky-dismiss" onClick={() => setBulkSelected(new Set(shown.map((w) => w.id)))}>
              Select all shown
            </button>
            <button className="lucky-dismiss" onClick={() => setBulkSelected(new Set())}>
              Clear
            </button>
          </div>

          <div className="bulk-row">
            <select value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)}>
              <option value="">Set category…</option>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button
              className="chip"
              disabled={!bulkCategory || bulkSelected.size === 0}
              onClick={() => bulkApply(() => ({ category: bulkCategory }), `Category set to ${bulkCategory}`)}
            >
              Apply
            </button>
          </div>

          <div className="bulk-row">
            <select value={bulkSeason} onChange={(e) => setBulkSeason(e.target.value)}>
              <option value="">Set season…</option>
              {SEASONS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <button
              className="chip"
              disabled={!bulkSeason || bulkSelected.size === 0}
              onClick={() => bulkApply(() => ({ season: bulkSeason }), `Season set to ${bulkSeason}`)}
            >
              Apply
            </button>
          </div>

          <div className="bulk-row">
            <select value={bulkFormality} onChange={(e) => setBulkFormality(e.target.value)}>
              <option value="">Set formality…</option>
              {FORMALITY.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
            <button
              className="chip"
              disabled={!bulkFormality || bulkSelected.size === 0}
              onClick={() => bulkApply(() => ({ formality: bulkFormality }), `Formality set to ${bulkFormality}`)}
            >
              Apply
            </button>
          </div>

          <div className="bulk-row">
            <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
              <option value="">Set status…</option>
              <option value="owned">Owned</option>
              <option value="wanted">Wanted</option>
            </select>
            <button
              className="chip"
              disabled={!bulkStatus || bulkSelected.size === 0}
              onClick={() => bulkApply(() => ({ status: bulkStatus }), `Status set to ${bulkStatus}`)}
            >
              Apply
            </button>
          </div>

          {vocab.length > 0 && (
            <div className="bulk-row">
              <select value={bulkTag} onChange={(e) => setBulkTag(e.target.value)}>
                <option value="">Add tag…</option>
                {vocab.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <button
                className="chip"
                disabled={!bulkTag || bulkSelected.size === 0}
                onClick={() =>
                  bulkApply(
                    (w) =>
                      (w.tags || []).includes(bulkTag)
                        ? {}
                        : { tags: [...(w.tags || []), bulkTag] },
                    `"${bulkTag}" added`
                  )
                }
              >
                Add
              </button>
            </div>
          )}

          <div className="bulk-row">
            <select value={bulkColour} onChange={(e) => setBulkColour(e.target.value)}>
              <option value="">Add colour…</option>
              {COLOURS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button
              className="chip"
              disabled={!bulkColour || bulkSelected.size === 0}
              onClick={() =>
                bulkApply(
                  (w) =>
                    (w.colours || []).includes(bulkColour)
                      ? {}
                      : { colours: [...(w.colours || []), bulkColour] },
                  `"${bulkColour}" added`
                )
              }
            >
              Add
            </button>
          </div>

          <div className="bulk-row">
            <button
              className="chip"
              disabled={bulkSelected.size === 0}
              onClick={() => bulkApply(() => ({ fitStatus: "not_current" }), "Marked not current size")}
            >
              Mark not current size
            </button>
            <button
              className="chip"
              disabled={bulkSelected.size === 0}
              onClick={() => bulkApply(() => ({ fitStatus: "current" }), "Cleared not current size")}
            >
              Clear
            </button>
          </div>

          <div className="bulk-row">
            <button
              className="chip"
              disabled={bulkSelected.size === 0}
              onClick={() => bulkApply(() => ({ needsStyling: true }), "Flagged needs styling")}
            >
              Flag needs styling
            </button>
            <button
              className="chip"
              disabled={bulkSelected.size === 0}
              onClick={() => bulkApply(() => ({ needsStyling: false }), "Cleared needs styling")}
            >
              Clear
            </button>
          </div>

          <div className="bulk-row">
            <button
              className="chip"
              disabled={bulkSelected.size === 0}
              onClick={() => bulkApply(() => ({ heavyRotation: true }), "Flagged wear a lot")}
            >
              Flag wear a lot
            </button>
            <button
              className="chip"
              disabled={bulkSelected.size === 0}
              onClick={() => bulkApply(() => ({ heavyRotation: false }), "Cleared wear a lot")}
            >
              Clear
            </button>
          </div>

          <div className="bulk-row">
            <button className="btn danger" disabled={bulkSelected.size === 0} onClick={bulkDelete}>
              Delete selected
            </button>
          </div>
        </div>
      )}
      {showFilters && (
        <div className="filter-panel">
          <FilterGroup
            title="Category"
            options={countsFor("cat", CATEGORIES.map((c) => [c, c]), (w, v) => w.category === v, cats)}
            selected={cats}
            onToggle={(v) => toggleIn(cats, v, setCats)}
          />
          {vocab.length > 0 && (
            <FilterGroup
              title="Tags"
              options={countsFor("tags", vocab.map((t) => [t, t]), (w, v) =>
                (w.tags || []).includes(v)
              , tagsSel)}
              selected={tagsSel}
              onToggle={(v) => toggleIn(tagsSel, v, setTagsSel)}
            />
          )}
          <FilterGroup
            title="Colour"
            options={countsFor("col", COLOURS.map((c) => [c, c]), (w, v) =>
              (w.colours || []).includes(v)
            , cols)}
            selected={cols}
            onToggle={(v) => toggleIn(cols, v, setCols)}
            swatches={COLOUR_TEXT_HEX}
          />
          <FilterGroup
            title="Season"
            options={countsFor("sea", SEASONS.map((s) => [s, s]), (w, v) => w.season === v, seas)}
            selected={seas}
            onToggle={(v) => toggleIn(seas, v, setSeas)}
          />
          {allBrands.length > 0 && (
            <FilterGroup
              title="Brand"
              options={countsFor("brand", allBrands.map((b) => [b, b]), (w, v) => w.brand === v, brands)}
              selected={brands}
              onToggle={(v) => toggleIn(brands, v, setBrands)}
            />
          )}
          <FilterGroup
            title="Status"
            options={countsFor(
              "status",
              [
                ["owned", "Owned"],
                ["wanted", "Wanted"],
              ],
              (w, v) => w.status === v,
              status
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
                ["regular", "Wear a lot"],
              ],
              (w, v) =>
                v === "needs"
                  ? w.needsStyling
                  : v === "notsize"
                  ? w.fitStatus === "not_current"
                  : w.heavyRotation,
              flags
            )}
            selected={flags}
            onToggle={(v) => toggleIn(flags, v, setFlags)}
          />
        </div>
      )}

      {luckyEntry && (
        <div className="lucky-pick">
          <div className="lucky-head">
            <div className="section-h" style={{ margin: 0 }}>Today&rsquo;s pick</div>
            <button className="lucky-dismiss" onClick={() => setLuckyId(null)}>
              Dismiss
            </button>
          </div>
          <div className="lucky-card">
            <Thumb photoId={luckyEntry.photoId} alt={luckyEntry.name} />
            <div className="card-body">
              <h3>{luckyEntry.name}</h3>
              <ItemMeta item={luckyEntry} />
              <div className="card-actions">
                <button className="chip" onClick={() => onStyle(luckyEntry.id)}>
                  Style this
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {wardrobe.length === 0 && (
        <div className="empty">
          Your wardrobe is empty. Add photos of your clothing to get started.
        </div>
      )}

      <div className={`grid ${tileSize === "compact" ? "compact" : ""}`}>
        {shown.map((w) => (
          <div
            key={w.id}
            className={`card item-card clickable ${bulkMode && bulkSelected.has(w.id) ? "picked" : ""}`}
            onClick={() => (bulkMode ? toggleBulk(w.id) : startEdit(w))}
          >
            <Thumb photoId={w.photoId} alt={w.name} />
            {/* Compact grid hides .card-body entirely (name/meta/badges/all
                actions) to fit more tiles per row - this is the one action
                that survives that, as a bare link under the thumb. */}
            {!bulkMode && (
              <button
                className="chip compact-style-link"
                onClick={(e) => {
                  e.stopPropagation();
                  onStyle(w.id);
                }}
              >
                Style this
              </button>
            )}
            <div className="card-body">
              <h3>{w.name}</h3>
              <ItemMeta item={w} onBrandClick={filterByBrand} />
              <div className="badges">
                {w.status === "wanted" && <span className="badge want">wanted</span>}
                {w.needsStyling && <span className="badge needs">needs styling</span>}
                {w.fitStatus === "not_current" && (
                  <span className="badge notsize">not current size</span>
                )}
                {w.heavyRotation && <span className="badge regular">wear a lot</span>}
                {(w.tags || []).map((t) => (
                  <span key={t} className="badge soft">
                    {t}
                  </span>
                ))}
              </div>
              {!bulkMode && (
                <div className="card-actions">
                  <button
                    className="chip"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStyle(w.id);
                    }}
                  >
                    Style this
                  </button>
                  {w.status === "wanted" && (
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
              )}
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
