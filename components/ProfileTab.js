"use client";

import { useState } from "react";
import { PROFILE_CONTEXTS } from "../lib/style-identity";
import { newId, PhotoButton, Thumb, uploadImage, deleteImage } from "./shared";

// Style profile: worn-outfit photos exported by hand from Stylebook's
// "Cold Weather" / "Warm Weather" / "Fancy" folders, same three groupings -
// plus the editable style identity (three words, vocabulary, regulars).

export default function ProfileTab({
  data,
  save,
  unlocked,
  needAuth,
  adminKey,
  flash,
}) {
  const profile = data.styleProfile;
  const settings = data.settings;
  const [context, setContext] = useState("cold");
  const [busy, setBusy] = useState(0);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [idForm, setIdForm] = useState(null);

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
      const photoId = newId("pp");
      const up = await uploadImage(adminKey, photoId, dataUrl);
      if (!up.ok) {
        flash(up.error);
        return;
      }
      const item = { id: newId("p"), photoId, context, addedAt: Date.now() };
      const ok = await save("styleProfile", (cur) => [...cur, item]);
      if (!ok) deleteImage(adminKey, photoId);
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
        <div className="card identity-card">
          <div className="three-words">
            {settings.threeWords.map((t) => (
              <div key={t.word} className="word">
                <span className="word-main">{t.word}</span>
                <span className="word-sub">{t.meaning}</span>
              </div>
            ))}
          </div>
          <div className="meta" style={{ marginTop: 10 }}>
            <b>Vocabulary:</b> {settings.vocab.join(", ")}
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
      ) : (
        <form className="form" onSubmit={saveIdentity}>
          <label>Three words</label>
          {idForm.threeWords.map((t, i) => (
            <div className="cols two" key={i}>
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
            </div>
          ))}
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
              className={`chip ${context === v ? "on" : ""}`}
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
      </div>
      <div className="grid">
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
