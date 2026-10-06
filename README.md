# Mark It Up

A PDF redlining tool for mount analyses and construction drawings. It is one HTML file: the PDF
engine, the PDF writer and the fonts are all inside it, so it opens from a web server, from a
thumb drive or from `file://`, needs no install and no account, and **never uploads the document**.

Marks go out as real PDF annotations and the original pages stay vector — whoever opens the export
next can move a note or correct a value without the sheet turning into a picture of itself.

Deployed on Vercel: the landing page at `/`, the tool at `/app`.

---

## Quick start

```bash
git clone <this repo> && cd mark-it-up
npm run dev          # builds, serves http://localhost:5173, rebuilds as you edit src/
```

There are **no npm dependencies**. `npm install` is not a step — everything the build and the dev
server use is in Node's standard library. You need Node 18+ for the build, and Python 3.11+ with
Playwright only if you want to run the test suite.

---

## Layout

```
src/            the sources — this is what you edit
  shell.html      the markup: ribbon, rail, panels, the opening screen
  boot.html       the loader that inflates the packed blobs at startup
  app.js          the engine: pages, marks, strokes, selection, export        (~11k lines)
  ma.js           the mount-analysis layer: detection, Assist, as-built import
  toolpop.js      the per-tool properties panels
  selbar.js       the selection bar and context menu
  selectkit.js    lasso, text selection, picture editing
  fonts.js        the embedded font metrics the export measures with
  app.css · ma.css · toolpop.css · selbar.css
  pdfjs.js · pdfworker.js · pdflib.js        vendored, do not edit

site/           the landing page served at /
build.mjs       the packer — canonical, what CI and Vercel run
build.py        the same packer in Python, for local work and the test suite
scripts/        verify-packers.mjs, serve.mjs
test/           the Playwright suite (see "Testing")
docs/           changelog and deployment notes
```

### How the single file is made

Each group of sources is concatenated, gzipped, base64'd into a `<script type="text/plain">` block
and inflated at load by `src/boot.html` using `DecompressionStream`. Five blobs: styles, pdf.js, the
pdf.js worker, pdf-lib, and the application. The styles go in first so the page is never shown
unstyled.

Two outputs, because the file is served two ways:

| target | output | shape |
|---|---|---|
| `--target=web` | `public/app.html` | a **complete document**, with doctype, `<html>`, `<head>`, `<body>` — what Vercel serves |
| `--target=artifact` | `dist/mark-it-up.artifact.html` | a **fragment**, no skeleton — claude.ai's Artifact host supplies its own |

Publishing the web build as an Artifact gives you a nested document that renders in quirks mode;
serving the artifact build from a web server gives you a page with no `<head>`. CI asserts both
shapes on every push.

### Two packers

`build.mjs` and `build.py` do the same job. They are **equivalent, not byte-identical** — Node's
zlib and CPython's zlib pick different deflate block boundaries for identical input (measured on the
CSS blob: 102,269 bytes against 102,371), so the packed files differ while every byte the browser
ends up running does not. `npm run verify:packers` inflates both outputs and compares the payloads
and the surrounding HTML; CI runs it on every push. Each builder on its own is reproducible — same
source in, same bytes out, since neither writes a timestamp into the gzip header.

Prefer `build.mjs`. `build.py` exists because the Playwright suite and a decade of muscle memory
call it, and it is slightly the smaller of the two targets to type.

---

## Scripts

| command | what it does |
|---|---|
| `npm run dev` | build, serve on :5173, rebuild on every change under `src/` or `site/` |
| `npm run build` | the web target into `public/` — what Vercel runs |
| `npm run build:artifact` | the fragment into `dist/` |
| `npm run build:all` | both |
| `npm run check` | `node --check` over the sources we wrote |
| `npm run verify:packers` | assert the two packers still agree |
| `npm test` | the 203-check audit (needs `MIU_FIXTURE`, see below) |
| `npm run test:wysiwyg` | screen-against-export parity, 18 marks |
| `npm run test:text` | text parity, 10 cases |

---

## Testing

The suite drives the real tool in headless Chromium with a real mouse, against a real document.
**No fixture PDF is committed** — the ones we test with are live client site packages and are not
ours to publish. Drop one in `test/fixtures/` (ignored by git) and point the suite at it:

```bash
pip install playwright && python -m playwright install chromium
export MIU_FIXTURE="test/fixtures/SOH3361 - Redlined Mount Analysis.pdf"

npm run build:artifact
npm test                 # tools.py   — 203 checks, every tool and every rule
npm run test:wysiwyg     # wysiwyg.py — what is drawn vs what is exported, within 1.5pt
npm run test:text        # textparity.py — the same for type
```

Regression scenarios, run through the harness:

```bash
for s in v19 v14 v12; do
  python3 test/harness.py dist/mark-it-up.artifact.html "$MIU_FIXTURE" \
    --script "test/scenarios/scenario_$s.js"
done
```

`scenario_v12` has three expected `false` results — `.z3.pageCentred`, `.z3.pageLeftVisible` and
`.ungrouped.textAbove`. Those are the known baseline, not regressions. Everything else should be
clean, and `tools.py` must report **0 failing** with no page errors.

`test/fixtures/README.md` describes what makes a good fixture.

---

## Deploying

The repo is already configured; `vercel.json` carries the whole deploy.

**First time**

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project**, import the repo.
3. Leave every build setting alone. `vercel.json` sets the build command
   (`node build.mjs --target=web`), the output directory (`public`) and no framework preset. If the
   dashboard has guessed a framework, set it to **Other**.
4. Deploy. There is nothing to install, so the build is a few seconds.

After that, every push to `main` deploys; every pull request gets a preview URL.

**Or from the command line**

```bash
npx vercel          # preview
npx vercel --prod   # production
```

**Routing.** `cleanUrls` is on, so `public/app.html` is served at `/app` — link to `/app`, not
`/app.html`. `/tool` and `/miu` redirect to `/app` for anyone who guesses.

**Access.** The tool is internal. Vercel's project-level password protection or Vercel Authentication
(Settings → Deployment Protection) is the right control if the deployment should not be world-
readable; nothing in the app itself authenticates. Both the landing page and the tool send
`noindex`, which keeps them out of search results but is not access control.

**Saved work is per-browser.** Redlines are saved to that browser's `localStorage` on that machine —
not to the server, because there isn't one. A different browser, a different machine or a cleared
site-data is a clean slate. That is also why the domain matters: moving the site to a new hostname
leaves the old saves behind.

---

## Publishing as a Claude Artifact

The tool is also published as a private artifact on claude.ai, which is how it is reviewed between
deploys.

```bash
npm run build:artifact      # dist/mark-it-up.artifact.html — the fragment
```

Publish that file to the existing artifact URL so it updates in place rather than creating a second
one. Do not publish `public/app.html`.

---

## Conventions

**Comment tags.** Every non-obvious change carries a tag — `6jt`, `6k0`, `6k2` — and the comment
explains what was wrong, what was measured and why the fix is shaped the way it is. These are
referenced from the changelog and from each other. When you change something subtle, add one;
reading the code should not require reconstructing the argument.

**Measure before diagnosing.** Most of the hard bugs in this tool have been found by probing the
running page, not by reading it — the dimension-label drift, the stretched stamp, the swallowed
hotkeys and the 20 ms layout were all invisible in the source and obvious in a measurement. The
comments record the numbers for that reason.

**WYSIWYG discipline.** The browser's measurement **in page units** is the authority — `measureTextNorm`,
`cssBaseline`, `Tz`. Never read `offsetWidth / page.offsetWidth` and write it back: that is
zoom-dependent, and it is how marks drift between the screen and the export.

**One floor, one token.** Sizes that marks are held to (`MARK_MIN_N`) and the colours the selection
is drawn in (`--selink`, `--selw`) are defined once and read everywhere, including from the script.
Writing a literal where a token exists is how the screen and the file start disagreeing.

---

## Browser support

Chrome, Edge, Firefox and Safari, current versions. The loader needs `DecompressionStream`
(Chrome/Edge 80+, Safari 16.4+, Firefox 113+); without it the page says so rather than failing
silently.

---

© Ontel LLC. Internal tool — all rights reserved. Not for distribution.
