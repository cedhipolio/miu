# Test fixtures

**v60:** `npm run fixture` writes `synthetic-mount-analysis.pdf` here — invented names and numbers in
the shape of a mount analysis. CI runs every suite against it. The notes below are about using a REAL
package, which is still the better pre-release test.

The Playwright suite drives the real tool against a real document, so it needs a mount analysis PDF
to open. **None is committed here, and none should be.** The documents we test with are live site
packages — site numbers, addresses, carrier and vendor names, engineers' signatures — and they are
not ours to publish.

Put one in this directory (it is ignored by git) and point the suite at it:

```bash
export MIU_FIXTURE="test/fixtures/SOH3361 - Redlined Mount Analysis.pdf"
npm run build:artifact
npm test                 # the 203-check audit
npm run test:wysiwyg     # screen-vs-export parity, 18 marks
npm run test:text        # text parity, 10 cases
```

Any mount analysis works. A good one has, on its first few pages: a loading or equipment table with
numeric cells, a structural rating, at least one drawing sheet with callouts, and more than a dozen
pages so the page rail and the cross-page drag have something to work with. The audit's cell-level
cases look for printed text to redline, so a scanned, image-only PDF will fail a handful of checks
that have nothing to do with the build.

`scenario_v12`, run via `test/harness.py`, has three expected `false` results — `.z3.pageCentred`,
`.z3.pageLeftVisible` and `.ungrouped.textAbove`. They are the known baseline, not regressions.

## auto-finished-cutout.png (v65)

A picture Ced had already finished in the picture editor: a red equipment cut-out off sheet C-2 of
SOH1350, 344×413 with transparency. `behave.py` "Auto leaves a finished cut-out exactly as it is"
presses Auto on it and allows no ink to be erased — v64 erased 39.6% of it.

## auto-raw-capture.png (v66)

The same equipment from SOH1350 BEFORE Ced edited it: the drawing's long vertical line still runs
down its left side. "Auto takes the stray line off a real capture and none of the equipment" wants
1.5–6% of the ink erased, most of it in the left strip — v64 erased 39% (the equipment's masses),
v65 erased nothing.
