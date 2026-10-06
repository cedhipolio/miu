# Deploying

The short version is in the README. This is the part you only need when something is off.

## What Vercel actually does

`vercel.json` is the whole configuration:

- `buildCommand: node build.mjs --target=web` — no install step, because there are no dependencies.
- `outputDirectory: public` — `build.mjs` writes `public/` from scratch on every build: it copies
  `site/` in, then writes `app.html` beside it.
- `framework: null` — there is no framework. If the dashboard has auto-detected one, the build will
  try to run a framework's build and fail; set it to **Other** in Settings → General.
- `cleanUrls: true` — `/app` serves `public/app.html`. Link to `/app`.

`.vercelignore` keeps the test suite, the docs and any PDFs out of the upload. The build only reads
`src/` and `site/`.

## If the build fails

**"No Output Directory named public"** — the build command did not run, or ran a framework's build
instead. Check Settings → General → Framework Preset is **Other**, and that Build Command is not
overridden in the dashboard (a dashboard override beats `vercel.json`).

**"Cannot find module"** — `build.mjs` imports only `node:` built-ins. If this appears, Node is
older than 18. Set Node 20 in Settings → General → Node.js Version.

**A syntax error in a source file** — `build.mjs` runs `node --check` over everything we wrote
before packing anything, and names the file. That is the message; fix the file.

## If the deploy succeeds and the page is wrong

**Blank page, console says "Could not unpack the tool"** — the browser has no `DecompressionStream`.
Safari before 16.4 and Firefox before 113 will say exactly this. It is not a deploy problem.

**The page renders unstyled, or twice** — the wrong target was deployed. `public/app.html` must be
the web target (a complete document). If `dist/mark-it-up.artifact.html` was copied there by hand it
will have no `<head>`. Rebuild with `npm run build`.

**Redlines from before the deploy are gone** — saves live in the browser's `localStorage`, keyed to
the origin. A new hostname, a different browser, or cleared site data is a clean slate. There is no
server-side copy, by design.

## Access

The app does not authenticate anybody. If the deployment should not be world-readable, use Vercel's
Deployment Protection (Settings → Deployment Protection): password protection for a shared password,
or Vercel Authentication to limit it to the team. `noindex` keeps it out of search results and is not
a control.

## Custom domain

Settings → Domains. Remember that the origin is where saved redlines live: adding a domain and
telling everyone to switch leaves their in-progress work on the old `*.vercel.app` origin. Pick the
hostname before anyone starts using it in earnest.
