# Jess' Stylist

A personal styling and inspiration tool - a separate layer over the wardrobe,
not a replacement for Stylebook (which stays the inventory and wear log).

Given a tagged wardrobe capsule and a library of inspiration, it suggests
outfit combinations three ways:

- **Match an inspo image** - pick or upload an inspiration photo; the engine
  rebuilds the look's silhouette, layering and colour logic from owned pieces,
  and reports what's genuinely missing (checking the `wanted` list first).
- **Suggest outfits** - season / occasion / colour filters, or the "Just me"
  flag for no-occasion dressing (grounded by the worn-outfit photos).
- **Style a piece** - an owned item flagged "needs styling", or a photo of a
  new purchase; every suggestion is built around it. Marking a `wanted` item
  as bought triggers this automatically.

Every suggestion is checked against the style identity from the Allison
Bornstein session (three words, extended vocabulary, confirmed REGULARS - all
editable on the Profile tab) and only ever uses `owned`, currently-wearable
items.

## Stack

Same pattern as the recipe app: Next.js (app router, no TypeScript, no CSS
framework), Upstash Redis via REST with an in-memory fallback for local dev,
one shared `ADMIN_PASSWORD`, deployed on Vercel from GitHub. Plus two new
pieces: the Claude API (vision) for tag suggestions on entry, inspo
classification, and the suggestion engine itself; and remove.bg for wardrobe
photo background cleanup.

One deliberate difference from the recipe app: the password gates **viewing**
as well as editing. The wardrobe holds photos of me and what I own, so
nothing is served without it - login sets an httpOnly cookie so photos and
the data-download link authenticate normally, and it persists per device.
With no password set, production fails closed (fully locked) and local dev
stays open.

## Run locally

```
npm install
npm run dev
```

Without env vars, data lives in memory (resets on restart) and editing is
unlocked. AI features need `ANTHROPIC_API_KEY` even locally - put it in
`.env.local` if you want tagging/suggestions in dev.

## Deploy (same recipe-app flow)

1. `git init`, commit, push to a new GitHub repo.
2. Vercel → Add New → Project → import the repo → Deploy.
3. Storage tab → Create Database → Upstash Redis (free) - env vars are
   injected automatically.
4. Settings → Environment Variables → add `ADMIN_PASSWORD` and
   `ANTHROPIC_API_KEY` (console.anthropic.com). Optional: `CLAUDE_MODEL` to
   override the default (claude-sonnet-4-5), and `REMOVEBG_API_KEY`
   (remove.bg) for wardrobe photo background cleanup.
5. Redeploy once. From then on: push to `main`, done.

See `.env.example` for the full list. As with the recipe app there's no
automatic backup on free Upstash - the footer's "Download data" link is the
backup, worth tapping occasionally (photos are stored separately per item and
aren't included in that JSON).

## Data model notes

- Wardrobe item: photo + category / colours / season / formality (AI-suggested
  on entry, approved by hand) + `status` (`owned` / `wanted`), `fitStatus`
  (`current` / `not_current` - kept but excluded from suggestions), and a
  `needsStyling` flag ("how" pieces). Photos are run through remove.bg on
  entry (new items and product-pin "wanted" adds) and composited onto white -
  best-effort, falls back to the original photo silently on failure. Inspo
  and style-profile photos are never touched.
- `wanted` items are never assembled into outfits - they only surface in gap
  notes ("you've already got your eye on…").
- Inspo items are auto-classified on ingest: outfit photo (primary Flow A
  source), flat-lay moodboard (colour/pairing signal only, no proportion), or
  product/resale pin (routed to the wardrobe as `wanted`, not used as styling
  reference).
- Style profile: worn-outfit photos exported by hand from Stylebook's Cold
  Weather / Warm Weather / Fancy folders, same groupings.
- Saved looks: any suggestion can be kept ("Save this look") - stored as item
  references plus the stylist's reasoning, listed on the Style me tab.

## Phase two (scoped, not built)

Pinterest API import (boards → occasion tags, "This Is It" as baseline
signal), the wore-it/loved-it feedback loop, and the proactive closet audit.
Depop/Vinted have no public API for personal saves - screenshots stay the
mechanism indefinitely.
