# Research Signal · GitHub Pages edition

A static, iPhone-friendly web app with manual refresh, local reading cache, saved items, source links, category/search filters, and a scoped offline service worker.

## Use

Open `https://sabokrou.github.io/research-signal/`. In Safari, choose Share → Add to Home Screen (and Open as Web App when shown).

Refresh opens the existing owner-private Research Signal service. Sign in with the owning ChatGPT account if requested. Enter a Claude API key on that private page once, select Refresh my briefing, and choose Return to my app.

The service stores the key encrypted and calls Claude with web search and fetch. API keys, service tokens, private messages and account cookies are never exported to GitHub. Only public-source briefing items return in a URL fragment, matched against an expiring random refresh state and removed from the address after import. The GitHub page never calls Anthropic directly. Referrer policy is `no-referrer`; source links use `noopener noreferrer`.

The private service remains hosted independently of GitHub Pages, which is static hosting. No Mac or Xcode is required. No new hosting subscription was started. Anthropic bills API usage; the service applies an estimated $5 monthly app limit, not an account-wide billing guarantee.

## Honest limits

- No background research, morning automation, inbox synchronization or message sending.
- Private LinkedIn messages, connection requests and reactions remain unconnected. Claude may find accessible public posts, with incomplete coverage.
- Grant eligibility, deadlines and scientific claims require checking the original source.
- Claude calls cannot be live-tested without the owner's key. App refresh may take a few minutes.
- A Home Screen web app can open its private refresh connection in Safari. If those browser contexts have separate storage, use Download briefing file on the private page and Import briefing under Preferences.
- Local cache is browser storage for public research, not an encrypted message vault. Clearing browser data removes cached/saved items. The latest server briefing remains private.

## Development

No package installation or build is needed for these files. Publish this folder at `/research-signal/` in the existing Pages repository. All scripts, styles, icons and the service worker are local to that folder; its service worker never intercepts academic or teaching pages.

The source tree contains no credentials or live private data. Do not commit API keys, authenticated exports or browser cookies.
