"use client";

import { useState, useEffect, useRef } from "react";
import { geocodeCity } from "../lib/weather";
import { SEASONS, FORMALITY, COLOURS, COLOUR_TEXT_HEX } from "../lib/style-identity";
import {
  newId,
  PhotoButton,
  Thumb,
  TileToggle,
  TagCloud,
  ItemPicker,
  uploadImage,
  deleteImage,
  hashDataUrl,
  groupDuplicates,
  backfillHashes,
  DuplicatesPanel,
  DupesToggle,
  FilterGroup,
  toggleIn,
  outfitFacets,
  sortItemIdsByCategory,
} from "./shared";

// Style profile: worn-outfit photos, each linked to the real wardrobe pieces
// worn in it (item_ids - same shape a saved look uses), plus the editable
// style identity (three words, vocabulary, regulars, home city for today's
// weather). Until Sep 2026 these were tagged with a coarse, hand-picked
// Cold/Warm/Fancy bucket instead (PROFILE_CONTEXTS in lib/style-identity.js)
// - replaced because linking to real items makes that bucket (and proper
// season/occasion/colour filtering) computable instead of guessed at upload
// time, and because it doubles as another way to catch wardrobe pieces that
// never got catalogued on their own.

export default function ProfileTab({
  data,
  save,
  setData,
  dataRef,
  versionsRef,
  unlocked,
  needAuth,
  adminKey,
  flash,
  tileSize,
  setTileSize,
}) {
  const profile = data.styleProfile;
  const settings = data.settings;
  const wardrobe = data.wardrobe;
  const inspo = data.inspo || [];
  const looks = data.looks || [];
  const byId = Object.fromEntries(wardrobe.map((w) => [w.id, w]));

  // A saved look only carries its own photo when it was built around a
  // freshly-photographed "NEW" piece - otherwise borrow the first item's
  // wardrobe shot, so the tile always has something real to show.
  function lookPhotoId(look) {
    return (
      look?.anchorPhotoId ||
      (look?.item_ids || []).map((id) => byId[id]?.photoId).find(Boolean) ||
      null
    );
  }

  // Prefer items that actually have a photo - otherwise a random pick can
  // land on a bare "no photo" placeholder even when plenty of photographed
  // pieces exist, which defeats the point of a visual snapshot. Falls back
  // to the unfiltered list so a near-empty database still shows something.
  function withPhoto(list) {
    const has = list.filter((x) => x.photoId);
    return has.length ? has : list;
  }

  function pickRandom(list, seed) {
    return list.length ? list[Math.floor(seed * list.length)] : null;
  }

  // One random index per category, rolled once when the app loads and held
  // steady for the session - rerolling on every render would make the
  // photos jump around mid-glance, and always-latest went stale for weeks
  // at a time since these lists barely change day to day.
  const [snapshotSeed] = useState(() => ({
    worn: Math.random(),
    inspo: Math.random(),
    wardrobe: Math.random(),
    look: Math.random(),
  }));

  const looksWithPhoto = looks.filter((l) => lookPhotoId(l));
  const randomWorn = pickRandom(withPhoto(profile), snapshotSeed.worn);
  const randomInspo = pickRandom(withPhoto(inspo), snapshotSeed.inspo);
  const randomWardrobe = pickRandom(withPhoto(wardrobe), snapshotSeed.wardrobe);
  const randomLook = pickRandom(
    looksWithPhoto.length ? looksWithPhoto : looks,
    snapshotSeed.look
  );

  // Four-up snapshot, one random item per category - keeps the profile page
  // feeling current without competing with the style identity text.
  const snapshotTiles = [
    { key: "worn", label: "Worn", photoId: randomWorn?.photoId, empty: "Log a worn outfit and it lands here" },
    { key: "inspo", label: "Inspo", photoId: randomInspo?.photoId, empty: "Save some inspo and it lands here" },
    { key: "wardrobe", label: "Wardrobe", photoId: randomWardrobe?.photoId, empty: "Add a piece and it lands here" },
    { key: "look", label: "Saved look", photoId: lookPhotoId(randomLook), empty: "Save a look and it lands here" },
  ];

  // A photo that's been uploaded but not yet linked to wardrobe items - the
  // in-progress state between "+ Add worn outfit" and "Save outfit". Null
  // when there's nothing pending.
  const [pendingWorn, setPendingWorn] = useState(null);
  const [busy, setBusy] = useState(0);
  // Worn-outfits Filters panel - same season/formality/colour facets Saved
  // looks uses (see outfitFacets in shared.js), derived from each entry's
  // item_ids rather than stored directly, so relinking or re-tagging a
  // piece updates the filters automatically.
  const [showWornFilters, setShowWornFilters] = useState(false);
  const [wornSeas, setWornSeas] = useState(new Set());
  const [wornForm, setWornForm] = useState(new Set());
  const [wornCols, setWornCols] = useState(new Set());
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [idForm, setIdForm] = useState(null);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  // Tapping a vocabulary word reveals the owned pieces tagged with it - turns
  // the word list from a description into something you can actually see.
  const [vocabFocus, setVocabFocus] = useState(null);
  const signaturePieces = vocabFocus
    ? wardrobe
        .filter((w) => w.status === "owned" && (w.tags || []).includes(vocabFocus))
        .sort((a, b) => b.addedAt - a.addedAt)
    : [];

  // One-time backfill so worn-outfit photos added before duplicate
  // detection existed get a hash too, and show up in the panel below.
  const backfillRan = useRef(false);
  useEffect(() => {
    if (backfillRan.current) return;
    backfillRan.current = true;
    backfillHashes("styleProfile", profile, setData, adminKey, dataRef, versionsRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dupGroups = groupDuplicates(profile);

  const wornFacets = Object.fromEntries(
    profile.map((p) => [p.id, outfitFacets(p.item_ids, byId)])
  );
  function wornPasses(p, skip) {
    const f = wornFacets[p.id];
    if (skip !== "sea" && wornSeas.size && ![...wornSeas].some((v) => f.seasons.has(v)))
      return false;
    if (skip !== "form" && wornForm.size && ![...wornForm].some((v) => f.formality.has(v)))
      return false;
    if (skip !== "col" && wornCols.size && ![...wornCols].some((v) => f.colours.has(v)))
      return false;
    return true;
  }
  const wornCountsFor = (group, values, has, selected) => {
    const pool = profile.filter((p) => wornPasses(p, group));
    return values
      .map((v) => [v, v, pool.filter((p) => has(wornFacets[p.id], v)).length])
      .filter(([v, , count]) => count > 0 || selected.has(v));
  };
  const activeWornFilterCount = wornSeas.size + wornForm.size + wornCols.size;
  const filteredProfile = profile.filter((p) => wornPasses(p, null));

  function requireUnlock() {
    if (!unlocked) {
      needAuth();
      return false;
    }
    return true;
  }

  // Uploads the photo, then opens the linking step (pendingWorn) rather than
  // saving straight away - a worn outfit isn't complete until it points at
  // real wardrobe items, or nothing here is ever filterable by season,
  // occasion or colour.
  async function addPhoto(dataUrl) {
    if (!requireUnlock()) return;
    setBusy((b) => b + 1);
    try {
      // Hash before upload - an exact match against any worn-outfit photo
      // already saved means this is very likely the same export added twice.
      const hash = await hashDataUrl(dataUrl);
      const dupOf = profile.find((p) => p.hash === hash);
      const photoId = newId("pp");
      const up = await uploadImage(adminKey, photoId, dataUrl);
      if (!up.ok) {
        flash(up.error);
        return;
      }
      setPendingWorn({ photoId, hash, itemIds: [] });
      if (dupOf) flash("Heads up, this looks identical to one already saved");
    } finally {
      setBusy((b) => b - 1);
    }
  }

  // Files a name-only wardrobe stub for a piece that isn't catalogued yet -
  // no photo, since the only image available here is the whole outfit, not
  // this one piece. Full tagging (category, colours, an actual photo of the
  // item on its own) happens later from the Wardrobe tab, same deferred
  // spirit as a "wanted" item.
  async function createWornStub(name) {
    if (!name) return;
    const stub = {
      id: newId("w"),
      name,
      brand: "",
      photoId: null,
      hash: null,
      category: "Other",
      colours: [],
      season: "All seasons",
      formality: "Casual",
      tags: [],
      status: "owned",
      fitStatus: "current",
      needsStyling: false,
      heavyRotation: false,
      notes: "Added from a worn-outfit photo - needs full details.",
      excludeWith: [],
      layersOverDresses: false,
      addedAt: Date.now(),
    };
    const ok = await save("wardrobe", (cur) => [...cur, stub]);
    if (ok) {
      setPendingWorn((cur) => (cur ? { ...cur, itemIds: [...cur.itemIds, stub.id] } : cur));
    }
  }

  async function saveWorn() {
    if (!pendingWorn) return;
    const item = {
      id: newId("p"),
      photoId: pendingWorn.photoId,
      hash: pendingWorn.hash,
      item_ids: pendingWorn.itemIds,
      addedAt: Date.now(),
    };
    const ok = await save("styleProfile", (cur) => [...cur, item]);
    if (ok) {
      setPendingWorn(null);
      flash("Outfit saved");
    }
  }

  // Discards the photo already uploaded to blob storage along with it -
  // otherwise cancelling out of the linking step would leave an orphaned
  // image with nothing pointing at it.
  function cancelWorn() {
    if (pendingWorn?.photoId) deleteImage(adminKey, pendingWorn.photoId);
    setPendingWorn(null);
  }

  async function remove(item) {
    if (!requireUnlock()) return;
    if (!confirm("Remove this outfit photo?")) return;
    const ok = await save("styleProfile", (cur) =>
      cur.filter((p) => p.id !== item.id)
    );
    if (ok && item.photoId) deleteImage(adminKey, item.photoId);
  }

  // The disruptive reset Jess asked for rather than a retroactive re-tag
  // pass on photos that only ever carried the old Cold/Warm/Fancy tag - one
  // deliberate, confirmed action, not something that runs on its own.
  async function clearAllWorn() {
    if (!requireUnlock()) return;
    if (profile.length === 0) return;
    if (
      !confirm(
        `Delete all ${profile.length} worn-outfit photos? This can't be undone - make sure you've downloaded a backup first.`
      )
    ) {
      return;
    }
    const photoIds = profile.map((p) => p.photoId).filter(Boolean);
    const ok = await save("styleProfile", []);
    if (ok) {
      photoIds.forEach((id) => deleteImage(adminKey, id));
      flash("Cleared - add your first outfit under the new system");
    }
  }

  function startIdentityEdit() {
    if (!requireUnlock()) return;
    setIdForm({
      threeWords: settings.threeWords.map((t) => ({ ...t })),
      vocab: settings.vocab.join(", "),
      regulars: settings.regulars.join("\n"),
      homeCity: settings.home?.label || "",
    });
    setEditingIdentity(true);
  }

  async function saveIdentity(e) {
    e.preventDefault();
    setSavingIdentity(true);
    // Home city: resolved to coordinates here, once, so the Style me tab only
    // ever has to fetch the forecast. Unchanged text keeps the stored
    // coordinates; cleared text clears them; new text is geocoded, and if
    // nothing matches the rest of the form still saves and the city is left
    // as it was, with a flash saying so.
    let home = settings.home || null;
    const typed = (idForm.homeCity || "").trim();
    let cityNote = "";
    if (!typed) {
      home = null;
    } else if (typed !== (settings.home?.label || "")) {
      try {
        const found = await geocodeCity(typed);
        if (found) home = found;
        else cityNote = ` - couldn't find "${typed}", city left as it was`;
      } catch {
        cityNote = " - couldn't look the city up just now, left as it was";
      }
    }
    const next = {
      threeWords: idForm.threeWords
        .filter((t) => t.word.trim())
        .map((t) => ({ word: t.word.trim(), meaning: t.meaning.trim() })),
      vocab: idForm.vocab
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      regulars: idForm.regulars
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      home,
    };
    const ok = await save("settings", next);
    setSavingIdentity(false);
    if (ok) {
      setEditingIdentity(false);
      flash("Style identity saved" + cityNote);
    }
  }

  return (
    <div>
      <div className="section-h">Style identity</div>
      <div className="section-sub">
        Your fashion DNA - what the app checks every outfit against.
      </div>
      {!editingIdentity ? (
        <div className="profile-hero">
          <div className="profile-hero-text">
            <div className="three-words-mast">
              {settings.threeWords.map((t) => (
                <div key={t.word}>
                  <span className="word-mast-main">{t.word}</span>
                  <span className="word-mast-sub">{t.meaning}</span>
                </div>
              ))}
            </div>
            <div className="meta" style={{ marginTop: 10 }}>
              <b>Your wardrobe is:</b>
            </div>
            <div className="vocab-chips">
              <TagCloud
                options={settings.vocab}
                value={vocabFocus}
                onChange={setVocabFocus}
              />
            </div>
            <div className="meta" style={{ marginTop: 8 }}>
              <b>Regulars:</b>
              <ul className="regulars">
                {settings.regulars.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
            <div className="meta" style={{ marginTop: 8 }}>
              <b>Home city:</b>{" "}
              {settings.home?.label || (
                <span className="count">not set - add one and Style me shows today&rsquo;s weather</span>
              )}
            </div>
            <div className="card-actions">
              <button className="chip" onClick={startIdentityEdit}>
                Edit
              </button>
            </div>
          </div>

          <div className="profile-snapshot">
            {snapshotTiles.map((t) => (
              <div className="snapshot-tile" key={t.key}>
                {t.photoId ? (
                  <Thumb photoId={t.photoId} className="thumb" />
                ) : (
                  <div className="thumb snapshot-empty">{t.empty}</div>
                )}
                <div className="snapshot-label">{t.label}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!editingIdentity && vocabFocus && (
        <div className="signature-strip">
          <div className="signature-label">
            Pieces tagged &lsquo;{vocabFocus}&rsquo;
          </div>
          <div className="signature-row">
            {signaturePieces.length ? (
              signaturePieces.map((w) => (
                <Thumb
                  key={w.id}
                  photoId={w.photoId}
                  className="thumb sq"
                  alt={w.name}
                />
              ))
            ) : (
              <div className="signature-empty">
                Nothing in the wardrobe is tagged &lsquo;{vocabFocus}&rsquo; yet.
              </div>
            )}
          </div>
        </div>
      )}

      {editingIdentity && (
        <form className="form" onSubmit={saveIdentity}>
          <label>Three words</label>
          <div className="meta">
            e.g. &ldquo;Oversized&rdquo; - roomy, not fitted. The word&rsquo;s
            yours; the meaning is what it means when YOU dress, since the same
            word can mean something different to someone else.
          </div>
          {idForm.threeWords.map((t, i) => (
            <div className="cols three-word-row" key={i}>
              <input
                value={t.word}
                placeholder="Word"
                onChange={(e) => {
                  const tw = [...idForm.threeWords];
                  tw[i] = { ...tw[i], word: e.target.value };
                  setIdForm({ ...idForm, threeWords: tw });
                }}
              />
              <input
                value={t.meaning}
                placeholder="what it means"
                onChange={(e) => {
                  const tw = [...idForm.threeWords];
                  tw[i] = { ...tw[i], meaning: e.target.value };
                  setIdForm({ ...idForm, threeWords: tw });
                }}
              />
              <button
                type="button"
                className="chip"
                onClick={() =>
                  setIdForm({
                    ...idForm,
                    threeWords: idForm.threeWords.filter((_, wi) => wi !== i),
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
          {/* Only ever editing EXISTING rows above had no way to create the
              first one - fine when every database started pre-seeded with
              three, but a brand new database (a second person's own
              deployment) starts with none. Capped at three since that's the
              whole method. */}
          {idForm.threeWords.length < 3 && (
            <button
              type="button"
              className="chip"
              onClick={() =>
                setIdForm({
                  ...idForm,
                  threeWords: [...idForm.threeWords, { word: "", meaning: "" }],
                })
              }
            >
              + Add word
            </button>
          )}
          <div>
            <label>Extended vocabulary (comma-separated)</label>
            <input
              value={idForm.vocab}
              onChange={(e) => setIdForm({ ...idForm, vocab: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Confirmed regulars (one per line)</label>
            <div className="meta">
              Whole outfit formulas you already know work, not single pieces -
              the app reaches for these before reasoning from scratch, e.g.
              &ldquo;navy chinos, white oxford shirt, brown boots&rdquo;.
            </div>
            <textarea
              rows={6}
              placeholder={"e.g.\nnavy chinos, white oxford shirt, brown boots\nblack jeans, grey tee, white sneakers"}
              value={idForm.regulars}
              onChange={(e) => setIdForm({ ...idForm, regulars: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Home city</label>
            <div className="meta">
              For today&rsquo;s weather on the Style me tab - the season filter
              is set from it and the stylist dresses for the conditions. Leave
              blank to skip. Only the city&rsquo;s coordinates ever leave the
              browser (to Open-Meteo, a free forecast service).
            </div>
            <input
              placeholder="e.g. Melbourne"
              value={idForm.homeCity}
              onChange={(e) => setIdForm({ ...idForm, homeCity: e.target.value })}
            />
          </div>
          <div className="row" style={{ marginBottom: 0 }}>
            <button className="btn" type="submit" disabled={savingIdentity}>
              {savingIdentity ? "Saving…" : "Save"}
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => setEditingIdentity(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="worn-outfits-panel">
      <div className="section-h">
        Worn outfits (
        {activeWornFilterCount ? `${filteredProfile.length} of ${profile.length}` : profile.length}
        )
      </div>
      <div className="section-sub">
        Photos of looks that worked, linked to the real pieces you wore.
        &ldquo;Just me&rdquo; suggestions use these as grounding.
      </div>
      <div className="toolbar">
        <PhotoButton
          className="btn"
          label={busy ? `Adding… (${busy})` : "+ Add worn outfit"}
          onPhoto={addPhoto}
          onError={flash}
        />
        <button
          type="button"
          className={`btn ghost ${activeWornFilterCount ? "has-filters" : ""}`}
          onClick={() => setShowWornFilters(!showWornFilters)}
        >
          Filters{activeWornFilterCount ? ` (${activeWornFilterCount})` : ""}
        </button>
        {activeWornFilterCount > 0 && (
          <button
            type="button"
            className="chip"
            onClick={() => {
              setWornSeas(new Set());
              setWornForm(new Set());
              setWornCols(new Set());
            }}
          >
            Clear filters
          </button>
        )}
        <DupesToggle
          count={dupGroups.length}
          open={showDuplicates}
          onToggle={() => setShowDuplicates(!showDuplicates)}
        />
        <TileToggle size={tileSize} onChange={setTileSize} />
        {profile.length > 0 && (
          <button type="button" className="btn ghost" onClick={clearAllWorn}>
            Clear all &amp; start fresh
          </button>
        )}
      </div>

      {showWornFilters && (
        <div className="filter-panel">
          <FilterGroup
            title="Season"
            options={wornCountsFor("sea", SEASONS, (f, v) => f.seasons.has(v), wornSeas)}
            selected={wornSeas}
            onToggle={(v) => toggleIn(wornSeas, v, setWornSeas)}
          />
          <FilterGroup
            title="Formality"
            options={wornCountsFor("form", FORMALITY, (f, v) => f.formality.has(v), wornForm)}
            selected={wornForm}
            onToggle={(v) => toggleIn(wornForm, v, setWornForm)}
          />
          <FilterGroup
            title="Colour"
            options={wornCountsFor("col", COLOURS, (f, v) => f.colours.has(v), wornCols)}
            selected={wornCols}
            onToggle={(v) => toggleIn(wornCols, v, setWornCols)}
            swatches={COLOUR_TEXT_HEX}
          />
        </div>
      )}

      {pendingWorn && (
        <div className="flow-config">
          <div className="src-preview">
            <Thumb photoId={pendingWorn.photoId} className="src-thumb" />
          </div>
          <div className="section-sub">Which of these do you own?</div>
          <ItemPicker
            items={wardrobe.filter((w) => w.status === "owned")}
            selectedIds={pendingWorn.itemIds}
            onChange={(ids) => setPendingWorn({ ...pendingWorn, itemIds: ids })}
            onCreateStub={createWornStub}
          />
          <div className="row" style={{ marginBottom: 0 }}>
            <button type="button" className="btn" onClick={saveWorn}>
              Save outfit
            </button>
            <button type="button" className="btn ghost" onClick={cancelWorn}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {showDuplicates && (
        <DuplicatesPanel
          groups={dupGroups}
          renderLabel={(p) => (
            <>
              {sortItemIdsByCategory(p.item_ids || [], byId)
                .map((id) => byId[id]?.name)
                .filter(Boolean)
                .join(" + ") || "Worn outfit"}
              <span className="dup-sub">
                {new Date(p.addedAt).toLocaleDateString("en-AU", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </>
          )}
          onRemove={remove}
        />
      )}
      {profile.length > 0 && filteredProfile.length === 0 ? (
        <div className="empty">No worn outfits match these filters.</div>
      ) : (
        <div className={`grid ${tileSize === "compact" ? "compact" : ""}`}>
          {filteredProfile
            .sort((a, b) => b.addedAt - a.addedAt)
            .map((p) => (
              <div key={p.id} className="card item-card">
                <Thumb photoId={p.photoId} className="thumb tall" />
                <div className="card-body">
                  {(p.item_ids || []).length > 0 && (
                    <div className="oi-name">
                      {sortItemIdsByCategory(p.item_ids, byId)
                        .map((id) => byId[id]?.name)
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
                  <div className="card-actions">
                    <button className="chip" onClick={() => remove(p)}>
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}
      {profile.length === 0 && (
        <div className="empty">Log a worn outfit and it lands here.</div>
      )}
      </div>
    </div>
  );
}
