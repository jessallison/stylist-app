"use client";

import { useState, useEffect, useRef } from "react";
import {
  SEASONS,
  OCCASIONS,
  COLOURS,
  COLOUR_TEXT_HEX,
  INSPO_TYPES,
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
  fileToDataUrl,
} from "./shared";

const TYPE_LABEL = Object.fromEntries(INSPO_TYPES);

export default function InspoTab({
  data,
  save,
  setData,
  dataRef,
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
  const vocab = data.settings.vocab || [];
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(0); // uploads in flight
  const [showFilters, setShowFilters] = useState(false);
  const [types, setTypes] = useState(new Set());
  const [tagsSel, setTagsSel] = useState(new Set());
  const [cols, setCols] = useState(new Set());
  const [occs, setOccs] = useState(new Set());
  const [seas, setSeas] = useState(new Set());
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);

  // One-time backfill so items added before duplicate detection existed get
  // a hash too, and show up in the duplicates panel like anything new.
  const backfillRan = useRef(false);
  useEffect(() => {
    if (backfillRan.current) return;
    backfillRan.current = true;
    backfillHashes("inspo", inspo, setData, adminKey, dataRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dupGroups = groupDuplicates(inspo);

  function requireUnlock() {
    if (!unlocked) {
      needAuth();
      return false;
    }
    return true;
  }

  async function removeDupItem(item) {
    if (!confirm("Remove this inspo image?")) return;
    const ok = await save("inspo", inspo.filter((i) => i.id !== item.id));
    if (ok) {
      if (item.photoId) deleteImage(adminKey, item.photoId);
      flash("Removed");
    }
  }

  // Upload → classify (Claude vision) → save, one image at a time so a batch
  // of screenshots can be dropped in together. sourceHint pre-fills the
  // (editable) source field - used when a photo arrived via addFromUrl,
  // where we already know where it came from.
  async function addPhoto(dataUrl, sourceHint = "") {
    if (!requireUnlock()) return;
    setBusy((b) => b + 1);
    try {
      // Hash before upload - an exact match against anything already saved
      // means this is very likely the same screenshot added twice.
      const hash = await hashDataUrl(dataUrl);
      const dupOf = inspo.find((i) => i.hash === hash);
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
        hash,
        source: sourceHint,
        type: ["outfit", "flatlay", "product"].includes(tags.type)
          ? tags.type
          : "outfit",
        occasion: OCCASIONS.includes(tags.occasion) ? tags.occasion : "",
        season: SEASONS.includes(tags.season) ? tags.season : "",
        colours: (tags.colours || []).filter((c) => COLOURS.includes(c)),
        tags: (tags.tags || []).filter((t) => vocab.includes(t)),
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
      if (dupOf) {
        flash("Saved - heads up, this looks identical to one already saved");
      } else if (item.type === "product") {
        flash("Saved - looks like an item. Add it to the wardrobe as wanted?");
      }
    } finally {
      setBusy((b) => b - 1);
    }
  }

  // Fetches the link server-side (avoids the browser's CORS block on
  // reading a third-party image into canvas) and hands the result to the
  // exact same fileToDataUrl → addPhoto pipeline a picked file goes
  // through, so resizing, tagging and dedup all stay in the one place.
  async function addFromUrl(e) {
    e.preventDefault();
    if (!requireUnlock()) return;
    const url = urlInput.trim();
    if (!url) return;
    setUrlBusy(true);
    try {
      const res = await fetch("/api/inspo-from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey || "" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        flash(j.error || "Couldn't add that image");
        return;
      }
      const blob = await res.blob();
      const file = new File([blob], "inspo.jpg", { type: blob.type || "image/jpeg" });
      const dataUrl = await fileToDataUrl(file);
      let hostname = "";
      try {
        hostname = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        /* keep source blank if the URL somehow doesn't parse a second time */
      }
      await addPhoto(dataUrl, hostname);
      setUrlInput("");
      setShowUrlInput(false);
    } catch (err) {
      flash(err.message || "Couldn't add that image");
    } finally {
      setUrlBusy(false);
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
            swatches={COLOUR_TEXT_HEX}
            onChange={(v) => setForm({ ...form, colours: v })}
          />
        </div>
        <div>
          <label>Style tags</label>
          <ChipPick
            options={vocab}
            value={form.tags || []}
            multi
            onChange={(v) => setForm({ ...form, tags: v })}
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

  const q = norm(search);
  const inSearch = (i) =>
    !q ||
    norm(i.notes).includes(q) ||
    norm(i.source).includes(q) ||
    norm(i.productName).includes(q) ||
    norm(i.occasion).includes(q) ||
    norm(i.season).includes(q) ||
    (i.colours || []).some((c) => norm(c).includes(q)) ||
    (i.tags || []).some((t) => norm(t).includes(q));

  function passes(i, skip) {
    if (skip !== "type" && types.size && !types.has(i.type)) return false;
    if (skip !== "tags" && tagsSel.size && !(i.tags || []).some((t) => tagsSel.has(t)))
      return false;
    if (skip !== "col" && cols.size && !(i.colours || []).some((c) => cols.has(c)))
      return false;
    if (skip !== "sea" && seas.size && !seas.has(i.season)) return false;
    if (skip !== "occ" && occs.size && !occs.has(i.occasion)) return false;
    return true;
  }
  const base = inspo.filter(inSearch);
  // Drops options nothing saved currently has - see the same helper in
  // WardrobeTab.js for why a selected option stays visible even at zero.
  const countsFor = (group, values, match, selected) => {
    const pool = base.filter((i) => passes(i, group));
    return values
      .map((v) => [v[0], v[1], pool.filter((i) => match(i, v[0])).length])
      .filter(([v, , count]) => count > 0 || selected.has(v));
  };
  const shown = base.filter((i) => passes(i)).sort((a, b) => b.addedAt - a.addedAt);
  const activeCount = types.size + tagsSel.size + cols.size + seas.size + occs.size;

  return (
    <div>
      <div className="count">
        {inspo.length} saved · screenshots from Pinterest, Depop, Vinted, anywhere
      </div>
      {/* One-tap type filter - the everyday facet, no panel required. */}
      {inspo.length > 0 && (
        <div className="chip-pick" style={{ marginBottom: 12 }}>
          <button
            className={`chip ${types.size === 0 ? "sel" : ""}`}
            onClick={() => setTypes(new Set())}
          >
            All
          </button>
          {INSPO_TYPES.map(([v, label]) => (
            <button
              key={v}
              className={`chip ${types.size === 1 && types.has(v) ? "sel" : ""}`}
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
        <input
          placeholder="Search inspo…"
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
              setTypes(new Set());
              setTagsSel(new Set());
              setCols(new Set());
              setOccs(new Set());
              setSeas(new Set());
            }}
          >
            Clear filters
          </button>
        )}
        <PhotoButton
          className="btn"
          label={busy ? `Adding… (${busy})` : "+ Add images"}
          onPhoto={addPhoto}
          onError={flash}
          multiple
        />
        <button
          type="button"
          className="btn ghost"
          onClick={() => setShowUrlInput((v) => !v)}
        >
          {showUrlInput ? "Cancel" : "+ Add from URL"}
        </button>
        <DupesToggle
          count={dupGroups.length}
          open={showDuplicates}
          onToggle={() => setShowDuplicates(!showDuplicates)}
        />
        <TileToggle size={tileSize} onChange={setTileSize} />
      </div>

      {showUrlInput && (
        <form className="row" onSubmit={addFromUrl} style={{ marginTop: -4 }}>
          <input
            type="url"
            required
            autoFocus
            placeholder="Paste a Pinterest, Depop or product link…"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            style={{ flex: "1 1 auto" }}
          />
          <button className="btn" type="submit" disabled={urlBusy}>
            {urlBusy ? "Adding…" : "Add"}
          </button>
        </form>
      )}

      {showDuplicates && (
        <DuplicatesPanel
          groups={dupGroups}
          renderLabel={(i) => (
            <>
              {TYPE_LABEL[i.type] || i.type}
              <span className="dup-sub">
                {new Date(i.addedAt).toLocaleDateString("en-AU", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </>
          )}
          onRemove={removeDupItem}
        />
      )}
      {showFilters && (
        <div className="filter-panel">
          <FilterGroup
            title="Type"
            options={countsFor("type", INSPO_TYPES, (i, v) => i.type === v, types)}
            selected={types}
            onToggle={(v) => toggleIn(types, v, setTypes)}
          />
          {vocab.length > 0 && (
            <FilterGroup
              title="Tags"
              options={countsFor("tags", vocab.map((t) => [t, t]), (i, v) =>
                (i.tags || []).includes(v)
              , tagsSel)}
              selected={tagsSel}
              onToggle={(v) => toggleIn(tagsSel, v, setTagsSel)}
            />
          )}
          <FilterGroup
            title="Colour"
            options={countsFor("col", COLOURS.map((c) => [c, c]), (i, v) =>
              (i.colours || []).includes(v)
            , cols)}
            selected={cols}
            onToggle={(v) => toggleIn(cols, v, setCols)}
            swatches={COLOUR_TEXT_HEX}
          />
          <FilterGroup
            title="Season"
            options={countsFor("sea", SEASONS.map((s) => [s, s]), (i, v) => i.season === v, seas)}
            selected={seas}
            onToggle={(v) => toggleIn(seas, v, setSeas)}
          />
          <FilterGroup
            title="Occasion"
            options={countsFor("occ", OCCASIONS.map((o) => [o, o]), (i, v) => i.occasion === v, occs)}
            selected={occs}
            onToggle={(v) => toggleIn(occs, v, setOccs)}
          />
        </div>
      )}

      {inspo.length === 0 && (
        <div className="empty">
          This is where your inspiration clothes live, currently a blank
          canvas! Try adding some Pinterest pins or photos you&rsquo;ve saved.
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
            {/* Compact grid hides .card-body entirely (badges/notes/all
                actions) to fit more tiles per row - mirrors Wardrobe's
                compact-style-link: the one action that survives, as a bare
                link under the thumb, matching whichever primary action
                card-actions below would otherwise show for this type. */}
            {i.type === "product" ? (
              <button
                className="chip compact-style-link"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddWanted(i);
                }}
              >
                Add to wardrobe
              </button>
            ) : (
              <button
                className="chip compact-style-link"
                onClick={(e) => {
                  e.stopPropagation();
                  onMatch(i.id);
                }}
              >
                Style me
              </button>
            )}
            <div className="card-body">
              <div className="badges">
                {/* An outfit photo reads as one at a glance - the badge is
                    only worth the space for the less obvious types. */}
                {i.type !== "outfit" && (
                  <span className={`badge type-${i.type}`}>{TYPE_LABEL[i.type]}</span>
                )}
                {i.occasion && <span className="badge soft">{i.occasion}</span>}
                {i.season && <span className="badge soft">{i.season}</span>}
                {(i.tags || []).map((t) => (
                  <span key={t} className="badge soft">
                    {t}
                  </span>
                ))}
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
      {q && shown.length === 0 && inspo.length > 0 && (
        <div className="empty">Nothing matches &ldquo;{search}&rdquo;.</div>
      )}
    </div>
  );
}
