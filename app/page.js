"use client";

import { useEffect, useRef, useState } from "react";
import WardrobeTab from "../components/WardrobeTab";
import InspoTab from "../components/InspoTab";
import StyleTab from "../components/StyleTab";
import ProfileTab from "../components/ProfileTab";
import { newId, uploadImage, deleteImage, fetchImageAsDataUrl } from "../components/shared";
import { CATEGORIES, COLOURS, SEASONS, FORMALITY } from "../lib/style-identity";

const KEY_STORAGE = "stylist-admin-key";

export default function Home() {
  const [data, setData] = useState(null);
  // Always-current mirror of `data`, for the rare async task (backfillHashes)
  // that starts from a snapshot, does real work in the background, and needs
  // to read whatever's actually in state - not what was there when it
  // started - right before it writes back. See backfillHashes in shared.js.
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const [loadErr, setLoadErr] = useState(null);
  const [tab, setTab] = useState("style");
  const [adminKey, setAdminKey] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  const [toast, setToast] = useState(null);
  const [locked, setLocked] = useState(false);
  // A styling request handed over from another tab:
  // { anchorId } runs Flow C, { inspoId } runs Flow A.
  const [styleRequest, setStyleRequest] = useState(null);
  // Wardrobe/Inspo tile density - lifted up here (rather than living in each
  // tab) because both tabs stay mounted for the whole session, so a local
  // hook in each would drift out of sync with the other.
  const [tileSize, setTileSizeState] = useState("large");
  useEffect(() => {
    try {
      const stored = localStorage.getItem("stylist-tile-size");
      if (stored === "compact" || stored === "large") setTileSizeState(stored);
    } catch {
      /* localStorage unavailable - just keep the default */
    }
  }, []);
  function setTileSize(next) {
    setTileSizeState(next);
    try {
      localStorage.setItem("stylist-tile-size", next);
    } catch {
      /* best-effort persistence only */
    }
  }

  // Viewing needs the password too. First load tries the stored key; a 401
  // means the whole app stays behind the gate until login succeeds (which
  // also sets the cookie that authenticates <img> requests).
  async function load(key) {
    try {
      const res = await fetch("/api/data", {
        headers: { "x-admin-key": key || "" },
      });
      if (res.status === 401) {
        setData(null);
        setLocked(true);
        return;
      }
      if (!res.ok) throw new Error();
      setData(await res.json());
      setLocked(false);
    } catch {
      setLoadErr("Couldn't load data. Refresh to try again.");
    }
  }

  useEffect(() => {
    const k = localStorage.getItem(KEY_STORAGE);
    if (k) setAdminKey(k);
    load(k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [backupBusy, setBackupBusy] = useState(false);
  const [backupProgress, setBackupProgress] = useState(null); // { done, total }

  // "Download data" only exports the JSON records - photos live separately
  // in Redis and are only ever served one at a time via /api/image/{id}, so
  // there's no single export that already includes them. This walks every
  // photoId referenced anywhere in the data, pulls each photo down as a
  // data URL, and bundles it all (records + an images map) into one JSON
  // file for the browser to download. Best-effort per photo - one bad fetch
  // shouldn't sink the whole backup.
  async function backupWithPhotos() {
    if (!data || backupBusy) return;
    setBackupBusy(true);
    setBackupProgress(null);
    try {
      const ids = new Set();
      data.wardrobe.forEach((w) => w.photoId && ids.add(w.photoId));
      data.inspo.forEach((i) => i.photoId && ids.add(i.photoId));
      data.styleProfile.forEach((p) => p.photoId && ids.add(p.photoId));
      data.looks.forEach((l) => l.anchorPhotoId && ids.add(l.anchorPhotoId));
      const idList = Array.from(ids);
      const images = {};
      let failed = 0;
      setBackupProgress({ done: 0, total: idList.length });
      for (let i = 0; i < idList.length; i++) {
        try {
          images[idList[i]] = await fetchImageAsDataUrl(adminKey, idList[i]);
        } catch {
          failed++;
        }
        setBackupProgress({ done: i + 1, total: idList.length });
      }
      const payload = {
        wardrobe: data.wardrobe,
        inspo: data.inspo,
        styleProfile: data.styleProfile,
        looks: data.looks,
        feedback: data.feedback,
        settings: data.settings,
        images,
        exportedAt: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stylist-backup-photos-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      flash(
        failed
          ? `Backup downloaded - ${failed} photo${failed === 1 ? "" : "s"} couldn't be included`
          : "Backup downloaded"
      );
    } catch {
      flash("Backup failed - try again");
    } finally {
      setBackupBusy(false);
      setBackupProgress(null);
    }
  }

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  // save("wardrobe", nextArray) or save("inspo", (cur) => next). Rolls back
  // local state if the server rejects the write.
  //
  // `computed` is deliberately worked out here, from the `data` already in
  // scope, rather than inside the setData() updater below. It used to be
  // computed inside that updater (matching `d[type]` instead of the outer
  // `data[type]`) on the theory that a function update always sees the
  // freshest state - but React doesn't guarantee an updater runs before the
  // very next line reads a variable it assigned, so `computed` would
  // intermittently still be undefined when the fetch body was built,
  // failing the save outright with no visible cause. That's what broke a
  // plain first-time wardrobe save on 27 Aug: every tab now backfills photo
  // hashes on mount (see backfillHashes in shared.js), which fires a
  // setData of its own in the background and was often enough to trigger
  // the timing gap on an ordinary save shortly after page load.
  //
  // Every call site here either fires once per user action or awaits each
  // save() fully before the next (see the multi-photo loop in PhotoButton),
  // so `data` in scope is never more than one render behind - there's
  // nothing left for the functional form to protect against. A future call
  // site that needs to fire save() several times without an await between
  // each one should bypass this helper the same way StyleTab's feedback
  // recorder and backfillHashes do: compute the full next value as a plain
  // value first, then setData and POST from that directly.
  async function save(type, next) {
    const prev = data[type];
    const computed = typeof next === "function" ? next(prev) : next;
    setData((d) => ({ ...d, [type]: computed }));
    let res;
    try {
      res = await fetch("/api/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey || "",
        },
        body: JSON.stringify({ type, data: computed }),
      });
    } catch {
      // Offline / connection dropped: roll back so the screen never shows
      // state the database doesn't have.
      setData((d) => ({ ...d, [type]: prev }));
      flash("No connection - change not saved");
      return false;
    }
    if (res.status === 401) {
      setData((d) => ({ ...d, [type]: prev }));
      setShowLogin(true);
      return false;
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setData((d) => ({ ...d, [type]: prev }));
      flash(j.error || "Save failed - try again");
      return false;
    }
    return true;
  }

  const unlocked = adminKey !== null;

  async function lockToggle() {
    if (unlocked) {
      localStorage.removeItem(KEY_STORAGE);
      setAdminKey(null);
      // Clear the cookie server-side, then reload - if a password is set
      // this drops straight back to the gate. Best-effort: if the network's
      // down mid-logout, the local key is still cleared (so the app doesn't
      // read as unlocked when it isn't), and load(null) still runs so the
      // screen doesn't keep showing data behind a lock that no longer holds
      // a valid cookie server-side.
      try {
        await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ logout: true }),
        });
      } catch {
        /* cookie clear is best-effort - local state still resets below */
      }
      load(null);
    } else {
      setShowLogin(true);
    }
  }

  function styleItem(anchorId) {
    setStyleRequest({ anchorId, at: Date.now() });
    setTab("style");
  }

  function matchInspo(inspoId) {
    setStyleRequest({ inspoId, at: Date.now() });
    setTab("style");
  }

  // A product/resale pin becomes a `wanted` wardrobe item: copy its photo to
  // a wardrobe image, let Claude tag the garment, and file it for approval.
  async function addWanted(inspoItem) {
    if (!unlocked) {
      setShowLogin(true);
      return;
    }
    flash("Adding to wardrobe…");
    try {
      const res = await fetch(`/api/image/${inspoItem.photoId}`);
      if (!res.ok) throw new Error("no image");
      const blob = await res.blob();
      const rawDataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onerror = reject;
        r.onload = () => resolve(r.result);
        r.readAsDataURL(blob);
      });
      // Same wardrobe-only background cleanup as WardrobeTab - a wanted pin
      // becomes a wardrobe item, so it gets the catalogue treatment too.
      // Best-effort: falls back to the original photo on any failure.
      let dataUrl = rawDataUrl;
      if (data.bgRemoval) {
        try {
          const bgRes = await fetch("/api/bg-remove", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-admin-key": adminKey || "",
            },
            body: JSON.stringify({ dataUrl: rawDataUrl }),
          });
          if (bgRes.ok) dataUrl = (await bgRes.json()).dataUrl;
        } catch {
          /* keep the original photo */
        }
      }
      const photoId = newId("wp");
      const up = await uploadImage(adminKey, photoId, dataUrl);
      if (!up.ok) throw new Error(up.error);

      let t = {};
      if (data.ai) {
        const tagRes = await fetch("/api/tag", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": adminKey || "",
          },
          body: JSON.stringify({ image: dataUrl, kind: "wardrobe" }),
        });
        if (tagRes.ok) t = await tagRes.json();
      }
      const item = {
        id: newId("w"),
        name: t.name || inspoItem.productName || "New wanted piece",
        brand: t.brand || "",
        photoId,
        category: CATEGORIES.includes(t.category) ? t.category : "Other",
        colours: (t.colours || inspoItem.colours || []).filter((c) =>
          COLOURS.includes(c)
        ),
        season: SEASONS.includes(t.season)
          ? t.season
          : SEASONS.includes(inspoItem.season)
          ? inspoItem.season
          : "All year",
        formality: FORMALITY.includes(t.formality) ? t.formality : "Casual",
        tags: [],
        status: "wanted",
        fitStatus: "current",
        needsStyling: false,
        notes: t.notes || "",
        addedAt: Date.now(),
      };
      const ok = await save("wardrobe", (cur) => [...cur, item]);
      if (ok) {
        flash(`"${item.name}" added as wanted - check its tags in Wardrobe`);
      } else {
        deleteImage(adminKey, photoId);
      }
    } catch (e) {
      flash(e?.message || "Couldn't add it - try again");
    }
  }

  if (loadErr) {
    return (
      <div className="wrap empty">
        <div>{loadErr}</div>
        <button
          className="btn"
          style={{ marginTop: 14 }}
          onClick={() => {
            setLoadErr(null);
            load(localStorage.getItem(KEY_STORAGE));
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  // The gate: nothing renders until the password checks out.
  if (locked) {
    return (
      <div className="wrap">
        <LoginModal
          noClose
          title="Personal Stylist is private"
          onSuccess={(pw) => {
            localStorage.setItem(KEY_STORAGE, pw);
            setAdminKey(pw);
            load(pw);
          }}
        />
      </div>
    );
  }

  if (!data) return <div className="wrap empty">Opening the wardrobe…</div>;

  const tabProps = {
    data,
    save,
    // Direct state access for the rare call site that can't safely go
    // through save() - see backfillHashes in shared.js for why.
    setData,
    dataRef,
    unlocked,
    needAuth: () => setShowLogin(true),
    adminKey,
    flash,
    tileSize,
    setTileSize,
  };

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <h1 className="b-name">Personal Stylist</h1>
          <span className="f-plus">+</span>
          <span className="b-divider" />
          <a
            className="b-by"
            href="https://producingparadise.com"
            target="_blank"
            rel="noreferrer"
          >
            by Producing Paradise
          </a>
        </div>
        <nav className="top-nav">
          {[
            ["style", "Style me"],
            ["wardrobe", "Wardrobe"],
            ["inspo", "Inspo"],
            ["profile", "Profile"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
          <button
            className={`lock-btn ${unlocked ? "unlocked" : ""}`}
            onClick={lockToggle}
          >
            {unlocked ? "Lock" : "Unlock"}
          </button>
        </nav>
      </header>

      {/* All tabs stay mounted so filters, forms and results survive switching. */}
      <div style={{ display: tab === "style" ? undefined : "none" }}>
        <StyleTab
          {...tabProps}
          request={styleRequest}
          clearRequest={() => setStyleRequest(null)}
        />
      </div>
      <div style={{ display: tab === "wardrobe" ? undefined : "none" }}>
        <WardrobeTab {...tabProps} onStyle={styleItem} />
      </div>
      <div style={{ display: tab === "inspo" ? undefined : "none" }}>
        <InspoTab {...tabProps} onMatch={matchInspo} onAddWanted={addWanted} />
      </div>
      <div style={{ display: tab === "profile" ? undefined : "none" }}>
        <ProfileTab {...tabProps} />
      </div>

      <footer className="site-footer">
        <button
          className="f-top"
          aria-label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          ^
        </button>
        <div className="f-main">
          <div className="f-title-row">
            <span className="f-name">Personal Stylist</span>
            <span className="f-plus">+</span>
            <a
              className="f-by"
              href="https://producingparadise.com"
              target="_blank"
              rel="noreferrer"
            >
              by Producing Paradise
            </a>
          </div>
          <p>
            A styling and inspiration layer over my real wardrobe: outfit ideas
            matched to inspo images, filtered by season or occasion, or built
            around one piece I don&rsquo;t know how to wear yet. Suggestions only
            ever use things I own.
          </p>
        </div>
        <div className="f-side">
          <div className="f-links-h">Quick links</div>
          <a href="https://producingparadise.com/contact" target="_blank" rel="noreferrer">
            Contact
          </a>
          <a href="/api/data" download="stylist-backup.json">
            Download data
          </a>
          <button
            type="button"
            className="f-link-btn"
            onClick={backupWithPhotos}
            disabled={backupBusy || !data}
          >
            {backupBusy
              ? `Backing up photos… (${backupProgress?.done ?? 0}/${backupProgress?.total ?? 0})`
              : "Download data + photos"}
          </button>
          <div className="f-powered">
            <span className="f-plus">+</span> Powered by Claude and Vercel
          </div>
        </div>
      </footer>

      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          onSuccess={(pw) => {
            localStorage.setItem(KEY_STORAGE, pw);
            setAdminKey(pw);
            setShowLogin(false);
            flash("Editing unlocked");
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function LoginModal({ onClose, onSuccess, noClose = false, title = "Unlock" }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    // Every other fetch in this app is wrapped like this - this one wasn't,
    // so a dropped connection mid-login threw past setBusy(false) and left
    // the button reading "Checking…" forever with no way out but a refresh.
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) onSuccess(pw);
      else setErr("Wrong password");
    } catch {
      setErr("No connection - try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`modal-bg ${noClose ? "gate" : ""}`}
      onClick={noClose ? undefined : onClose}
    >
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{title}</h2>
        <input
          type="password"
          placeholder="Password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
        />
        {err && <div className="err">{err}</div>}
        <div className="row" style={{ marginBottom: 0 }}>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Checking…" : "Unlock"}
          </button>
          {!noClose && (
            <button className="btn ghost" type="button" onClick={onClose}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
