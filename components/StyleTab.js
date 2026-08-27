"use client";

import { useEffect, useRef, useState } from "react";
import { SEASONS, OCCASIONS, COLOURS, CATEGORIES } from "../lib/style-identity";
import { newId, norm, PhotoButton, Thumb, uploadImage, deleteImage } from "./shared";

// The three AI entry flows of the suggestion engine, plus one manual one:
//   A - match an inspo image (from the library, or a fresh upload)
//   B - filters only ("what should I wear" with no source image)
//   C - style an anchor piece (an owned or wanted item, or a just-bought photo)
//   M - build my own: pick pieces by hand, no AI call at all

export default function StyleTab({
  data,
  save,
  unlocked,
  needAuth,
  adminKey,
  flash,
  request,
  clearRequest,
}) {
  const [flow, setFlow] = useState("B");
  const [inspoId, setInspoId] = useState("");
  const [anchorId, setAnchorId] = useState("");
  const [image, setImage] = useState(null); // fresh upload for A or C
  const [filters, setFilters] = useState({
    season: "",
    occasion: "",
    colour: "",
    justMe: false,
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // Indices dismissed via "Not my thing" - hidden from view immediately,
  // reset whenever a fresh set of suggestions comes back.
  const [dismissed, setDismissed] = useState(new Set());
  const ranRequest = useRef(null);
  // Accumulates feedback entries recorded this session, seeded from the
  // loaded data. Not React state - nothing reads it back for display - but
  // it needs to be readable and updatable synchronously, immediately, so
  // two feedback clicks close together each see the other's entry rather
  // than racing to overwrite one another.
  const feedbackRef = useRef(data.feedback || []);

  // Manual builder (flow M): no AI, just a picker.
  const [manualIds, setManualIds] = useState([]);
  const [manualTitle, setManualTitle] = useState("");
  const [manualSearch, setManualSearch] = useState("");
  const [manualCat, setManualCat] = useState("");
  const [manualSaving, setManualSaving] = useState(false);

  const wardrobe = data.wardrobe;
  const byId = Object.fromEntries(wardrobe.map((w) => [w.id, w]));
  const owned = wardrobe.filter((w) => w.status === "owned");
  const anchorable = owned.filter((w) => w.fitStatus !== "not_current");
  const matchableInspo = data.inspo.filter((i) => i.type !== "product");

  async function run(overrides = {}) {
    if (!unlocked) {
      needAuth();
      return;
    }
    const f = overrides.flow || flow;
    const body = {
      flow: f,
      filters: overrides.filters || filters,
      inspoId: f === "A" ? overrides.inspoId ?? inspoId : undefined,
      anchorId: f === "C" ? overrides.anchorId ?? anchorId : undefined,
      image: overrides.image !== undefined ? overrides.image : image,
    };
    if (f === "A" && !body.inspoId && !body.image) {
      flash("Pick an inspo image or upload one first");
      return;
    }
    if (f === "C" && !body.anchorId && !body.image) {
      flash("Pick a piece to style or upload a photo of it");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setDismissed(new Set());
    try {
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey || "",
        },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) setError(j.error || "Something went wrong");
      else setResult({ ...j, flow: f, image: body.image });
    } catch {
      setError("Something went wrong - try again");
    }
    setBusy(false);
  }

  // Requests arriving from other tabs ("Style this", "I bought it",
  // "Match my wardrobe to this") auto-run the right flow.
  useEffect(() => {
    if (!request || ranRequest.current === request) return;
    ranRequest.current = request;
    if (request.anchorId) {
      setFlow("C");
      setAnchorId(request.anchorId);
      setImage(null);
      run({ flow: "C", anchorId: request.anchorId, image: null });
    } else if (request.inspoId) {
      setFlow("A");
      setInspoId(request.inspoId);
      setImage(null);
      run({ flow: "A", inspoId: request.inspoId, image: null });
    }
    clearRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // Keep a suggestion around: item ids + the stylist's reasoning. If the
  // outfit was built on an uncatalogued "NEW" anchor, its photo is copied
  // into the image store so the look still renders later.
  async function saveLook(o) {
    if (!unlocked) {
      needAuth();
      return;
    }
    let anchorPhotoId;
    if (o.item_ids.includes("NEW") && result?.image) {
      anchorPhotoId = newId("lp");
      const up = await uploadImage(adminKey, anchorPhotoId, result.image);
      if (!up.ok) {
        flash(up.error);
        return;
      }
    }
    const look = {
      id: newId("l"),
      title: o.title,
      item_ids: o.item_ids,
      formula: o.formula,
      why: o.why,
      styling_notes: o.styling_notes,
      gaps: o.gaps || [],
      anchorPhotoId,
      savedAt: Date.now(),
    };
    const ok = await save("looks", (cur) => [...(cur || []), look]);
    if (ok) flash(`"${o.title}" saved to your looks`);
    else if (anchorPhotoId) deleteImage(adminKey, anchorPhotoId);
  }

  // Feedback on a fresh suggestion. Stored per-outfit but mined pair-by-pair
  // by the suggestion engine (see deriveFeedbackPairs in app/api/suggest) -
  // an exact combo rarely repeats verbatim, but a pairing of two pieces
  // does, so that's the signal that actually steers future suggestions.
  // Posted directly rather than through the shared save() helper: this can
  // fire right alongside another state update (dismissing the card), and
  // save() computes its payload inside a setState updater that isn't
  // guaranteed to run before it's read back in that situation. Nothing
  // reads data.feedback back in the UI, so a plain best-effort POST -
  // computed from the current props, not from save()'s deferred read -
  // sidesteps that rather than risk it losing an entry.
  async function recordFeedback(o, verdict) {
    const entry = {
      id: newId("fb"),
      verdict,
      itemIds: o.item_ids.filter((id) => id !== "NEW"),
      flow: result?.flow,
      createdAt: Date.now(),
    };
    const next = [...feedbackRef.current, entry];
    feedbackRef.current = next;
    try {
      await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey || "" },
        body: JSON.stringify({ type: "feedback", data: next }),
      });
    } catch (e) {
      console.error("feedback save failed", e);
    }
  }

  function notMyThing(o, idx) {
    setDismissed((cur) => new Set(cur).add(idx));
    recordFeedback(o, "not_for_me");
    flash("Noted - I'll steer away from that pairing");
  }

  function loveThis(o) {
    recordFeedback(o, "loved");
    flash("Noted - more like this");
  }

  function toggleManual(id) {
    setManualIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    );
  }

  async function saveManualLook() {
    if (!unlocked) {
      needAuth();
      return;
    }
    if (manualIds.length < 1) {
      flash("Pick at least one piece first");
      return;
    }
    setManualSaving(true);
    const look = {
      id: newId("l"),
      title: manualTitle.trim() || "Untitled look",
      item_ids: manualIds,
      source: "manual",
      savedAt: Date.now(),
    };
    const ok = await save("looks", (cur) => [...(cur || []), look]);
    setManualSaving(false);
    if (ok) {
      flash(`"${look.title}" saved to your looks`);
      setManualIds([]);
      setManualTitle("");
    }
  }

  async function removeLook(look) {
    if (!unlocked) {
      needAuth();
      return;
    }
    if (!confirm(`Remove "${look.title}" from saved looks?`)) return;
    const ok = await save("looks", (cur) =>
      (cur || []).filter((l) => l.id !== look.id)
    );
    if (ok && look.anchorPhotoId) deleteImage(adminKey, look.anchorPhotoId);
  }

  const looks = data.looks || [];

  const flowBtn = (id, label, sub) => (
    <button
      className={`flow-btn ${flow === id ? "on" : ""}`}
      onClick={() => {
        setFlow(id);
        setResult(null);
        setError(null);
        setImage(null);
      }}
    >
      <span className="flow-label">{label}</span>
      <span className="flow-sub">{sub}</span>
    </button>
  );

  return (
    <div>
      {!data.ai && (
        <div className="notice">
          AI suggestions are off - <code>ANTHROPIC_API_KEY</code> isn&rsquo;t set on
          the server yet.
        </div>
      )}
      <div className="flow-row">
        {flowBtn("B", "Suggest outfits", "from filters, or nothing at all")}
        {flowBtn("A", "Match an inspo image", "rebuild a saved look from my wardrobe")}
        {flowBtn("C", "Style a piece", "a new buy, or something I never wear")}
        {flowBtn("M", "Build my own", "pick pieces by hand, no AI")}
      </div>

      {flow === "A" && (
        <div className="flow-config">
          <div className="row">
            <select value={inspoId} onChange={(e) => { setInspoId(e.target.value); setImage(null); }}>
              <option value="">Pick from the inspo library…</option>
              {matchableInspo.map((i) => (
                <option key={i.id} value={i.id}>
                  {[i.notes || "Inspo", i.occasion, i.season].filter(Boolean).join(" · ").slice(0, 70)}
                </option>
              ))}
            </select>
            <span className="count" style={{ margin: 0 }}>or</span>
            <PhotoButton
              className="btn ghost"
              label={image ? "Photo ready ✓" : "Upload one"}
              onPhoto={(d) => {
                setImage(d);
                setInspoId("");
              }}
              onError={flash}
            />
          </div>
          {(inspoId || image) && (
            <div className="src-preview">
              <Thumb
                dataUrl={image}
                photoId={inspoId ? data.inspo.find((i) => i.id === inspoId)?.photoId : null}
                className="src-thumb"
              />
            </div>
          )}
        </div>
      )}

      {flow === "C" && (
        <div className="flow-config">
          <div className="row">
            <select value={anchorId} onChange={(e) => { setAnchorId(e.target.value); setImage(null); }}>
              <option value="">Pick a piece I own…</option>
              {anchorable.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.needsStyling ? " · needs styling" : ""}
                </option>
              ))}
            </select>
            <span className="count" style={{ margin: 0 }}>or</span>
            <PhotoButton
              className="btn ghost"
              label={image ? "Photo ready ✓" : "Upload a new buy"}
              onPhoto={(d) => {
                setImage(d);
                setAnchorId("");
              }}
              onError={flash}
            />
          </div>
          {(anchorId || image) && (
            <div className="src-preview">
              <Thumb
                dataUrl={image}
                photoId={anchorId ? byId[anchorId]?.photoId : null}
                className="src-thumb"
              />
            </div>
          )}
        </div>
      )}

      {flow === "M" && (
        <ManualBuilder
          owned={anchorable}
          byId={byId}
          selected={manualIds}
          onToggle={toggleManual}
          title={manualTitle}
          onTitle={setManualTitle}
          search={manualSearch}
          onSearch={setManualSearch}
          cat={manualCat}
          onCat={setManualCat}
          onSave={saveManualLook}
          saving={manualSaving}
        />
      )}

      {flow !== "M" && (
      <div className="flow-config">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <select
            value={filters.season}
            onChange={(e) => setFilters({ ...filters, season: e.target.value })}
          >
            <option value="">Any season</option>
            {SEASONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            value={filters.occasion}
            disabled={filters.justMe}
            onChange={(e) => setFilters({ ...filters, occasion: e.target.value })}
          >
            <option value="">Any occasion</option>
            {OCCASIONS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          <select
            value={filters.colour}
            onChange={(e) => setFilters({ ...filters, colour: e.target.value })}
          >
            <option value="">Any colour</option>
            {COLOURS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button
            className={`chip ${filters.justMe ? "sel" : ""}`}
            onClick={() =>
              setFilters({ ...filters, justMe: !filters.justMe, occasion: "" })
            }
            title="No occasion - dressing purely for myself"
          >
            ✦ Just me
          </button>
          <button className="btn" onClick={() => run()} disabled={busy || !data.ai}>
            {busy ? "Styling…" : "Style me"}
          </button>
        </div>
      </div>
      )}

      {busy && (
        <div className="empty">Going through the wardrobe like an actual stylist would…</div>
      )}
      {error && <div className="notice err-notice">{error}</div>}

      {result && (
        <div className="results">
          {result.overall_note && <div className="stylist-note">{result.overall_note}</div>}
          {result.outfits.map((o, idx) =>
            dismissed.has(idx) ? null : (
              <OutfitCard
                key={idx}
                o={o}
                byId={byId}
                newThumb={{ dataUrl: result.image }}
                actions={
                  <>
                    <button className="chip" onClick={() => saveLook(o)}>
                      Save this look
                    </button>
                    <button className="chip" onClick={() => loveThis(o)}>
                      Love this
                    </button>
                    <button className="chip" onClick={() => notMyThing(o, idx)}>
                      Not my thing
                    </button>
                  </>
                }
              />
            )
          )}
          {dismissed.size > 0 && dismissed.size === result.outfits.length && (
            <div className="empty">
              That was everything from this round - try &ldquo;Style me&rdquo; again for a fresh set.
            </div>
          )}
        </div>
      )}

      {flow !== "M" && !result && !busy && !error && owned.length < 2 && (
        <div className="empty">
          Add a few wardrobe pieces first - the engine only dresses you in
          things you actually own.
        </div>
      )}

      {looks.length > 0 && (
        <>
          <div className="section-h">Saved looks ({looks.length})</div>
          <div className="section-sub">
            Suggestions you&rsquo;ve kept - outfits reference the wardrobe, so
            photos stay current.
          </div>
          <div className="results">
            {[...looks]
              .sort((a, b) => b.savedAt - a.savedAt)
              .map((l) => (
                <OutfitCard
                  key={l.id}
                  o={l}
                  byId={byId}
                  newThumb={{ photoId: l.anchorPhotoId }}
                  actions={
                    <button className="chip" onClick={() => removeLook(l)}>
                      Remove
                    </button>
                  }
                />
              ))}
          </div>
        </>
      )}
    </div>
  );
}

// One outfit, as a card - used for fresh suggestions and saved looks alike.
// `newThumb` is the image for an uncatalogued "NEW" anchor piece.
function OutfitCard({ o, byId, newThumb, actions }) {
  return (
    <div className="card outfit-card">
      <div className="outfit-head">
        <h3>{o.title}</h3>
        {o.formula && <span className="badge formula">{o.formula}</span>}
      </div>
      <div className="outfit-items">
        {o.item_ids.map((id) =>
          id === "NEW" ? (
            <div key={id} className="outfit-item">
              <Thumb
                dataUrl={newThumb?.dataUrl}
                photoId={newThumb?.photoId}
                className="thumb sq"
              />
              <div className="oi-name">The new piece</div>
            </div>
          ) : (
            <div key={id} className="outfit-item">
              <Thumb photoId={byId[id]?.photoId} className="thumb sq" />
              <div className="oi-name">{byId[id]?.name || "No longer in wardrobe"}</div>
            </div>
          )
        )}
      </div>
      {o.why && <p className="outfit-why">{o.why}</p>}
      {o.styling_notes && <p className="outfit-notes">↳ {o.styling_notes}</p>}
      {o.gaps?.length > 0 && (
        <div className="gaps">
          {o.gaps.map((g, gi) => (
            <div key={gi} className="gap">
              Missing: {g.need}
              {g.wanted_id && byId[g.wanted_id] && (
                <span className="gap-wanted">
                  {" "}
                  - you&rsquo;ve already got your eye on{" "}
                  <b>{byId[g.wanted_id].name}</b>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {actions && <div className="card-actions">{actions}</div>}
    </div>
  );
}

// Manual look builder (flow M): tap pieces to add/remove, no AI involved.
// Order of selection is the order of the outfit - tap a picked piece again
// (in the grid or the build strip) to drop it.
function ManualBuilder({
  owned,
  byId,
  selected,
  onToggle,
  title,
  onTitle,
  search,
  onSearch,
  cat,
  onCat,
  onSave,
  saving,
}) {
  const q = norm(search);
  const picked = new Set(selected);
  const shown = owned.filter(
    (w) =>
      (!cat || w.category === cat) &&
      (!q || norm(w.name).includes(q) || norm(w.brand).includes(q))
  );

  return (
    <div>
      {selected.length > 0 && (
        <div className="flow-config">
          <div className="section-sub" style={{ marginTop: 0 }}>
            Building ({selected.length} piece{selected.length === 1 ? "" : "s"}) -
            tap a piece again to drop it
          </div>
          <div className="outfit-items">
            {selected.map((id) => (
              <div
                key={id}
                className="outfit-item"
                onClick={() => onToggle(id)}
                style={{ cursor: "pointer" }}
                title="Remove from this look"
              >
                <Thumb photoId={byId[id]?.photoId} className="thumb sq" />
                <div className="oi-name">
                  {byId[id]?.name || "No longer in wardrobe"}
                </div>
              </div>
            ))}
          </div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <input
              placeholder="Name this look (optional)"
              value={title}
              onChange={(e) => onTitle(e.target.value)}
              style={{ maxWidth: 280 }}
            />
            <button className="btn" onClick={onSave} disabled={saving}>
              {saving ? "Saving…" : "Save this look"}
            </button>
          </div>
        </div>
      )}

      <div className="flow-config">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <input
            placeholder="Search wardrobe…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          <select value={cat} onChange={(e) => onCat(e.target.value)}>
            <option value="">Any category</option>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {owned.length === 0 ? (
        <div className="empty">
          No currently-wearable owned pieces yet - add some in the Wardrobe
          tab first.
        </div>
      ) : (
        <div className="grid">
          {shown.map((w) => (
            <div
              key={w.id}
              className={`card item-card clickable ${picked.has(w.id) ? "picked" : ""}`}
              onClick={() => onToggle(w.id)}
            >
              <Thumb photoId={w.photoId} alt={w.name} />
              <div className="card-body">
                <h3>{w.name}</h3>
                <div className="meta">
                  {[w.brand, w.category].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {shown.length === 0 && owned.length > 0 && (
        <div className="empty">Nothing matches.</div>
      )}
    </div>
  );
}
