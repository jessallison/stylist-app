"use client";

import { useEffect, useState } from "react";
import WardrobeTab from "../components/WardrobeTab";
import InspoTab from "../components/InspoTab";
import StyleTab from "../components/StyleTab";
import ProfileTab from "../components/ProfileTab";
import { newId, uploadImage } from "../components/shared";
import { CATEGORIES, COLOURS, SEASONS, FORMALITY } from "../lib/style-identity";

const KEY_STORAGE = "stylist-admin-key";

export default function Home() {
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [tab, setTab] = useState("style");
  const [adminKey, setAdminKey] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  const [toast, setToast] = useState(null);
  const [locked, setLocked] = useState(false);
  // A styling request handed over from another tab:
  // { anchorId } runs Flow C, { inspoId } runs Flow A.
  const [styleRequest, setStyleRequest] = useState(null);

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

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  // save("wardrobe", nextArray) or save("inspo", (cur) => next) - the
  // functional form keeps concurrent multi-photo uploads from clobbering
  // each other. Rolls back local state if the server rejects the write.
  async function save(type, next) {
    let prev;
    let computed;
    setData((d) => {
      prev = d[type];
      computed = typeof next === "function" ? next(d[type]) : next;
      return { ...d, [type]: computed };
    });
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
      // this drops straight back to the gate.
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logout: true }),
      });
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
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onerror = reject;
        r.onload = () => resolve(r.result);
        r.readAsDataURL(blob);
      });
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
          title="Jess' Stylist is private"
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
    unlocked,
    needAuth: () => setShowLogin(true),
    adminKey,
    flash,
  };

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <h1 className="b-name">Jess&rsquo; Stylist</h1>
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
            <span className="f-name">Jess&rsquo; Stylist</span>
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
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    setBusy(false);
    if (res.ok) onSuccess(pw);
    else setErr("Wrong password");
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
