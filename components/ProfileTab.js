"use client";

import { useState, useEffect, useRef } from "react";
import { PROFILE_CONTEXTS } from "../lib/style-identity";
import {
  newId,
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
} from "./shared";

// Style profile: worn-outfit photos exported by hand from Stylebook's
// "Cold Weather" / "Warm Weather" / "Fancy" folders, same three groupings -
// plus the editable style identity (three words, vocabulary, regulars).

export default function ProfileTab({
  data,
  save,
  setData,
  dataRef,
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

  const latestWorn = profile.length
    ? [...profile].sort((a, b) => b.addedAt - a.addedAt)[0]
    : null;
  const latestInspo = inspo.length
    ? [...inspo].sort((a, b) => b.addedAt - a.addedAt)[0]
    : null;
  const latestWardrobe = wardrobe.length
    ? [...wardrobe].sort((a, b) => b.addedAt - a.addedAt)[0]
    : null;
  const latestLook = looks.length
    ? [...looks].sort((a, b) => b.savedAt - a.savedAt)[0]
    : null;
  // A saved look only carries its own photo when it was built around a
  // freshly-photographed "NEW" piece - otherwise borrow the first item's
  // wardrobe shot, so the tile always has something real to show.
  const latestLookPhotoId =
    latestLook?.anchorPhotoId ||
    (latestLook?.item_ids || []).map((id) => byId[id]?.photoId).find(Boolean) ||
    null;

  // Four-up snapshot of what's freshest across the app - keeps the profile
  // page feeling current without competing with the style identity text.
  const snapshotTiles = [
    { key: "worn", label: "Worn", photoId: latestWorn?.photoId, empty: "Log a worn outfit and it lands here" },
    { key: "inspo", label: "Inspo", photoId: latestInspo?.photoId, empty: "Save some inspo and it lands here" },
    { key: "wardrobe", label: "Wardrobe", photoId: latestWardrobe?.photoId, empty: "Add a piece and it lands here" },
    { key: "look", label: "Saved look", photoId: latestLookPhotoId, empty: "Save a look and it lands here" },
  ];

  const [context, setContext] = useState("cold");
  const [busy, setBusy] = useState(0);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [idForm, setIdForm] = useState(null);
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
    backfillHashes("styleProfile", profile, setData, adminKey, dataRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dupGroups = groupDuplicates(profile);

  function requireUnlock() {
    if (!unlocked) {
      needAuth();
      return false;
    }
    return true;
  }

  async function addPhoto(dataUrl) {
    if (!requireUnlock()) return;
    setBusy((b) => b + 1);
    try {
      // Hash before upload - an exact match against any worn-outfit photo
      // already saved (in any folder) means this is very likely the same
      // export added twice.
      const hash = await hashDataUrl(dataUrl);
      const dupOf = profile.find((p) => p.hash === hash);
      const photoId = newId("pp");
      const up = await uploadImage(adminKey, photoId, dataUrl);
      if (!up.ok) {
        flash(up.error);
        return;
      }
      const item = { id: newId("p"), photoId, hash, context, addedAt: Date.now() };
      const ok = await save("styleProfile", (cur) => [...cur, item]);
      if (!ok) {
        deleteImage(adminKey, photoId);
        return;
      }
      if (dupOf) flash("Saved - heads up, this looks identical to one already saved");
    } finally {
      setBusy((b) => b - 1);
    }
  }

  async function remove(item) {
    if (!requireUnlock()) return;
    if (!confirm("Remove this outfit photo?")) return;
    const ok = await save("styleProfile", (cur) =>
      cur.filter((p) => p.id !== item.id)
    );
    if (ok && item.photoId) deleteImage(adminKey, item.photoId);
  }

  function startIdentityEdit() {
    if (!requireUnlock()) return;
    setIdForm({
      threeWords: settings.threeWords.map((t) => ({ ...t })),
      vocab: settings.vocab.join(", "),
      regulars: settings.regulars.join("\n"),
    });
    setEditingIdentity(true);
  }

  async function saveIdentity(e) {
    e.preventDefault();
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
    };
    const ok = await save("settings", next);
    if (ok) {
      setEditingIdentity(false);
      flash("Style identity saved");
    }
  }

  return (
    <div>
      <div className="section-h">Style identity</div>
      <div className="section-sub">
        From the Allison Bornstein session - what the engine checks every outfit
        against.
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
              <b>Vocabulary:</b>
            </div>
            <div className="chip-pick vocab-chips">
              {settings.vocab.map((v) => (
                <button
                  key={v}
                  className={`chip ${vocabFocus === v ? "sel" : ""}`}
                  onClick={() => setVocabFocus(vocabFocus === v ? null : v)}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="meta" style={{ marginTop: 8 }}>
              <b>Regulars:</b>
              <ul className="regulars">
                {settings.regulars.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
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
          <div>
            <label>Confirmed regulars (one per line)</label>
            <textarea
              rows={6}
              value={idForm.regulars}
              onChange={(e) => setIdForm({ ...idForm, regulars: e.target.value })}
            />
          </div>
          <div className="row" style={{ marginBottom: 0 }}>
            <button className="btn" type="submit">
              Save
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

      <div className="section-h">Worn outfits</div>
      <div className="section-sub">
        Photos of looks that worked, exported by hand from Stylebook&rsquo;s Cold
        Weather / Warm Weather / Fancy folders. &ldquo;Just me&rdquo; suggestions
        use these as grounding.
      </div>
      <div className="toolbar">
        <div className="chip-pick">
          {PROFILE_CONTEXTS.map(([v, label]) => (
            <button
              key={v}
              className={`chip ${context === v ? "sel" : ""}`}
              onClick={() => setContext(v)}
            >
              {label} (
              {profile.filter((p) => p.context === v).length})
            </button>
          ))}
        </div>
        <PhotoButton
          className="btn"
          label={busy ? `Adding… (${busy})` : `+ Add to ${PROFILE_CONTEXTS.find(([v]) => v === context)[1]}`}
          onPhoto={addPhoto}
          onError={flash}
          multiple
        />
        <DupesToggle
          count={dupGroups.length}
          open={showDuplicates}
          onToggle={() => setShowDuplicates(!showDuplicates)}
        />
        <TileToggle size={tileSize} onChange={setTileSize} />
      </div>

      {showDuplicates && (
        <DuplicatesPanel
          groups={dupGroups}
          renderLabel={(p) => (
            <>
              {PROFILE_CONTEXTS.find(([v]) => v === p.context)?.[1] || p.context}
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
      <div className={`grid ${tileSize === "compact" ? "compact" : ""}`}>
        {profile
          .filter((p) => p.context === context)
          .sort((a, b) => b.addedAt - a.addedAt)
          .map((p) => (
            <div key={p.id} className="card item-card">
              <Thumb photoId={p.photoId} className="thumb tall" />
              <div className="card-body">
                <div className="card-actions">
                  <button className="chip" onClick={() => remove(p)}>
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
      </div>
      {profile.filter((p) => p.context === context).length === 0 && (
        <div className="empty">Nothing in this folder yet.</div>
      )}
    </div>
  );
}
