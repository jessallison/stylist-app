"use client";

import { useEffect, useRef, useState } from "react";
import { SEASONS, OCCASIONS, COLOURS, CATEGORIES } from "../lib/style-identity";
import { newId, norm, PhotoButton, Thumb, uploadImage, deleteImage } from "./shared";
import { fetchToday, seasonFromWeather, summarise } from "../lib/weather";

// The three AI entry flows of the suggestion engine, plus one manual one:
//   A - match an inspo image (from the library, or a fresh upload)
//   B - filters only ("what should I wear" with no source image)
//   C - style an anchor piece (an owned or wanted item, or a just-bought photo)
//   M - build my own: pick pieces by hand, no AI call at all

// Shown while a suggestion run is in flight. Starts on a random one so
// repeat runs don't always open the same way, then advances every few
// seconds - a message that changes is what stops a ten-second AI wait from
// reading as frozen (see StylingLoader).
const STYLING_MESSAGES = [
  "Building the outfit from the inside out",
  "Checking what goes with what",
  "Making the case for each piece",
  "Weighing colour against colour",
  "Ruling things in, ruling things out",
  "Testing combinations that shouldn't work but do",
];

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
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // Indices dismissed via "Not my thing" - hidden from view immediately,
  // reset whenever a fresh set of suggestions comes back.
  const [dismissed, setDismissed] = useState(new Set());
  const ranRequest = useRef(null);
  // Scroll target for the loading/results block below - see the comment in
  // run() for why this replaced scrolling to the page's absolute top.
  const resultsAnchorRef = useRef(null);
  // Scroll target for a piece arriving from another tab ("Style this"): the
  // loaded piece, the filters and the Style me button, so on a phone you
  // land looking at exactly what to press next.
  const configAnchorRef = useRef(null);

  // Today's weather for the home city (Profile tab). Fetched once per visit
  // to this tab, straight from the browser to Open-Meteo. Absent home city,
  // absent network, or a failed call all resolve to "no line shown" - the
  // filters work exactly as before, nothing depends on this succeeding.
  const home = data.settings?.home || null;
  const [weather, setWeather] = useState(null);
  const [weatherFailed, setWeatherFailed] = useState(false);
  // Whether the season filter's current value came from the weather rather
  // than the person - drives the "set from today" note, and stops a later
  // weather load from overriding a season they've since chosen by hand.
  const [seasonFromToday, setSeasonFromToday] = useState(false);
  const seasonTouched = useRef(false);
  useEffect(() => {
    if (!home?.lat) {
      setWeather(null);
      return;
    }
    let cancelled = false;
    setWeatherFailed(false);
    fetchToday(home)
      .then((w) => {
        if (cancelled) return;
        setWeather(w);
        const s = seasonFromWeather(w);
        if (s && !seasonTouched.current) {
          setFilters((f) => (f.season ? f : { ...f, season: s }));
          setSeasonFromToday(true);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setWeather(null);
        setWeatherFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home?.lat, home?.lon]);

  // Cycle the loading message while a run is in flight.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(
      () => setLoadingMsgIdx((i) => (i + 1) % STYLING_MESSAGES.length),
      2800
    );
    return () => clearInterval(t);
  }, [busy]);
  // Accumulates feedback entries recorded this session, seeded from the
  // loaded data. Not React state - nothing reads it back for display - but
  // it needs to be readable and updatable synchronously, immediately, so
  // two feedback clicks close together each see the other's entry rather
  // than racing to overwrite one another.
  const feedbackRef = useRef(data.feedback || []);

  // Saved looks display in a random order rather than newest-first, so the
  // section feels fresh on repeat visits instead of always leading with the
  // same handful. Each look's position is rolled once, the first time it's
  // seen, and cached here - re-sorting on every render would make cards
  // swap places while you're mid-scroll.
  const lookOrderRef = useRef(new Map());
  function shuffleKey(id) {
    if (!lookOrderRef.current.has(id)) {
      lookOrderRef.current.set(id, Math.random());
    }
    return lookOrderRef.current.get(id);
  }

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
  // Dropdown-only sorts (A-Z by what's actually shown in the option) - the
  // underlying anchorable/matchableInspo arrays stay in their original order
  // for everything else that reads them (e.g. the manual builder's grid).
  const anchorableAZ = [...anchorable].sort((a, b) => a.name.localeCompare(b.name));
  const inspoLabel = (i) => [i.notes || "Inspo", i.occasion, i.season].filter(Boolean).join(" · ");
  const matchableInspoAZ = [...matchableInspo].sort((a, b) =>
    inspoLabel(a).localeCompare(inspoLabel(b))
  );

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
      // Today's conditions, when known - the stylist is told them so it can
      // reason about rain and in-between days, not just the season bucket.
      weather:
        weather && home
          ? {
              city: home.city,
              tempC: weather.tempC,
              feelsC: weather.feelsC,
              highC: weather.highC,
              lowC: weather.lowC,
              rainProb: weather.rainProb,
              description: weather.description,
              wet: weather.wet,
            }
          : undefined,
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
    setLoadingMsgIdx(Math.floor(Math.random() * STYLING_MESSAGES.length));
    setError(null);
    setResult(null);
    setDismissed(new Set());
    // Scroll to the loading state (and the result once it lands), not the
    // page's absolute top - on mobile the flow tiles and filter row above it
    // are tall enough that scrolling to top still left the loading message
    // below the fold. Scrolling the anchor into view works regardless of
    // how much sits above it, on any screen size.
    //
    // The setTimeout is load-bearing, not decorative: calling scrollIntoView
    // synchronously here - in the same tick as the setState calls above -
    // silently no-ops in Chromium. Deferring it one tick, after React has
    // flushed the re-render those setState calls trigger, is what actually
    // makes it scroll. Confirmed empirically (Playwright, mobile viewport)
    // before landing this - without the deferral the page never moved.
    setTimeout(() => {
      resultsAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
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
  // "Match my wardrobe to this") load the right flow with the piece
  // selected and stop there - they used to fire the AI call immediately,
  // which meant the season/occasion/colour filters were applied from
  // whatever they were last set to, with no chance to change them first.
  // Now you land looking at the loaded piece and the filter row, and press
  // Style me when it's set the way you want. One extra tap, no surprises.
  useEffect(() => {
    if (!request || ranRequest.current === request) return;
    ranRequest.current = request;
    if (request.anchorId) {
      setFlow("C");
      setAnchorId(request.anchorId);
      setImage(null);
    } else if (request.inspoId) {
      setFlow("A");
      setInspoId(request.inspoId);
      setImage(null);
    }
    setResult(null);
    setError(null);
    // Same one-tick deferral as the scroll in run(): the target only exists
    // after React has flushed the flow change above.
    setTimeout(() => {
      configAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
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

  async function dismissGap(lookId, gapIndex) {
    await save("looks", (cur) =>
      (cur || []).map((l) =>
        l.id === lookId
          ? { ...l, gaps: (l.gaps || []).filter((_, i) => i !== gapIndex) }
          : l
      )
    );
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
          No <code>ANTHROPIC_API_KEY</code> configured, so suggestions are a random
          shuffle rather than styled - still respects hard rules like season and no
          doubling up on shoes. Matching an inspo image needs the key.
        </div>
      )}
      <div className="flow-row">
        {flowBtn("B", "Suggest outfits", "from filters, or nothing at all")}
        {flowBtn("A", "Match an inspo image", "rebuild a saved look from my wardrobe")}
        {flowBtn("C", "Style a piece", "a new buy, or something I never wear")}
        {flowBtn("M", "Build my own", "pick pieces by hand")}
      </div>

      {flow === "A" && (
        <div className="flow-config" ref={configAnchorRef}>
          <div className="row">
            <select value={inspoId} onChange={(e) => { setInspoId(e.target.value); setImage(null); }}>
              <option value="">Pick from the inspo library…</option>
              {matchableInspoAZ.map((i) => (
                <option key={i.id} value={i.id}>
                  {inspoLabel(i).slice(0, 70)}
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
        <div className="flow-config" ref={configAnchorRef}>
          <div className="row">
            <select value={anchorId} onChange={(e) => { setAnchorId(e.target.value); setImage(null); }}>
              <option value="">Pick a piece I own…</option>
              {anchorableAZ.map((w) => (
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
        {/* filter-row narrows the three selects (globally they flex to fill
            their row, which is right for the single-select rows above but
            leaves no room here) so Style me and YOLO sit on the same line,
            YOLO pushed to the far right via margin-left: auto. */}
        {home && !weatherFailed && (
          <div className="weather-line">
            {weather ? (
              <>
                {summarise(home.city, weather)}
                {seasonFromToday && filters.season && (
                  <span className="weather-note">
                    {" "}· season set to {filters.season.toLowerCase()} from this
                  </span>
                )}
              </>
            ) : (
              <span className="weather-note">Checking today&rsquo;s weather in {home.city}…</span>
            )}
          </div>
        )}
        <div className="row filter-row">
          <select
            value={filters.season}
            onChange={(e) => {
              seasonTouched.current = true;
              setSeasonFromToday(false);
              setFilters({ ...filters, season: e.target.value });
            }}
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
          {/* Only Flow A (matching an inspo image) genuinely needs the AI -
              B and C fall back to a random shuffle server-side (see the
              no-ANTHROPIC_API_KEY branch in app/api/suggest/route.js), so
              gating this button on data.ai for every flow silently made
              that fallback unreachable from here. */}
          <button
            className="btn"
            onClick={() => run()}
            disabled={busy || (flow === "A" && !data.ai)}
          >
            {busy ? "Styling…" : "Style me"}
          </button>
          <button
            className={`chip yolo-btn ${filters.justMe ? "sel" : ""}`}
            onClick={() =>
              setFilters({ ...filters, justMe: !filters.justMe, occasion: "" })
            }
            title="No occasion - dressing purely for myself"
          >
            ✦ YOLO MODE
          </button>
        </div>
      </div>
      )}

      <div ref={resultsAnchorRef}>
      {busy && (
        <StylingLoader
          message={STYLING_MESSAGES[loadingMsgIdx]}
          heading={
            flow === "C"
              ? `Styling ${anchorId && byId[anchorId] ? byId[anchorId].name : "your new piece"}`
              : flow === "A"
                ? "Matching your inspo"
                : "Styling from your wardrobe"
          }
          thumb={
            flow === "C"
              ? { dataUrl: image, photoId: anchorId ? byId[anchorId]?.photoId : null }
              : flow === "A"
                ? { dataUrl: image, photoId: inspoId ? data.inspo.find((i) => i.id === inspoId)?.photoId : null }
                : null
          }
        />
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
            <div className="empty">That was everything from this round.</div>
          )}
          <div className="try-again-row">
            <button className="chip" onClick={() => run()} disabled={busy}>
              {busy ? "Styling…" : "Let's try some other options"}
            </button>
          </div>
        </div>
      )}
      </div>

      {flow !== "M" && !result && !busy && !error && owned.length < 2 && (
        <div className="empty">
          Add a few wardrobe pieces first
        </div>
      )}

      {looks.length > 0 && (
        <>
          <div className="section-h">Saved looks ({looks.length})</div>
          <div className="section-sub">
            Suggestions you&rsquo;ve kept, showing current wardrobe photos.
          </div>
          <div className="results saved-looks">
            {[...looks]
              .sort((a, b) => shuffleKey(a.id) - shuffleKey(b.id))
              .map((l) => (
                <OutfitCard
                  key={l.id}
                  o={l}
                  byId={byId}
                  newThumb={{ photoId: l.anchorPhotoId }}
                  onDismissGap={(gapIndex) => dismissGap(l.id, gapIndex)}
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
// `newThumb` is the image for an uncatalogued "NEW" anchor piece. `onDismissGap`
// is only passed for saved looks - gaps are a snapshot frozen at save time
// (see saveLook), so once you've actually bought the missing piece there's no
// way to tell automatically; dismissing just clears the stale note. Fresh,
// unsaved suggestions don't get a dismiss control - those gaps are
// regenerated on every run anyway.
// The in-flight state for a suggestion run. Three layers, because an AI
// call is a long wait by web standards (five to fifteen seconds) and no
// single cue carries that on its own:
//   - what it's working on: the piece's own thumbnail and name up top, the
//     strongest "yes, it heard you" signal there is, and free since the
//     image is already loaded;
//   - what's coming: skeleton cards the same shape as the real outfit
//     cards, so the eye knows where to look and what to expect;
//   - that it's still alive: the message cycles, and a coat hanger swings.
// Everything is inline SVG and CSS - no animation library, no image file,
// nothing to download - and the motion switches off under
// prefers-reduced-motion (see globals.css).
function StylingLoader({ message, heading, thumb }) {
  return (
    <div className="styling-loader" role="status" aria-live="polite">
      <div className="styling-head">
        {thumb && (thumb.dataUrl || thumb.photoId) ? (
          <Thumb dataUrl={thumb.dataUrl} photoId={thumb.photoId} className="styling-thumb" />
        ) : (
          <div className="styling-thumb styling-thumb-empty" aria-hidden="true" />
        )}
        <div className="styling-text">
          <div className="styling-title">
            <Hanger />
            <span>{heading}</span>
          </div>
          <div className="styling-msg" key={message}>
            {message}…
          </div>
        </div>
      </div>
      <div className="results skeleton-results" aria-hidden="true">
        {[0, 1, 2].map((n) => (
          <div key={n} className="card outfit-card skeleton-card">
            <div className="outfit-head">
              <div className="sk sk-title" />
            </div>
            <div className="outfit-items">
              {[0, 1, 2, 3].map((m) => (
                <div key={m} className="outfit-item">
                  <div className="sk sk-thumb" />
                  <div className="sk sk-name" />
                </div>
              ))}
            </div>
            <div className="sk sk-line" />
            <div className="sk sk-line short" />
          </div>
        ))}
      </div>
    </div>
  );
}

// A coat hanger, drawn once as inline SVG and set swinging by CSS. Pivots
// from the hook so it moves the way a real one does.
function Hanger() {
  return (
    <svg
      className="hanger"
      viewBox="0 0 48 40"
      width="34"
      height="28"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M24 3.5a4 4 0 1 1 4 4c-2 0-4 1.4-4 3.5v3" />
      <path d="M24 14 4.5 27.5c-1.4 1-.7 3.2 1 3.2h37c1.7 0 2.4-2.2 1-3.2L24 14z" />
    </svg>
  );
}

function OutfitCard({ o, byId, newThumb, actions, onDismissGap }) {
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
              <span>
                Missing: {g.need}
                {g.wanted_id && byId[g.wanted_id] && (
                  <span className="gap-wanted">
                    {" "}
                    - you&rsquo;ve already got your eye on{" "}
                    <b>{byId[g.wanted_id].name}</b>
                  </span>
                )}
              </span>
              {onDismissGap && (
                <button
                  type="button"
                  className="chip gap-dismiss"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismissGap(gi);
                  }}
                  title="I've got this now - clear the note"
                >
                  Got it
                </button>
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
  // One-tap category filter, same pattern as Wardrobe's (see categoryCounts
  // in WardrobeTab.js) - only categories actually present, counted against
  // the whole `owned` pool passed in, not narrowed by the search box.
  const categoryCounts = CATEGORIES.map((c) => [
    c,
    owned.filter((w) => w.category === c).length,
  ]).filter(([, n]) => n > 0);

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
        {categoryCounts.length > 1 && (
          <div className="chip-pick" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className={`chip ${!cat ? "sel" : ""}`}
              onClick={() => onCat("")}
            >
              All
            </button>
            {categoryCounts.map(([c, n]) => (
              <button
                type="button"
                key={c}
                className={`chip ${cat === c ? "sel" : ""}`}
                onClick={() => onCat(cat === c ? "" : c)}
              >
                {c} ({n})
              </button>
            ))}
          </div>
        )}
        <div className="row" style={{ flexWrap: "wrap" }}>
          <input
            placeholder="Search wardrobe…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
      </div>

      {owned.length === 0 ? (
        <div className="empty">
          Add a few wardrobe pieces first
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
