// Public, unauthenticated page - no checkAuth, no /api/data call. Deliberately
// separate from the gated app (app/page.js) so anyone can read it before
// they've been given a password: friends deciding whether they want their
// own copy, or Jess/Aaron linking someone to it directly.
export const metadata = {
  title: "FAQ - Personal Stylist",
  description: "How the Personal Stylist app was built, how it works, and how to get your own.",
};

const LAYERS = [
  ["Frontend and backend", "Next.js"],
  ["Hosting", "Vercel, free tier"],
  ["Database", "Upstash Redis, free tier, connected from inside Vercel"],
  ["Photo tagging", "Claude's vision API - suggests category, colour, season and style tags from a photo"],
  ["Background cleanup", "A background-removal service, applied automatically to wardrobe photos"],
];

const FAQS = [
  {
    q: "What is this?",
    a: "A private wardrobe app built with Claude. Designed to catalogue everything I own, track inspiration, wanted items, and suggest outfits from what I already have.",
  },
  {
    q: "Do I need to know how to code to build something like this?",
    a: "No. It was built entirely through plain-language conversation with Claude (yes, vibe-coded), including every bug fix and redesign. What helps is knowing roughly what you want; you don't need to know how to build it. (I do have a background in managing digital projects so that's an advantage for the speed and knowing how to explain things.)",
  },
  {
    q: "Is my data private? Can you see my wardrobe?",
    a: "If you get your own copy, it's a fully separate deployment: your own site, your own password, your own database. Nobody else's instance - including mine - can see your photos or wardrobe unless you choose to share them.",
  },
  {
    q: "Can I get my own?",
    a: (
      <>
        Yes! I've{" "}
        <a
          href="https://github.com/jessallison/stylist-app/tree/main"
          target="_blank"
          rel="noreferrer"
        >
          made the GitHub repo public
        </a>{" "}
        so you can fork and play. You'll need accounts with GitHub, Vercel,
        Upstash for the Redis database, and an Anthropic API key.
      </>
    ),
  },
  {
    q: "What does it cost to run?",
    a: "Hosting and the database both sit on free tiers. The only ongoing spend is API calls for photo tagging and suggestions, which run to a few cents at normal use.",
  },
  {
    q: "What happens if there's no Anthropic API key set up yet?",
    a: "The app still works. 'Suggest outfits' and 'Style a piece' fall back to a random shuffle from your wardrobe, still honouring hard rules like season and never doubling up on shoes - it just skips the styling judgement. Matching an inspo image needs the AI, so that one's off until a key's added.",
  },
  {
    q: "Why not just use an existing wardrobe app?",
    a: "Most wardrobe and outfit apps are built around discovery - browse more, buy more, chase what's trending. This works with what's already owned: AI tags, style-word filters, and a way to surface what's buried at the back of a drawer.",
  },
];

export default function FaqPage() {
  return (
    <div className="wrap">
      <header className="top faq-top">
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
        <a className="faq-back" href="/">
          ← Back to the app
        </a>
      </header>

      <p className="faq-intro">
        A private wardrobe app Jess built with Claude instead of buying new
        clothes: it catalogues everything I own, tags automatically, and
        suggests outfits from what's already in the closet. Read why I built
        it in more detail{" "}
        <a href="https://www.producingparadise.com/articles/i-just-want-to-look-cool-again-how-i-built-an-ai-stylist-instead-of-buying-new-clothes">
          here
        </a>
        .
      </p>

      <h2 className="section-h">How it works</h2>
      <div className="card faq-layers">
        {LAYERS.map(([label, value]) => (
          <div className="faq-layer-row" key={label}>
            <div className="faq-layer-label">{label}</div>
            <div className="faq-layer-value">{value}</div>
          </div>
        ))}
      </div>

      <h2 className="section-h">Frequently asked questions</h2>
      {FAQS.map((f) => (
        <div className="faq-item" key={f.q}>
          <div className="faq-q">{f.q}</div>
          <p className="faq-a">{f.a}</p>
        </div>
      ))}

      <footer className="site-footer faq-footer">
        <div className="f-powered">
          <span className="f-plus">+</span> Powered by Claude and Vercel
        </div>
      </footer>
    </div>
  );
}
