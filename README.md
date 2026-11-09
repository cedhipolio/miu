# Mark It Up (MiU) — rebuilt repository

This repository was **rebuilt on 2026-11-09 from the shipped v84 build**, because the original repo
(src/ split into guard.js, harden.js, ds.css …, build.mjs, the Playwright suites, Vercel config)
was not available. `tools/build.sh` reproduces v84 exactly: every packed blob inflates byte-for-byte
to the same content as the delivered `mark-it-up-v84.artifact.html`.

If the original repo zip turns up, its history and its finer-grained `src/` can be merged back in:
`src/app/*` here are the *packed blob sources* (whole files), not the original per-module split.

## Layout

```
VERSION                         84.0.0
template/mark-it-up.template.html   the page: markup, boot loader (with the v81 workspace hand-off), empty blob slots
src/app/                        the Mark It Up app, one file per packed blob
  pk-css.css pk-pdf.js pk-wrk.js pk-lib.js pk-ast.js
  pk-app.base.js                the app as of v77
  pk-app.tail.js                v81+: hide the MiU|RFDS switch when running without the workspace
src/workspace/                  pk-ws — the workspace (tabs, RFDS mode, alignment, look sync, stamp card)
  ws_head.js align_part.js ws_main.js ws_tail.js   concatenated in that order
  rfds_stamp.js                 Mark It Up's COP stamp card, injected into every RFDS tab
  css_part.txt                  the MiU|RFDS switch + logo-swap CSS
  icons/                        tool marks and the swap arrows (alpha masks)
vendor/rfds-artifact.html       the RFDS Redlining Tool build that is embedded (pk-rfds)
tools/
  build.sh                      build dist/mark-it-up.artifact.html
  assemble.py                   src -> build/ blob sources
  pack.py                       gzip+base64 the blobs into the template
  embed_rfds.py                 swap the embedded RFDS build (applies PATCHES, e.g. the stamp red)
  unpack.py                     inflate the blobs of any built file, for inspection
tests/                          Playwright checks used for v78-v84 (python3, chromium)
dist/mark-it-up.artifact.html   the built artifact (publish this one)
docs/CHANGELOG.md
```

## Common jobs

- **Build:** `tools/build.sh` (bump `VERSION` first).
- **Update the RFDS tool:** replace `vendor/rfds-artifact.html` with the new RFDS artifact and build.
  Nothing else changes. `embed_rfds.py` re-applies its PATCHES and reports any it can no longer find.
- **Swap RFDS in an already-built file:** `python3 tools/embed_rfds.py dist/mark-it-up.artifact.html new-rfds.html`.
- **Tests:** the scripts in `tests/` open `file:///tmp/_t81.html`; create it with
  `python3 -c "open('/tmp/_t81.html','w').write('<!doctype html>\n'+open('dist/mark-it-up.artifact.html').read())"`.

Standing rule from Ced: update this repo on every release.
