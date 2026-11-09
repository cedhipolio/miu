# Changelog

Per-version working notes — what was asked for, what was measured, why each fix is shaped the way it
is — live alongside this repo in the **MIU (Mark It Up)** Claude project as `claude/vNN-notes.md`,
back to v11. This file is the summary.

Versions are numbered by release, not semver: v59 is the fifty-ninth published build.

---

## v86 — the tool's icon on the browser tab; tabs in each tool's colour

- The browser tab shows the tool's mark again on the web build (Vercel): the workspace moves the icon
  into the page head, as the app always did for itself, and site/ now serves /favicon.ico and
  /apple-touch-icon.png for the moment before any script runs. The tab still turns to the RFDS mark
  in an RFDS tab.
- File tabs are tinted by tool — Mark It Up red, RFDS blue — with the mark in that colour and the tab
  you are in ringed in it; the + menu's marks match.

## v85 — no stamp-tool prompt after saving an RFDS

- An RFDS tab no longer asks to open the separate stamp tool after an export; stamping is done on the
  card, before saving.

## v84 — the stamp card on every theme; nothing scrolls on its own

- The COP stamp card in an RFDS tab is painted with Mark It Up's palette variables (the ones that tab
  lacks), so it has its background on every theme, not only Ontel.
- Tabs re-align only on a structural change (a document, the ribbon's side or fold, the page list, the
  theme, the window size), and every tab's scroll position is put back after — the pages stopped
  scrolling by themselves.

## v83 — one COP stamp, one font

- RFDS tabs stamp with Mark It Up's COP stamp card and process: the same fields and calendar, the same
  scope, one button that stamps the pages without one and updates the rest, the same progress bar,
  Switch REDLINED ↔ AS-BUILT. The RFDS build's own popover is retired.
- The RFDS stamp is Mark It Up's red (#fa3237), on screen and in the PDF (`embed_rfds.py` PATCHES).
- RFDS tabs use Mark It Up's type; page view and two-up carry across tabs.

## v82 — even groups, and a resize fix

- RFDS ribbon groups keep their slot but pack their tools evenly (Redline tools centred), no gaps.
- A resize no longer leaves a ribbon standing several rows tall.

## v81 — the workspace: any number of tabs

- Any number of Mark It Up and RFDS tabs, each in its own frame. A **+** beside the Log pill opens
  either; each tab shows its tool and file, × closes it (asking if it holds a document). Home resets
  only its own tab.

## v80 — nothing moves when you switch

- The two ribbons are lined up group for group and tool for tool; the rail, the Log pill, the drop zone
  and the page sit in the same place in both. File tabs beside the Log pill.

## v79 — the switch, polished

- The switch's icons are the tools' own marks in the theme's ink; a cross-fade between tools; hovering
  the logo offers the switch; the look (day/night, colour theme, tune, ribbon side and width, page
  list) is the same in both.

## v78 — RFDS mode

- The RFDS Redlining Tool is carried whole inside Mark It Up and opened by a MiU|RFDS switch beside
  day/night. It updates on its own (`tools/embed_rfds.py`).

## v77 — what is being moved goes see-through again

- While a mark, a snapshot, a shape, a stroke or a whole selection is being moved, resized or turned, it
  is drawn at half strength so the drawing underneath shows through and the drop spot is plain; it comes
  back to full strength on release. A click alone does not flicker it. A callout's leader and a length's
  reading fade with their mark.

## v76 — Make default applies in one press

- **Make default for all tools** (foot of every tool's Properties panel) now gives this tool's — or the
  selected mark's — properties to every tool at once, including the Redline tools, over any older setting
  made on a tool's own panel. v75 only saved them as the defaults and waited for an Apply that skipped
  every tool's own settings, so nothing visibly changed. An Undo beside the button puts every tool back.
  The ⚙ Default properties panel's Apply still keeps per-tool settings.

## v75 — colours that take, text that shows, faster stamping

- **Border and fill colours** work on every tool: a colour picked after "None" now brings its opacity back
  (and a text box's ground back on), in a mark's panel, a tool's panel and a mixed selection. Audited box,
  ellipse, text, callout, line, arrow, polyline, length, strike and cross-out — screen and export.
- **Text boxes shorter than their text** export the whole line: the appearance grows by the overflow the
  screen shows, on the side the vertical alignment puts it, instead of being clipped to three specks.
- **Vertical alignment**: the Properties panel showed Top for a text box that sits in the Middle; it now
  reads the same value the box and the mini bar do. Markup-library thumbnails follow the same default.
- **Stamping** renders each page once instead of twice and remembers where the stamp went, so a second press
  places without rendering; no artificial delay per page (a 17-sheet CD set: 13 s → under 5 s).
- **Stamp font**: any face from the tool's font list, always in its bold; the calendar and the font list no
  longer close the Assist panel when clicked.
- **Mini bar thickness**: a weight slider on a stroke's bar and on a shape's or callout's bar.
- **Make default properties** at the foot of every tool's panel: this tool's (or this mark's) properties
  become the defaults, with Apply to all tools one click away.

## v74 — Auto that works on real captures, default properties, stamp progress

- **Edit photo → Auto** works again on plain (opaque) captures: the paper is knocked out first, words are
  recognised and protected, the subject's body is found (main blob + attached appendages) and passing
  leaders/lines are taken off it. The fill behind the subject comes from the subject's own outline only, so
  nothing outside an enclosed shape is whitened.
- **COP stamp**: a calendar on the date field, matching the panel's colours; the Stamp button becomes a
  progress bar for the run (striped red fill, the stamp riding its edge, page count, ✓ when done).
- **Resizing shapes and callouts**: Ctrl grows about the centre (as the text box does), Shift keeps the shape
  perfect (square / circle).
- **Shapes with text** show the text properties in their Properties panel.
- **Group resize** scales outline thickness with the group.
- **Polyline**: double-click (or Alt+click) a point to remove it; clicking the first point closes the shape;
  dragging an end onto the other end closes it; fill from Properties now applies.
- **Fills** polished across box, circle, callout, text and polyline.
- **Default properties** (⚙ beside + in My tools): colour, opacity, weight, style, corners, arrow tip, fill,
  text ground, font, size, spacing, highlight. Nothing changes until **Apply to all tools**; a property you set
  on a tool yourself is kept, and "Let every tool follow the defaults" clears those.
- **Mini bar** only shows what a mark can use — a photo no longer gets font, alignment or text-ground controls.

## v73 — the tip slider lives in the mini bar

Ced, of v72's tip slider: "make sure the slider is not in the way of the redline. also, please follow
the neumorphism. make the slider a part of the mini toolbar itself not a separate tab." The floating
card under the bar covered the stroke. The slider now opens inside the stroke's (or callout's) bar,
right of its button, and the bar re-fits around it — the bar already stands clear of the stroke and its
reading, so the slider does too. It wears the bars' embossed language: a recessed track, a raised knob,
the value in the bar's ink. Clicking the button again, Escape, or a press away closes it.

behave: the tip case also checks the slider is in the bar and the bar is clear of the stroke.

## v72 — short text boxes, one-step stamping, tabs in the file, a whole ✕ on My tools, tip size as a slider

1. **A text box can be shorter than its text.** A height set with a top or bottom grip is kept exactly
   (`a.hFixed`); the words run past the edge, as they would in a cell they are squeezed into, and
   `growTextBox` no longer pushes the box back out. A side grip alone still lets the box grow to cover
   its text (6m4) unless the height was fixed.
2. **A COP stamp run is one undo step.** Every page's placement pushed its own history entry through
   `historyBatch`; the run is now one batch, and it lays out once at the end instead of per page.
3. **Tabs and spaces come out of the file where the screen put them.** The standard PDF fonts have no
   tab, so tabs from a spreadsheet were dropped ("Who:<tab>Ericsson" → "Who:Ericsson"). `expandTabs`
   turns each into the spaces that reach the screen's own tab stop (8 spaces of the mark's face, from
   the line start), deciding each stop from the screen's true pen position so rounding never carries.
   Word wrapping also keeps runs of spaces as typed instead of collapsing them to one.
4. **The My tools ✕ is whole** — it sits inside the button's corner; the button clips what hangs off it.
5. **Arrowhead tip size is a slider** (0.2×–4×, log scale, the old four sizes as ticks) in every
   panel that has endings and in the mixed-selection panel, and on the mini bars: a tip button on a
   stroke's bar and on a callout's bar opens a small slider above the bar, live, one undo per drag.

Tests: behave — "A text box can be made shorter than its text", "A COP stamp run over every page is
one undo", "Tabs and spaces from a spreadsheet come out of the file where the screen put them", "My
tools' remove mark is whole, and a stroke's tip size slides from its bar".

## v71 — square ticks, a bar that clears the reading, one panel for a mixed selection, placing over redlines, the text bar, stamp on the mini bar, Auto takes the lines again

Ced's nine, plus the red stamp:

1. **Length ends are square.** Open endings (ticks, chevrons, half arrows) were drawn with round caps
   and joins whatever the stroke said; they take the stroke's own corner setting now (sharp by
   default), on screen and in the file (`J`/`j`).
2. **The length's bar clears its reading.** `positionLineBar` counts the reading's box as part of what
   the bar must clear.
3. **A selection of several kinds opens one panel over all of them** ("Selection"): colour, opacity,
   weight, line style, corners, endings, font, size, style, alignment, vertical alignment and wrap,
   each written to the marks that can carry it. A tab per kind beside "All" opens that kind's full
   panel and writes to those marks only.
4. **The grip being dragged goes see-through** (a faint ring with a cross on a stroke's point, a faint
   outline on a box's corner), and the adjusting wash is fainter, so where it lands shows through.
5. **Placing is not selecting.** With a drawing tool in the hand, existing redlines let every press
   through to the page — a click or drag over one starts the new mark instead of picking the old one
   up (this replaces 6l7's click-to-select-with-a-tool). The just-drawn mark's grips still work.
6. **Point-by-point lines preview live.** The ghost armed by the first click was cleared by the click
   that armed it; it is rebuilt on every move. A Length can now be laid by two clicks as well.
7. **The text box bar** carries the font by name (the same picker as the panel, in its own face),
   vertical alignment (top/middle/bottom) and wrap (fill each line / between words).
8. **COP stamp on the mini bar**, in the same red as the ribbon's.
9. **Auto takes the lines outside the shapes again.** v66 judged each thin piece whole, and a
   dimension line with its ticks and figure, a leader into its label, or crossed grid lines are each
   one big piece, so all of them stayed. Now straight runs are found at every angle (measured along
   all the ink, taken only where they bound nothing enclosed), checked as solid, paper on both sides
   and long in their own right; what a line leaves behind (ticks, stubs) goes with it unless it sits
   in a word; the fill is recomputed from what stays so no white patch is left; and a taken line's
   anti-aliased fringe goes too. Against Ced's own edit of the SOH1350 capture: 99% precision, 66%
   recall (v66: 42%).

Tests: behave — "Auto takes the lines outside a concrete pad…", "A tool in the hand draws over a
redline…", "A length is laid by two clicks…", "Several kinds selected open one panel…", "The text box
bar names its font…", "A length's bar clears its reading…"; the raw-capture case is now judged against
Ced's finished cut-out; the furniture case allows the faint live grip.

## v70 — a site that flattens on download: one click makes the redlines editable again

- Ced's SOH1350 Mount Analysis came back from the portal flattened: every annotation painted into the
  page as pdf-lib `Fxo` forms, `/Annots` gone, our payload left in `/Subject`. The file MIU exported
  was clean (308 annotations, qpdf and strict pypdf pass); the portal does the flattening on its side,
  and nothing inside a PDF can stop that.
- Opening such a file already lifts the painted copies and rebuilds every mark as editable. Now it
  also raises "The site this came from flattened the redlines" with a green **Save editable copy**
  button that exports straight away, so the copy that goes back out has real annotations every viewer
  can edit.
- flatten.py: the offer must appear on a paint-flattened file, and its button must save a file with
  at least as many annotations as marks and nothing left painted.

## v69

Ced, with SOH1350 Redlined Mount Analysis (3): "when opened in a different viewer, the edited photo
retains it. but when opened in MIU, it reverts back to original… the one below … is not reverted."

- **The newest paint of each picture, in its own place.** That file had been round the loop more than
  once (export → flattened elsewhere → reopened → edited → exported → flattened again). Page 9 carried
  the old generation of each picture's form, left in the page's resources but no longer drawn, and the
  new one, drawn. v64–v68 read the pictures back from the resources in dictionary order and took the
  first form of the right size — the OLD one for three of the eight pictures (mean pixel difference
  71, 60 and 16 from what a viewer shows); the other five happened to come in the right order, which
  is why one picture "reverted" and its neighbour did not.
  Now each painted picture is found where it is DRAWN — the page content, read from the newest paint
  back — and matched to its mark by size, by angle (the form's Matrix against the mark's rotation)
  and by its centre on the page; the newest match wins. All eight pictures on page 9 now equal what a
  viewer draws, pixel for pixel.
- **Old forms leave the file.** Once our painted copies are taken off every page, their forms are
  dropped from the pages' resources, so no later round can mistake an old generation for the picture.
- flatten.py goes round the loop twice (a second hole cut in each picture, numbering carried on past
  the first round's forms like the real site) and wants the second-round pictures; fails on v68.

## v68

Ced: "the edited version of those snapshot, when exported, should be the final version. so the item
floating on the pdf is that in itself and reopening the pdf should make that as-is."

- **A PDF that carries our redlines opens exactly as it carries them.** No "Two sets of redlines"
  question for that case any more — it was the door the unfinished pictures kept coming back through.
  The browser's saved set is never put in the file's place by default or by a highlighted button.
- The browser's set is set aside under its own key before autosave writes over it. Only when it is
  NEWER than the file (work done after the export that was never exported) is it offered — a quiet
  note above the sheet with "Use the browser's set" (Undo goes back) and "Keep the PDF".
- A PDF with none of our redlines still offers the browser's work back, as before (crash recovery).
- flatten.py: reopening with a stale browser copy must not ask and must show the edited pictures.

## v67

Ced, with SOH1350 Construction Drawings (4) and Mount Analysis (1): "same problem retains to these
files" and "make sure the photo attached is hd".

- **The unfinished photo came from this browser, not from the file.** Both files reopen correctly
  in a clean browser (v64 reads the edited pictures back off the page — SOH1350 pixel-identical).
  Reproduced the real path: a reopen under v63 restored the pictures from the payload's recovery
  copies (the pictures before editing) and autosave wrote them into the browser; the document key is
  the same for every round of the same drawings, so every reopen since found that copy, asked "Two sets
  of redlines", and the highlighted answer was the browser's. On v66 that brings back pictures 19 and
  23 (mean pixel difference) away from the edited ones; on v67, 0.0.
  · A picture in the browser's copy that is byte-for-byte one of the file's recovery copies, where the
    file has the real picture for the same mark, takes the file's picture, and the browser's copy is
    corrected.
  · Exports carry their time in the payload; a file at least as new as the browser's copy is used
    without asking, and when they differ the newer one is the highlighted choice ("— newer").
  · flatten.py seeds exactly that stale copy and demands the edited pictures (fails on v66).
- **HD.** Snapshots are captured at no less than 4 px per point (288 dpi) whatever the zoom — a capture
  made at 40% was 1.2 px/pt. Attached photos keep up to 2400 px (was 1200) at JPEG 0.9 (was 0.82);
  cut-outs stay PNG up to 4 MB; the payload's recovery copy starts at 2000 px with a larger budget.

## v66

Ced: "the tool became worse than v64" — crop/Save, speed, Auto, and the reopened photo.

- **Auto: lines go, equipment stays.** v64 erased 38.5% of Ced's raw SOH1350 capture (the equipment's
  own masses); v65 erased nothing, because every outside piece was one piece — the stray line runs into
  the masses — and the masses saved it. Now the outside ink is opened: anything thicker than the
  picture's own line weight (read off its ridges) is body and grown back to its edges; the thin rest
  is cut into its own pieces and a piece goes only if it is a line (thin, ≥6× as long as wide, long
  in Auto's units, line-sized ink). Raw capture: 3.1% erased, three quarters of it the long line down
  the left edge; finished cut-out 0%; fine body 0%; leader picture unchanged (outer 1,061 → 377).
  New behave case on the raw capture (fixture `auto-raw-capture.png`): fails on v64 (38.5%) and v65 (0%).
- **Crop keeps what you kept where it was.** The saved mark keeps its centre, so a crop that took more
  off one side slid the picture across the sheet by half the difference. The shift is recorded like
  the free turn's trim (page units, turned by the mark's rotation) and travels with Undo. Measured: a
  feature at (0.400, 0.325) on the sheet is at (0.400, 0.325) after a 30% top-left crop and Save.
- **The picture editor is as quick as v61 again.** v62's live-shape layer was a full-size transparent
  canvas over the picture, blended on every brush frame: median frame 27 ms (v61) → 32 ms. It is only
  shown while it holds a shape: 23–28 ms.
- **Help says how the PDF engine is running** (its own worker, or the page's thread when the host
  refuses one) — that decides whether a page render can make the hand wait.

## v65

- **Ribbon below full width.** v62 capped My tools at three to a row everywhere; below full width the
  other groups flow as one run, so My tools stood three storeys tall and pushed Find, View and Assist
  onto a line of their own. The cap now applies only in the full-width ribbon (where every group is
  folded); elsewhere My tools spreads out like Redline tools.
- **Crop applies on Save.** A crop box still up when Save is pressed is applied (an untouched box cuts
  nothing). The ✓ Apply is green.
- **Auto never makes a shape smaller.** Everything outside the largest closed contour was taken as
  "outside line" — on a picture that was already clean that is the shape itself. Ced's finished
  cut-out from SOH1350 lost 39.6% of its ink to one press. A piece outside the contour is now taken only
  when it is a LINE: no heavier than the picture's stroke (≤ 8 px), at least 8× as long as it is wide,
  at least two of Auto's length units long, and no more ink than a line that size. The cut-out now
  loses 0%; a body with bolts, tabs, fins and a handle loses 0% (was 7.7% at 500×420); the leader test
  picture still loses its outside lines (1,061 → 377 outer pixels).
  Two behave cases: "Auto never makes a fine shape smaller", "Auto leaves a finished cut-out exactly
  as it is" (fixture `test/fixtures/auto-finished-cutout.png`; fails on v64 at 39.6%).

## v64

Ced: "reopening a pdf does not retain the edit photo tool when reopening a file redownloaded from a
different site" and "the tool also became so much slower".

- **Edited pictures come back edited.** The payload's recovery copy of a picture was made from
  `srcOrig||src` — and `srcOrig` is the picture BEFORE editing (what Restore goes back to). So a file
  another site flattened reopened with every erase, fill and cut undone. Measured on SOH1350: both
  recovery copies were the unedited captures (mean pixel difference 19 and 23 from the edited ones).
  The copy is made from the picture on the sheet now, and PNG cut-outs step down to 160px before being
  given up. For files already written, the painted-in picture a flattener leaves IS the edited
  picture at full resolution — it is read back (matched by page and exact size) before the paint is
  taken off: SOH1350's two pictures come back pixel-identical to the originals.
- **Slower:** three things v63 added, each measured on SOH1350.
  1. The render pause during a drag trusted pointerdown/pointerup; a release the page never hears
     (outside the claude.ai frame, on a scrollbar) left it on, and every page render then waited 8 s.
     It now needs a button-held move in the last 250 ms, clears on any button-less move, and waits 3 s
     at most.
  2. Taking painted copies off decoded every content stream of every page (~0.55 s on a scanned set);
     it reads from the end and stops once each painted form is found (0.02 s).
  3. The PDF engine's worker was started on the first open (0.2 s, up to 4 s if refused); it is
     started while the opening screen is up, with a 2.5 s limit.
  Pages and their text are also requested together instead of one round trip at a time.
  `test/perf.py` (new) compares builds: SOH1350 open 3.3 s (v62 3.0–3.3), no long frames while
  scrolling or dragging with the worker.

## v63

Ced: four things that cost the person using it, measured on his NOH5197 and SOH1350.

- **A file another platform flattened comes back editable, once.** Both files had been through a
  site that painted every one of our appearance streams into the page (`/FxoN Do`) and took the
  annotations off — SOH1350 twice, so every mark was painted two times. v58 restored the marks from
  the payload and left the paint, so each redline was on the page twice, moving or deleting one left
  its double behind, and the next export carried the burned-in copy. On reopen the painted copies of
  OUR artwork are now taken off the page (only the `Do`, so q/Q stays balanced; `/MAF…` deliberate
  flattens and other tools' forms are left alone). Recognised by a new `/MIUap true` on every
  appearance we write, and on older files by the exact dictionary `appearance()` writes (isolated
  group, one `/TR` face) or, for pictures, the `/Im0` form `drawImg` writes. NOH5197: 230 painted
  copies off, 57 stamp-tool forms kept. SOH1350: 143 off, 3 forms from another tool kept.
  `test/flatten.py` now also paints-then-strips (twice) and demands 0 painted copies in the re-export.
- **Shortcuts.** A slider, colour well or checkbox no longer counts as "typing"; a focused field that
  is no longer on screen lets the keys go; a clicked button gives the focus back (so Space/Enter do
  not press it again); a letter is matched by its physical key when the layout puts no Latin letter
  on it; inside claude.ai the frame takes the keyboard once ready. Four new cases in `test/keys.py`
  (three of them fail on v62).
- **No more hangs while working.** pdf.js ran on the main thread, so page renders (JPEG decoding of
  scanned sheets) froze the hand: dragging one mark on NOH5197 took 9.4 s for 30 moves, frames of
  1.8 s and 2.8 s. The PDF engine now runs in a real worker where the host allows it (started from
  the source the boot already holds; falls back to the main thread if refused): the same drag is
  1.4 s with no long frames. On the fallback, page renders wait while a mark is being dragged.
- **Zoom at the sheet's edge.** A sheet wider than the window is kept edge to edge — no grey beside
  it, its left edge never right of the page list, its right edge never left of the window. + / − and
  keyboard zoom hold the middle of the window (or the edge of the sheet that is on screen) instead of
  jumping to the middle of the sheet. A sheet narrower than the window is centred by the column.

## v62

Ced's notes on v61, all on the bars and panels you touch most.

- **Mini bars, drawn icons.** The bars' glyphs were typed characters thickened with a text stroke;
  they are drawn now at one weight (2.2 on 24, ~1.5px at 16px) with Ced's artwork where he sent it:
  alignment lines for align left / centre / right, his circled chevron (turned up and down) for a
  box's layer up / down, his arrow for a stroke's layer up / down (and the arrowhead toggle), Ced's curved swap
  arrows (turned upright) for "below / above the strike lines", and the bottom bar's flip icon for both flips. The few
  that are still letters (A− A+) drop to a middle weight.
- **My tools.** The ▾ shows on every copy (its CSS was scoped to `#tools`); the number badge is gone;
  three to a row. Remove from a hover ✕ in the corner, the right-click menu, or the + menu, with a
  confirm.
- **A copy and its original never share properties.** Opening Box's ▾ while "Box 2" was in the hand
  edited Box 2 (`maToolOf` answered the copy for a question that named Box). A field written from a
  panel is now written with that panel's own tool in the fields, so a tool picked up since the panel
  opened can no longer leak its colour and size into it.
- **Properties stay open.** Picking from a value list or the font list counted as a click away and
  shut the panel; it no longer does, and the list itself stays open with the new value ticked.
- **Picture editor: lines, arrows, boxes and ellipses are live** until Save — drag to move, drag an
  end or corner to reshape, Delete removes, the Ink row restyles the selected one; Undo/Redo carry
  them. Turn, flip, crop, border and Restore all draw them in first (Undo brings them back live).
- **Picture editor, one column.** Six tools to a row (Ced: "6 max is better"), and Undo/Redo and the
  zoom moved from the right column to the head of the left one, so the picture gets the right side
  of the stage back.
- **Downloads in the published artifact** — the export already asks the host (`downloads`
  capability); the artifact is now published with that capability declared.

## v61

**The fonts take, the ✕ always works, and the controls round a mark are one set.**

Ced: *"the newly added fonts are not working. / sometimes the x is not working. like in this video /
also, can we remove the x in the mini toolbar as it is redundant / remove the x that shows when you
hover to redlines. please show it when a redline was clicked. applies to all shapes items redlines
lines etc. / fix the shadows of the tabs in edit photo / the icons on the items/redlines are pretty
inconsistent. on the x, make sure it is the one filled with red. for the cross box, make sure it is
the straight line not the dotted. the alignment of the icons of x rotate and drag are also not
aligned vertically. the sizes as well. please make it consistent / make the color of edit this
picture icon in the box a color blue filled / make the stamp the same color as the default redline
color / also make the icons on the mini bar thicker."*

- **Fonts.** Every font write goes through the ribbon's hidden `#c_font` `<select>`, which only had
  options for the original faces; a browser refuses a value with no option, so a picked library font
  silently left the mark in Arial. Every face now has its option. A new `behave.py` case picks Roboto
  through the panel and fails on v60.
- **The ✕ with a tool in the hand.** After drawing, the Box or Line tool stays up, and 6hq gives a
  press to the tool — so a click on the ✕ started a new box under it. Measured: with Box or Line up
  the ✕ deleted nothing; with Select, Text, Redline or Pen it worked. A mark's controls (✕, turn,
  drag, edit, layer, grips; a group's and a stroke's too) now own their press whatever is in the hand.
- **The ✕ only on what is selected**, never on hover, for every kind of mark.
- **One set of controls.** The ✕ was 18px two pixels off the drag/edit column; every control is now
  a 20px disc on one centre line. The ✕ is a red disc everywhere (a group's and a stroke's were red
  rings). Edit picture is a blue disc. The group frame is a solid line.
- **Mini bars** lose their ✕ (the mark's ✕ and the bottom bar do it) and their glyphs are heavier.
- **Picture editor tabs** keep their whole shadow: the scrolling columns were clipping it down both
  sides (`overflow-y:auto` turns `overflow-x:visible` into `auto`).
- **The stamp** is the Redline tool's default red, `#fa3237` (was `#cc1c1c`); Update stamp brings
  placed stamps into line.

And, sent while v61 was being built:

- **My tools.** A `+` in a new ribbon group adds a copy of any drawing tool — "Box 2" draws like Box
  with its own colour, weight, font and the rest, set in its own ▾ panel. Right-click a copy to
  rename or remove it. Copies and their settings stay in this browser. (`src/customtools.js`; a
  `behave.py` case draws one box with each and checks the copy's blue does not leak into Box.)
- **Ced's artwork:** the pencil on Redline and on the edit-picture disc; the four-arrow drag on every
  drag control (marks, groups, strokes); the paint roller on the theme button; the stacked tick box
  on Select all; the page-and-wrench on Copy properties (bottom bar and mini bar); the circular arrow
  on the picture editor's Rotate right, mirrored for Rotate left.
- **Found by `chaos.py`:** turning a stroke wrote its rotation guide's lift as `x="NaN"
  width="undefined"` (it was handed only a size) — four console errors per turn. The guide now reads
  any rect-like box and draws no lift without one.
- **Assist / COP stamp tab:** neumorphic with no outlines (ma.css's field borders were winning the
  tie and drew a dark outline on every page-following theme), every inner surface rounded, and a thin
  trackless scrollbar.

---

## v60

**A tool for the whole company: it fails safely, says what happened, and looks like one program.**

Ced: *"Make this build much more stable. think of it as an actual tool that will be used by users
across the company so the stability should be there. also perfect the design language, make it
consistent across all tools, all tabs, all drop downs etc."* — and, while it was being built: a
glowing, theme-coloured Auto; a heavier lasso; a new Invert, Select and Pan; filled redline icons; a
callout that is not a chat bubble; one stamp button that stamps or updates; redline text that is a
real text box; every font that can be added; the preloaded markup drawings; the editor's pressed
keys lit from the upper left.

### Stability

- **`guard.js`, first in the app.** Every uncaught error and rejected promise is caught; the
  browser's harmless notices (ResizeObserver, cancelled renders) are recorded but never shown; a real
  one raises ONE calm notice per problem — what happened, that the redlines are saved, and **Copy
  details**, which puts a support report (version, browser, document size, the last problems and log
  lines, never the document's contents) on the clipboard. The pending autosave is flushed first.
- **The close guard.** Closing the tab inside autosave's half-second debounce lost the last edit. It
  now warns only then, and the save is forced through on hide and on close.
- **Opening a file.** Real PDFs with an empty or odd MIME type (Outlook, network shares) were turned
  away — a file is judged by its `%PDF-` header now. A second drop mid-load no longer runs two loads
  into one state. Password-protected, damaged, empty and non-PDF files each get a plain sentence of
  what to do. One unreadable page no longer refuses the whole document. A failed open leaves the
  document that was already open exactly as it was — including the export name and the bytes the
  export is built from, which it used to overwrite.
- **Export.** One at a time (a double-click ran two into the same pdf-lib document); a failure says
  the redlines are safe and to try again, instead of "see the browser console".
- **`harden.js`, last in the app.** The context menu had no Escape and stayed above any dialog
  opened under it; now Escape closes it first and every modal closes menus as it opens. A
  non-numeric coordinate can no longer reach a mark (and from there storage): it is repaired at layout
  and reported.
- **Boot.** A browser that cannot inflate the bundle, or an error while the app script runs, used to
  leave the loading screen up forever. It now shows "Mark It Up couldn't start", what to try, the
  details, and Reload.
- **`test/chaos.py`** — seeded sessions of hundreds of real mouse and keyboard actions, checking
  after every one that nothing threw, every coordinate is finite and on a real page, ids are unique,
  and no modal sits under a menu. Twenty sessions × 300 actions held.
- **CI was broken and never ran the suites.** The build job read `public/app.html`, which has not
  existed since v38; the audit job only ran with a client fixture configured, so never. Now:
  `tools/make_fixture.py` writes a synthetic mount analysis, and every push runs behave, keys,
  reopen, flatten and chaos against it (audit and parity report alongside).
- `src/manifest.json` is the one list of what goes into each blob — `build.mjs` and `build.py` each
  had their own. `src/app.rfds.js` (980 KB, referenced by nothing) is gone. `release-check` also
  asserts the version the tool reports equals `package.json`'s. `tools/traceicon.py` runs on NumPy 2.

### Design language

- **`ds.css`, last in the CSS.** Five radius steps and six type steps; 441 literal radii and sizes in
  the four older sheets now read them (marks on the page are left exactly as they were).
- **Surfaces, as Ced set them:** Ontel keeps v59's surfaces, Day and Night. Every other theme hangs its
  tool panels, menus, dropdowns, selection bar, Assist and the picture editor on the PAGE's surface —
  they were a fixed navy from the first theme, so a Day theme hung black panels on a white page. The
  panels' colours are one token family (`--fp-*`) shared by the tool panel, the selection bar, every
  menu and the ask dialogs.
- One look for every **select** (drawn chevron, sunk well), **menu row** hover, **segmented tab**
  (Night/Day/System and Top/Right join the tool panel's), section label and focus ring.

### Asked for along the way

- **Auto** glows, and its iridescence is a sweep around the THEME's accent. **Lasso** is a heavier
  dotted loop with a solid arrow. **Invert**, **Select** and **Pan** are Ced's artwork. The redline
  tools are **heavier and filled**; the **callout** is a text box on a leader with an arrowhead.
- **Stamp**: one full-width button with the stamp's mark, pinned under the card — it stamps the pages
  in range that have none and updates the ones that do, in place, and says which.
- **Redline text is a Text box**: placed and sized over the printed value, red, resized by its
  handles, wrapping at words.
- **Fonts**: 30 open families (OFL / Apache) — office look-alikes, sans, condensed, serif, mono,
  handwriting — subset to WinAnsi and embedded on export by the existing TrueType writer
  (`tools/addfonts.py` → `src/fonts-extra.js`). The font chips became a searchable picker.
- **Preloaded markups**: Ced's ten equipment drawings ship with the tool (`assets/markups/`,
  `tools/addmarkups.py`), never touch browser storage, and an edit saves a copy.
- The editor's **pressed and sunk** controls take their shadow from the upper left, like the ribbon.

Build 4.30 MB (fonts 2.25 MB of it). Suites on the synthetic fixture: tools 6 failing — all six
fail identically on v59 and are fixture- or rasteriser-specific (see the v60 notes); behave, keys,
reopen, flatten, stampparity, colparity, chaos green; wysiwyg and textparity at their v59 baseline.

---

## v59

**The picture editor becomes two columns, the border grows smoothly, and the two tools nobody had
ever pressed get pressed.**

Ced: *"work through the tool audit / also, the stops in border tool in edit picture is too much. make
it more seamless like a slider. / in edit photo, put all the tool tabs on the left and stack
individual tools. the main tab, the brush, rotate, and border. while the undo redo and zoom are
stacked on the right. / also, no colored border. it should play the neumorphism ui here. / the
explanation tab here is not needed. make the tools icons and ui here more rounded like the roundness
of the tools on the main ui"*

**Two columns of tabs (`6nn`).** The rail and the floor dock are gone. Everything that *does*
something to the picture stacks down the left — tools, brush, rotate, border — and everything that
undoes or looks stacks down the right: history, zoom. Each is its own plate: no hairline, the same
`--radius: 12px` the main UI's panels use, lifted on the same two-sided neumorphic shadow rather than
a coloured edge. The tool grid is four across at 38px, and the stage's padding is measured from the
columns themselves on every layout, so a wide picture never slides under either one.

| | before | after |
|---|---|---|
| left column | — | `tools · brush · rotate · border` |
| right column | — | `history · zoom` |
| plate border | 1px coloured | none — shadow only |
| plate radius | 8px | **12px**, as the ribbon's |
| button radius | 6px | **9–11px** |
| slider track | 96px | **188px** |

**One line instead of a paragraph (`6no`).** The explanation block under the picture is gone. What
it used to say now rides on each control's own `title`, and the editor says what it has just done in
a single line over the picture, which fades after five seconds — unless it is an error, which stays.

**A border that grows, not steps (`6np`).** The border slider moved in whole pixels: 12 stops across
its whole travel, and the step from 3 to 4 is visible. It now moves in tenths — **121 positions** —
and the fractional part is painted as the next ring out at `globalAlpha = frac`, so 3.5 really is
half a ring heavier than 3.0. Measured as summed alpha across the picture: 3.0 → 10,852,800,
3.5 → 11,047,360, 4.0 → 11,240,400. Counting *pixels* reads 3.5 and 4.0 as identical, which is why
the test that proves this sums the channel instead.

**The audit: the two tools that had never been driven (`6nq`).** Counting named cases per ribbon
tool, every tool had some coverage except two. **Pan** had a single passing mention and no gesture
anywhere — which is the exact shape of hole v41's `6gb` could fall through, since it is three
branches off one press and nothing had ever pressed. **Find** had no named case at all, in either
file. Both now have one, driven by real mouse and keyboard:

* the hand moves the sheet by the distance the hand moved (80px across, 160px down, to the pixel),
  leaves no marquee behind and makes no mark; the arrow in the same place marquees and moves
  nothing; and Shift lends each tool the other's gesture, both ways
* Find counts what is on the sheet (25 hits for its needle in the fixture), lights the first one,
  walks forward on Enter and back on Shift+Enter, and puts the box and the highlight away on Escape

Both were proved against a broken build: with `_wantPan` forced false every pan reads 0, and with
Enter's handler gutted the count never leaves 1/25.

**Two stale tests, corrected rather than relaxed.** `6nn` moved Undo and Redo out of `.sk-edbar` and
into the right-hand column, and two cases looked for them *inside the bar* — so a working button
read as a missing one. The helper that presses an editor button by its `data-k` now searches the
whole editor, which is what it always meant: the key names the button, where it is hung is layout.

**Suites:** tools 188 · behave **82** (two new) · wysiwyg 19 · textparity 12 · stampparity 4 ·
colparity 11 · keys · reopen · flatten · scenarios v19/v14/v12 — all green.

---

## v58

**A file that comes back from another platform brings its pictures with it.**

Ced: *"uploading a pdf into a different platform and editing it again seems to flatten the photos in
the pdf"*, with the package back from the site it had been submitted to.

**What the returned file actually showed.** 18 pages, 4.1 MB, our own Producer still on it:

| | |
|---|---|
| `/Annots` on every page | **0** — every annotation stripped |
| `MAData` / `MAPhoto` / `MARL` | **0** — so every per-mark tag went with them |
| `/Subject` MAREDLINE payload | **99,934 chars, intact** |
| marks in it | **139 marks, 41 strokes** — all of them |
| pictures in it | **8, every one with no pixels** |

So the document payload is the channel that survives a flattener, and the pictures were the one
thing not riding in it. v49's `6ff` and v51's `6le` had taken a photo's bytes *out* of the payload
precisely because they were also in the photo's own annotation tag — and the tag is exactly what a
flattener destroys. Everything else in the payload is enough to rebuild a mark; a picture is only
pixels.

**The payload was also uncompressed** — base64 of plain JSON. Measured on Ced's file, gzipping it
first takes 99,920 chars to **9,624**, a tenth. That is where the room came from.

So a picture now travels twice, on purpose and at two weights (`6nm`): the annotation tag keeps it
at full resolution for an ordinary reopen, and the payload carries a **recovery copy** — PNG where
the picture has transparency (every cut-out does) and JPEG where it has not. Identical pictures are
stored once and referenced.

**Shrink before you shed.** The first cut made one copy at 1400px and dropped whole pictures when
the total would not fit: three incompressible test photos came to 644,761 chars and **two of the
three were thrown away** to make the third fit. A picture that comes back small is worth far more
than a picture that does not come back, so each one is now stepped down — 1400px, 1000, 700, 480 —
until it fits a budget of its own. The same three photos now cost **100,661 chars in total** and
all three come back.

**And a payload picture is let through when nothing on the page claims it.** The merge said
`kind!=="img"` flatly, to stop a photo arriving twice — restored from the payload *and* still
sitting on the document as an annotation. But that only happens when the annotation is still there,
and on a flattened file there are none, so the blanket refusal was the reason Ced's 8 pictures came
back as nothing. The test is the precise one now: no annotation claimed this id, none was left on
the page under it, and the payload has pixels for it.

**It says so.** A reopen that had to reach for the recovery copies now tells you the file had been
flattened by another tool and that those pictures are at recovery resolution, not the originals —
and if one could not be carried at all, it says that too. Silently showing a lower-resolution
picture, or an empty box, is the part of this that cost Ced a submitted package.

**New suite: `test/flatten.py`.** `reopen.py` could never have caught this — it exports and reopens
*our* file, where the annotations are still there and serve every picture, so the payload is never
asked. This one asks it, by doing to the export exactly what that platform did: strip every
`/Annots` and nothing else. Reverted to the old behaviour it reproduces Ced's symptom precisely —
6 of 9 marks, 0 of 3 pictures.

---

## v57

**Ced's own icons on every tool, and the picture editor taken off its surface.**

**Seventeen marks, traced** (`6nd`). Ced sent artwork and said which tool each belongs to. They are
**traced, not redrawn** — `tools/traceicon.py`, the tracer the bucket and the app's icon set already
went through: each contour simplified with Douglas-Peucker at a tolerance just wide enough to
swallow the antialiased staircase, scaled into a 24-unit box, holes kept as subpaths, emitted
`fill-rule:evenodd`. Three sources were low-resolution — the flip-vertical pair and the two turn
discs — so those were smoothed 4× with Lanczos first, or every jag would have become a vertex. One
carried a stock-library watermark under the artwork; the first pass kept it and sized both discs to
a tenth of the box to make room for it, so it was cropped off before the trace. 17 KB in all.

**The shapes are thicker** (`6nd`). Line, Arrow, Box, Ellipse and the shaped selection had no
artwork and were typographic glyphs, whose weight is the font's and not ours. Drawn now, at a
stroke of 3 in a 24 box. `style="fill:none"` and not the `fill` attribute, because
`.sk-edg svg{fill:currentColor}` is a stylesheet rule and beats a presentation attribute — which is
how the first cut came out as a solid square, a solid disc and a solid rounded rect.

**Auto is holographic** (`6nf`). Ced sent an iridescent sheet. The stops are **sampled** from it,
across the brightest band — #c2b7fc, #c6d2fe, #9cdffb, #51f9fc, #81fff2, #bdfbc5, #e1e3d9, #e9d0da
— on the diagonal the sheet runs on.

**The name, on hover, at once** (`6ne`). Every button already carried a sentence, but a native
tooltip waits about a second and then shows the whole thing — right when you wonder what a tool
*does*, wrong when you are hunting for the one called Lasso. The word appears beside the button
immediately; the sentence still arrives behind it. One floating chip rather than a `::after` on
each button, because the rail scrolls and would clip one.

**The paragraph is gone** (`6ng`). Two lines of prose saying a third time what each button now says
twice, at the cost of 40px off the top of the picture. The two things in it that no tool says — the
wheel sizes the brush with Shift and zooms with Ctrl — moved onto the brush slider's tooltip and the
zoom buttons'.

**The tools float, and so does every control** (`6nh`, `6nk`). Ced: *"make the tools be floating in
a tab on the ui instead of lying on a surface"*, then, at a single dock holding everything,
*"no, the sliders should be within the ui separately not in one tab."* The rail is a panel of its
own resting over the stage; the dock at the foot keeps the position and gives up the plate, so
Brush, Rotate, Border, the history pair and the zoom block are five panels rather than one tab with
five things in it.

**The sliders are Ced's** (`6ni`). A pill track, the part behind the thumb filled, a white thumb on
a grey ring, and the reading in a bubble riding above it. Sampled from his picture: #0077e4 to
#0054b0 across the fill, #d5d5d5 for the track, #a8a6a9 for the ring. A native range paints no
filled portion on WebKit, so the fill is a gradient sized by a custom property; the bubble is placed
in **pixels** and not a percentage, because the thumb's centre travels half a thumb in from each end
and a flat percentage drifts off it by 9px at the extremes.

**And the spaces are even** (`6nl`). Ced: *"make sure the spaces are even."* Measured, they were
not: v56's `.sk-edbase .sk-edhist,.sk-edbase .sk-edview{padding:0}` won a specificity tie on source
order, so those two panels had no inside measure at all while the sliders beside them had 12px —
"nothing selected" sat hard against the hairline. And the settings group was being panelled along
with its own child: one 57px plate with a 46px plate inside it. One scale now, written once: **10px
between panels and to the card, 12px inside a panel, 54px tall** — 54 because that is the tallest
of them, and even has to mean the same number even when one panel carries a bubble and another does
not.

Chasing that clearance turned up two more of mine. `.sk-edstage{padding-left:142px}` lost to the
shorthand `padding:8px` written later in the same file, so a wide picture slid **under** the tools;
the room the panels take is set from the element's own style now, measured off the panels
themselves. And `fitZoom` measured the stage's **border** box, so a 560×760 capture was fitted to a
box 137px taller than the one it had to sit in and hung out of the bottom of it.

**The fill swatch is rounded** (`6nj`). An `input[type=color]`'s inner well is a shadow part of its
own, so rounding the control alone leaves a square of colour inside a rounded box — which is what
Ced's capture showed. Both are rounded.

**And the chequer is squares again** (`6n8` corrected). v56 tokenised only the second of the two
gradient layers and left the first transparent, which is a diagonal weave rather than a chequer —
visible in the dark theme as a herringbone.

---

## v56

**Auto was never broken — it had been silenced. And the picture editor, the selection chrome and
the bars all answered at once.**

**The picture editor says what it has just done** (`6n5`). Ced: *"auto has stopped working in edit
photo."* Measured on four pictures, Auto strips the strays and fills behind the ink in **96–546 ms**
and declines a block of text on purpose — the algorithm was fine. What had stopped was the telling:
every message in the editor goes through `setStatus`, which writes to the page's status strip and
the quick bar, and the editor is `position:fixed; inset:0` at z-index 4700. So Auto's paragraph
explaining *why* it declined — the whole point of v51's work — was painted underneath the dialog.
The editor has a line of its own now, and `skEdWire` shadows `setStatus` with one that writes to
both, so all forty-odd call sites reach the eye without one of them being touched.

**The tools are squares** (`6n7`). Ced: *"make the clickable icons on edit photo boxes instead of a
long rectangle."* The word goes to the tooltip, which every one of these already carried — a
sentence saying what the tool does, more than the word ever said. 34px boxes, three to a row: the
rail goes 150px → **122px** and the column 622px → ~330px.

**The slider is the angle, and it is called Rotate** (`6n6`). Ced: *"free slider is not working
good. also, rename it to Rotate."* It read as a nudge and behaved as one — every release committed
the value as a *relative* turn and snapped the handle back to 0, so the reading never said where
the picture was and asking for 12° twice gave 24°. The mechanism underneath was already absolute
(v51's `spinAcc`); the handle is wired to it now. Ask for 12 twice and the picture is at 12.

**A day and a night** (`6n8`). Ced sent the plain light chequer: *"make the background more similar
to this, but have light and dark background mode."* The editor was one of two surfaces deliberately
kept dark whatever the theme — a decision made when it was a small panel, and it is most of the
window now. Every colour is a token with a light set; the light chequer is white against #cfd2d8,
which is the one Ced sent.

**A box nib keeps its promise**, and **the grips** — see v55; both carried into this build unchanged.

**Every kind of mark wears the same selection chrome** (`6na`, `6nb`). Ced: *"the text in redline
tool should behave similarly with text box when selected"* and *"the cross does not follow the same
design language when selected."* Measured: a cell redline showed **six grips where a text box and a
shape show eight**. v51 had left the top and bottom off on the reasoning that a plain redline has no
box to make taller — true of the box, not of the mark, because a redline's height *is* its type. The
pills are there and they size the type, which is the vertical half of what a corner already did. A
cross-out is two grouped strokes, so what you select is the group: its frame now carries the same
eight grips and lays its three controls out from the same numbers as a mark's — the turn alone and
centred, delete and drag stacked off the right. The dashed ring is the only difference left, and
that one is deliberate.

**The mini toolbar centres on what it belongs to** (`6n9`). Ced: *"always put the mini toolbar in
the middle of the shape if allowable. only put it on left or right if the item is on the edge of
UI."* It was placed at the mark's left edge. Both bars centre now and the existing chrome insets do
the rest: on a mark in the middle the bar is **0px off centre**, and against the right edge it stops
at the chrome instead of running off it.

**The colour in the file is the colour on the sheet** (`6nc`). Ced: *"the colors rendered are
sometimes different to the one showed in ui"*, with a 34% red fill reading `#fdb9bb` on screen and
`#c5aeae` in his render.

Measured against poppler, **eleven of eleven cases come out exact** — four opacities of the same
red; at 0.34 a dashed rule, a dashed rule on a turned box, a hatch, the multiply blend and ink at
quarter and half opacity; and a translucent PNG at four combinations of image and mark opacity.
So the file we write is right by that renderer, and none of the three geometry parity suites was
ever looking at colour — a new one, `colparity.py`, is.

But `#c5aeae` is not a random wrong colour. Take the fill **premultiplied** by its own opacity —
0.34 × (250,50,55) = (85,17,19) — and composite *that* over white at 0.34 **again**, and you get
(197.2, 174.1, 174.8). Ced's render is (197,174,174): three channels, within one unit. That is the
alpha applied twice, which is what a viewer does with an appearance stream composited as a
non-isolated group. A form XObject that paints with transparency is supposed to declare one and
ours did not, so the viewer was free to choose and some choose the reading that darkens. Every
appearance stream now carries `/Group << /S /Transparency /CS /DeviceRGB /I true >>`. Poppler's
answer is unchanged to the pixel; the viewers that were guessing stop.

---

## v55

**The grips put right, and the picture editor rebuilt the way Ced drew it.**

**A grip is 22px, centred, and shrinks only to clear the corners** (`6n2`). Ced, at v54's answer:
*"the top and bottom are off centered. the left and right are now too small or too big"* · *"i did
not say to make the length bigger. also, if it was smaller, make the side dragger at least like the
corner dragger."* Both faults were mine, in `6mx`:

- it read *"adjust the length"* as *the box's own height less the corners*, which gave a **288px
  pill on a 314px shape** and **6px on a 19px note** — measured, both;
- and it added `right:0` to a rule that already said `left:calc(50% - 11px)`. An absolutely
  positioned box with a definite left, right and width is over-constrained, and auto margins settle
  it by splitting the slack **equally** — which put a 22px pill's centre **13.8px** off on the small
  box and **71.5px** off on the big one. Exactly where the screenshots showed it.

22px is the length again, for every grip on every box. It shrinks only as far as it must to clear
the corners, and never below the corner's own 11px. On the 19px note that leaves **5.8% of a corner**
covered — the two things asked for cannot both hold in the 9px the corners leave, and the 11px floor
is the one Ced chose. On anything larger, **0%**.

**The tools run down the left of the picture** (`6n3`). Ced: *"instead of a top bar, make the tool
bar on the left of the photo ui for better space management. make the tools be separated by the same
separator on the ribbon, but horizontally."* The card is landscape and a fitted picture is usually
tall, so the room going spare was at the sides and the room being spent was at the top. The
separator is the ribbon's own — 1px dotted — turned from `border-right` to `border-bottom`.

Measured at 1512x923: the stage goes from **under 60% of the card's height to 75%**. The first
attempt put the zoom block in the rail too, which came to **907px of tools in 636px of rail** — Crop
and Apply below the fold, and a click aimed at one lands on the backdrop and closes the editor. Zoom
is a view control, not a tool, so it went to the base strip; with that and a 22px button the rail is
**622px in 622px**, and nothing is out of reach.

**Free, border, undo and redo at the foot** (`6n3`). As asked. The sliders come out at **409px and
390px** on the fixture, against 94 before v54.

**A box nib** (`6n4`). Ced: *"add a box brush on edit photo."* A round nib cannot clear up to a
straight edge or into a corner — it leaves a scalloped margin and a quarter-disc of ink. The nib is
a property of the brush, not a tool of its own, so Erase, Restore and the pen all take it through
the one `strokePath`. A square sweep is drawn as a union of squares stepped along the segment rather
than as a stroked line, because a stroked line with a square cap is a rectangle *perpendicular* to
the direction — right along the axes and too narrow on a diagonal, which is where a gap would open.
Measured on one dab in its own 40x40 square: the round nib takes **78.1%** of it (a disc is pi/4,
78.5%) and leaves all four corners; the square takes **100%** and all four corners. The brush ring
becomes a square to match.

---

## v54

**A zoom that stays sharp and lands where the pointer is, and the small-box grips untangled.**

**A zoom started off the paper holds the paper's nearest edge** (`6mv`). Ced: *"the tool just goes
back to the pdf like this if zoomed in from the free space. if zooming on the right most, just zoom
of the right most of the pdf."* The anchor was the pointer, converted to a fraction of the page —
and a pointer out in the grey gives a fraction outside 0..1, which the restore then honoured, so the
sheet flew off to wherever that fraction pointed. The fraction is clamped to the page now, so a zoom
from the grey on the right holds the page's right edge. Measured, pointer at x=1414 and eight
notches in: v53 left the right edge at 1098, 502px the wrong side of the pointer; v54 lands it at
1414, 0px off.

**A zoom stays sharp while the hand is still moving** (`6mw`). Ced: *"zooming in it gets
pixelated"*, and then, after I offered to oversample: *"I want to measure how long the blur actually
lasts before picking that factor."* So it was measured first. After the last notch the page is sharp
again in **76-90 ms** — imperceptible; the softness is entirely *during* the gesture, where it
reached 1.30x at three notches and 2.00x ten notches in. The canvas is now drawn at up to 1.6x the
displayed size (`OVER_WANT`), capped at 6 MPx per page so a large sheet steps the factor down rather
than eating memory. Render cost across factors on the same three sheets was flat — x1.0 5/18/43 ms,
x1.6 11/21/34 ms, x2.0 15/14/21 ms — at 4.2 MB to 10.7 MB per page. Softness after: **1.00** at
three notches (was 1.30), 1.25 ten in (was 2.00).

**A side grip never covers a corner grip, however small the box** (`6mx`). Ced: *"when the textbox
is so small, adjust the length of the left or right dragger and dont overlay or cover the four
corner circle draggers to not make it hard for the user to click those draggers."* The side pills
ran the full edge, so on a one-line note they sat on top of all four corners. They are inset by
26px now — `max(6px, 100% - 26px)` — which on a 19px-tall text box leaves a 6px pill clear of every
corner, and on a 238px shape still gives a 212px grip.

**Ctrl on a text box's top or corner grows it about the middle** (`6mz`). Ced: *"using ctrl on text
box if dragged on the top or bottom and corners should just adjust the text on both sides, same idea
of the ctrl used to adjust the left and right."* v51's rule read the modifier on the two side
handles only: a top handle moved its own edge, and a corner fell through to the shape rule and
squared the note off — measured, a Ctrl-drag of `se` left a 280x280 square. One rule now: on a text
box Ctrl means the centre stays put, and whichever axes the handle touches grow by twice the drag.

**The settle no longer lays everything out twice** (`6my`). Dropping the oversample in pushed
`layoutAnnos` to 18 calls against a budget of 16 — not the raster's doing: `resharpenSoon`'s tail
still ran `layoutAnnos()` and `drawAllLines()`, redundant since v51 moved both into `rezoomPages`.
One definition, not two: 10 calls. The picture editor's brush ring moved from the translucent
`.sk-edit` to the opaque card in the same change, after a sweep slowed to 36.7 ms against a 33 ms
budget with the ring repainting the backdrop every frame.

**The free and border sliders get a row of their own** (`6mx`, then `6n0`). Ced, three times:
*"have the free and border slider longer to have more control in adjustments."* 6mx took every pixel
the tool row had left — 94px, with 96 the last width that keeps that row to one line and 104
wrapping it. The row was the limit, so the sliders came off it: they share a row of their own under
the two tool rows, each track taking what the card has left. Measured in the editor at its own
width: **623px and 603px** against 94 — a tenth of a degree a pixel on the free turn, where it was
two thirds of a degree, and 50 pixels a step on the border, where it was eight.

**Two more faces that travel with the file** (`6n1`). Ced: *"add more font options."* **Carlito**,
which is metric-compatible with Calibri — the face the Word and Excel paperwork around these reports
is set in, so a note written here and a line pasted out of the tracker are the same document — and
**Archivo Narrow**, condensed, for the one thing a redliner runs out of: room. A value that will not
fit a table cell in Arial fits in this at the same point size; measured, a line of it is 0.85 of
Arial's width. Both are OFL, both ship all four cuts, and both are subset and embedded exactly as
Jost is, so the screen and the exported file are the same font rather than cousins —
`textparity.py` holds them to it: with the export falling back to Helvetica the two marks land 13pt
and 11pt out, and with the faces embedded they are inside the 2.5pt allowance the bundled Jost case
has. The artifact grows 1.67 MB to 1.81 MB.

---

## v53

**The selection chrome, as Ced drew it — and the grey frame v52 put on every shape taken off again.**

**A shape with no border wears none** (`6mr`). Ced: *"for some reason, shapes with no border are
showing with grey borders in preview."* My own doing in v52: the light frame on an empty text box
was written as `.ed:empty`, and a shape's interior is a contenteditable box too — so every
unlabelled box and ellipse on the sheet wore a frame it had never been given. It hangs off
`[data-ph]` now, which is the same condition the prompt itself is written under, so the frame and
the words it frames cannot disagree about whose box they belong to.

**A new text box is the width of its own prompt** (`6mr`). Ced, after v52's 100pt: *"text box is
again too big, make it one layer and just the width of 'Add text here'."* 100pt was a guess at eight
characters. It is measured now — what *Add text here* comes to in the face and size the box is about
to be written in — so it stays right at 6pt and at 24pt. 77px against a 71px prompt on the fixture.

**Delete and drag on the right, the turn alone in the middle** (`6mr`, `6mt`). Ced: *"make the x
button on the right side of the selected item as well not on upper right"*, then *"rotate should
always be in the middle of the selected item. so make the x button and drag button both on the
right and make the rotate solo so its always in the middle"* · *"apply this to all selectable
items."* 6lw centred the ROW of controls, which put the turn in the middle of the row rather than of
the mark — and since a picture has three and everything else has two, the turn moved sideways
depending on what you had selected. It is under the mark's own centre at every count now, measured
at 0px off on a box, an ellipse and a picture alike.

**The angle is typed on the mark** (`6ms`, `6mt`). Ced, with a screenshot of the dialog: *"this is
still showing when rotate was clicked, change it to what i asked to be."* 6hb opened a dialog in the
middle of the window over a dimmed sheet — for two keystrokes, it covers the drawing you are turning
the mark against and moves your eye away from the mark and back. It is a chip beside the mark now,
below the turn and drag grips (*"make the input for degree lower than the drag and rotate icon"*),
focused and selected, Enter turns and Escape leaves. A stroke and a multi-selection get the same
chip, because *"apply this to all selectable items"*.

**A smaller grow, on every grip there is** (`6mr`). Ced: *"the enlargement of dragger should not be
too big, just enough to make the user know the part they're using."* 1.45 was a lurch — an 11px grip
jumping to 16px moves further than the hand does; an eighth reads as an answer without looking like
a change. And it covers a stroke's point grips too, which needed `transform-box:fill-box` to scale
about themselves rather than about the page's origin.

**The brush ring is never clipped** (`6mu`). Ced: *"bring the size preview of the edit photo tool
always in front of ui"*, with the ring sliced in half at the top of the canvas. It lived inside the
picture's own wrapper, in a stage that scrolls, so the half that reached past the edge was cut away
— exactly where it matters, because the edge is where you are being careful about what a sweep will
take. It is on the editor's full-window overlay now, in client coordinates.

**Suite:** 214 checks in `tools.py`, **66** behaviours in `behave.py`, 19 wysiwyg marks, 10 text
marks, 4 stamp lines, every shortcut, photo reopen, scenarios v19/v14/v12. Four cases proved to fail
with their own fix reverted. **Three existing cases were corrected rather than relaxed**, and each
says in its own words what changed and why: `tools.py`'s *Rotate can be typed* asked for the dialog;
`behave.py`'s *Edit on the left, the turn in the middle, drag on the right* asked for 6lw's row; and
the first cut of the new border case demanded `0px` of border on a shape — which is wrong, because a
shape's border IS its own stroke. The thrash case also caught `6mp`'s cursor pass costing 14.7ms
against its 14ms budget on a 40-mark page; gated on there being a rotation to correct, it is 7.9ms.

---

## v52

**A document on screen in half the time, a quieter view while you are adjusting a mark, and a text
box that starts the size of what you are about to type.**

**A redlined document opens in 1.7 seconds instead of 3.2** (`6mm`). Ced: *"viewing pdf should also
be seamless."* Timed from the click to the first page, 1,660ms of the 3.2 seconds was
`detachOurRedlines` — the step that lifts our own marks out of a file before pdf.js sees it — and
taken apart it was two lines of that function and nothing else:

```
PDFDocument.load, as it was called      404 ms      parseSpeed Fastest   115 ms
save({useObjectStreams:false})        1,164 ms      save()               218 ms   (and 4.2MB, not 4.8)
recoverPhotoSrcs                          1 ms
the annotation walk                       0 ms
```

Both settings bought a property nothing downstream uses: the slow parse is a recovery path whose
failure case is already handled by leaving the file alone, and those bytes are never a file — they
go to pdf.js and to the export, both of which read object streams. The export's own save is
untouched, because that output *is* a file.

**The standing pictures stay out of the way** (`6ml`). v51 rendered one per page in a row with
nothing but a rAF between, and pdf.js cannot yield: measured over the six seconds after an open,
**25 long tasks and 4,065ms of them**, in the window where you are scrolling to find your sheet. Two
changes. A page that has been drawn already has a better picture than the base — shrinking its sharp
canvas is **0.2ms** against 6–46ms for a second render — so every page you visit now pays nothing.
What is left waits for a gap: nothing renders within 650ms of a wheel, a scroll, a pointer or a key,
and an idle slot is asked for where the browser offers one. Measured after: a zoom in that window
has **no long task at all**, a scroll has one of 54ms.

**A quieter view while you adjust** (`6mn`). Ced: *"the preview should look like this to not cover
the space being edited and then once the user is not holding the text anymore, go back to the
previous view"* · *"this adjusting view should apply to all items, redlines, shapes, lines on the
ui."* A selected mark wears eight grips, a ✕ and four handles, and every one of them sits where the
edge you are dragging is. For as long as the pointer is down they all go — for a mark, a group and a
stroke alike — and the mark is backed by a wash the size of its own box. `box-shadow: inset` is the
one way to lay a colour over a mark's ground and under its ink, so the words stay their own red on
the wash instead of going through it. One switch, and the release is written once: every gesture
calls `adjustBegin()`, and the pointer coming up anywhere ends it.

**A new text box is one line, and says what it is for** (`6mo`). Ced: *"don't make the text box big,
just one layer and small width first."* A click gave 150pt by two lines of leading — a block on the
drawing before a character had been typed. One line and 100pt now, with a grey *Add text here* and a
light frame that are a CSS `:empty` state, so they are never in `a.text`, never in the export, and
gone with the first letter. A box dragged out still keeps exactly the size it was dragged.

**A turned mark's cursors point where its edges now are** (`6mp`). Ced: *"the changes in cursor
especially when adjusting corners of a rotated item should not be based on the previous orientation.
it should be based on the current orientation."* The grips carry their cursor in CSS, which is a
statement about the unrotated box. The right one is the grip's own bearing plus the mark's rotation,
to the nearest 45°, folded into a half turn — set in `setMarkSpin`, which is the one place a mark's
rotation is applied.

**The rotation arm, and a grip that answers** (`6mq`). Ced: *"the blue line in the middle when
rotating should be solid and firm"* — it was a 1.5px hairline at 95% against a drawing made of
hairlines; it is 3px, opaque and round-capped, so the dashed grey cross reads as the reference and
the teal line as the hand. And *"when hovering to the dragger of the edit, make the holder get big a
little"*: every grip grows a little under the pointer, on a transform, suppressed while adjusting
with the rest of the furniture.

**Suite:** 214 checks in `tools.py`, **62** behaviours in `behave.py`, 19 wysiwyg marks, 10 text
marks, 4 stamp lines, every shortcut, photo reopen, scenarios v19/v14/v12. Three new cases, each
proved to fail with its own fix reverted (a two-line 180px box with no prompt; eleven grips still
showing mid-drag and no wash; all eight cursors unchanged at 45°). A fourth, timing the open, was
written and then **removed**: it passed on the reverted build too, because the behave fixture is
five pages where the measurement was taken on forty-five — a case that cannot fail is worse than no
case, and `reopen.py` already guards what the faster parse could actually break.

---

## v51

**v49 traded the redlines' sharpness for a zoom saving that was never worth having, and v50 shipped
it twice.**

**The marks are drawn at every notch again, not stretched to it** (`6mi`). Ced, three times: *"the
loading of pdf is too slow"* → *"zooming in and out is making the preview of the redlines all messed
up"* → *"zooming in it gets pixelated."* v49's `6mc` gave the marks and strokes the same CSS stretch
6gr gives the canvas. Their geometry was right and v50's new case proved it — measured through a
whole ten-notch gesture, the worst any mark moved was **0.0013 of the page** — which is why "still
messy" was not a positioning bug and why v50 looked for one and found only the run-SVG double scale.
What Ced was looking at is that a redline drawn at one size and scaled by CSS is a stretched bitmap
of itself for the length of the gesture: text goes soft, a 2pt rule comes out at 2.2pt, every edge is
resampled.

It was not even a saving worth having, and the numbers were in the v49 notes all along:
`layoutAnnos` is **8.2ms at 167 marks** against **61–204ms for one page of pdf.js**, and a notch is
already frame-bounded because the wheel handler batches to one `setZoom` per rAF. v48's nineteen
calls came from `resharpenSoon` and from renders landing mid-gesture, never from the one call a
notch makes. Drawing them every notch, on the 167-mark construction set:

```
                       v48 (19 calls)   v49/v50 (stretched)   v51 (drawn, once a frame)
p95 frame                  61.6 ms            24.9 ms                 30.8 ms
worst frame                85.7 ms            68.3 ms                 48.7 ms
long tasks               8 (max 90ms)      1 (max 61ms)                  0
```

Six milliseconds of p95 for crisp redlines at every instant — and a *better* worst frame and no long
tasks at all. The canvas still softens: that is the part that costs.

**Every page keeps a picture, so none is ever blank** (`6mj`). Ced: *"make the pdf file preload and
then retain that in the viewer so there will be no lag."* 6m7's queue and the observer's
`unloadPage` are both right and have the same consequence — at any moment most of the document has
no pixels, so scrolling to page 30 asks pdf.js for it from nothing and scrolling back pays again.
The sharp canvases cannot be kept (an 11×17 sheet at 3.5× is 12 megapixels, 48MB, and a site package
is forty-five of them), so a **second, small, fixed picture** is rendered once per page and kept for
the life of the document: a 360,000-pixel budget a page, CSS-stretched to the page box at all times,
sitting under the sharp canvas. Measured on a 45-page site package: every page has one about **ten
seconds** after the open, **62MB** in all, and a scroll from end to end and back shows **no blank
page at all** where v50 showed two. The preload runs only while the sharp queue is idle, nearest page
first, so it can never be the reason the page under your eyes is late.

**The border has room to be a border** (`6mk`). Ced, with a cut-out whose outline is sliced flat
along the top and left: *"the border seems to get cut. make the space in edit photo expand as border
expand too."* An outline grown by *v* needs *v* pixels of paper outside the shape and a cut-out has
none — `skMaskGrow` stops at the canvas edge. The canvas grows by *v*+1 on every side instead,
exactly as the free turn's canvas grows to hold its corners, and the mark on the sheet grows with it
with no new code: `put` already recomputes `nw`/`nh` about the mark's centre whenever the canvas has
changed size. Measured on a shape drawn hard against the corner: 380×320 → 394×334 at 6, with **zero
ink left on the very edge**, and 0 returns the canvas to exactly 380×320 and the ink to exactly what
it was.

**Suite:** 214 checks in `tools.py`, **59** behaviours in `behave.py`, 19 wysiwyg marks, 10 text
marks, 4 stamp lines, every shortcut, photo reopen, scenarios v19/v14/v12. Three cases proved to
fail with their own fix reverted (3 layers stretched and a 71.5px gap between a mark's painted and
laid-out width; 0 standing pictures and 2 blank pages; the canvas unchanged with 537 ink pixels on
its edge). v50's *"A zoom does not rebuild the redlines on every notch"* asked for the rule this
version reverses, so it is now *"A zoom keeps the redlines crisp, never a stretched copy of
themselves"* and says why it changed.

---

## v50

**Four things Ced sent a video of, and three of them were measured on the wrong picture.**

**Every stroke slid off its drawing during a zoom** (`6me`). Ced: *"zooming in and out is making the
preview of the redlines all messed up."* v49's `6mc` stretches the three mark layers with a
`scale()` while the canvas is soft, and stretches the page's stroke SVGs the same way. But a page
owns only two `svg.draw` elements; every OTHER one — `svg.draw.run`, which is where ungrouped
strokes are actually drawn, plus `.ingroup` and `.selui` — lives *inside* one of the layers being
scaled, and a bare `querySelectorAll("svg.draw")` caught them all. Measured on one notch of
ctrl-wheel, as a fraction of the page: the run came back **1.1006 wide against a page of 1.0**. Ten
percent too big, which on a sheet of redlines is every mark at once. `:scope >` is the whole fix.

**A page that has not been drawn says so** (`6mf`). Ced: *"add loading animation on pages not yet
loaded."* 6m7's queue is right to make a page wait its turn and had no way of saying so — an undrawn
page is a white rectangle, which is what a blank sheet looks like. It is a ring on the page's own
`::after`, shown by `.page.near:not([data-rendered="1"])`: `near` is the IntersectionObserver's own
crossing at 1400px, `data-rendered` is the renderer's, so there is no flag to maintain and nothing
that can be late. Two wrong versions got there first and `behave.py` caught both:

- a `data-loading` flag written when the queue took a page — **two pages on screen, blank and
  silent**, because the observer fires on a crossing and the sweep is debounced;
- a gradient sweeping across the sheet, which animates `background-position` and so **repaints a
  734x950 element every frame**. It cost enough to change what the renderer did: 21 of 21 page
  renders that a fast scroll should have dropped went through instead, and a ten-notch zoom laid the
  marks out nine times rather than three. The 30px ring animates nothing but `transform`, and both
  of those cases went green again with the animation still on.

**Auto froze the window for eleven and a half seconds, and on the wrong picture erased it**
(`6mg`). Ced: *"auto mode in edit picture is completely broken."* Every threshold in the pass is
written in units of the picture's own stroke — deliberately, so the same rule holds at any
resolution — but the work was not: `skThin` and `skPruneEnds` each walk the whole picture once per
unit of `minLen`, and `minLen` is a fraction of the picture, so the cost goes up with the **cube** of
the capture. Nobody noticed because every test picture is 560x760. A snapshot dragged over the
equipment layout of a real 45-page mount analysis is 1410x1369:

```
skAutoPass    3 calls   8,256 ms
  skPruneEnds 3 calls   5,401 ms      65% of it
  skThin      3 calls   1,595 ms
  skMaskHoles 6 calls     459 ms
the whole press        11,622 ms, on the one thread, with nothing on screen
```

The analysis now runs on a copy of at most 420k pixels and the answer is trimmed back against the
real ink, which also takes the halo off the fill. **11,622ms → 686ms**, and the subject keeps 92% of
its ink where it kept 80%. Two more: a press is answered before the thread is taken, so the bar says
what it is doing instead of going dead; and a pass that would keep less than half the ink has not
found a subject, so the picture is left exactly as it was and Auto says why — measured on a snapshot
of a page of text, which went from **98.7% of its ink removed** to not one pixel touched.

**Border outlines the shape, not the box** (`6mh`). Ced: *"it should not add a border to the box, it
must be border on the transparent shape. so if the transparent shape is final, toggling and adding
border should make the edge or outline of the shape thicker."* 6j4 made it the mark's own stroke,
which draws a rectangle round the picture's bounding box — right for a photograph and wrong for
everything this editor is used on, because by the time you reach the slider the picture is a cut-out
with a shape to it. It is pixels now: the silhouette grown by *v* and laid behind the picture, so
every edge gains *v* of the picture's own ink and nothing is painted over. `bordBase` holds the
pixels the drag started from, so dragging back to none returns every pixel, and any other operation
clears that base through `push` — after which the outline is part of the picture, as it must be.

**Suite:** 214 checks in `tools.py`, **58** behaviours in `behave.py` (four new, each proved to fail
with its own fix reverted: the run SVG at 1.1006 of the page; two silent blank pages; Auto keeping
13% of the ink; the border leaving the picture untouched and framing the box instead), 19 wysiwyg
marks, 10 text marks, 4 stamp lines, every shortcut, photo reopen, scenarios v19/v14/v12.
`tools.py`'s border case asked for the old rule and now asks for the new one.

---

## v49

**The sheet could not be scrolled to, and the redlines were rebuilt on every notch of the wheel.**

**Scrolling sideways moved nothing** (`6md`). Ced: *"the pdf is again not in the middle."* This was
not a centring error of a few pixels. `syncPageCol` positioned the reading column by comparing a
`getBoundingClientRect()` reading — which is in the VIEWPORT — against the `margin-left` it then
wrote, which is a DOCUMENT length. Scroll right by N and the rect comes back N smaller, so the margin
written is N bigger and the column is pushed right by exactly as far as you have just scrolled.
Measured on a 15-page 11x17 set at 168% in a 1900px window:

```
scrollX   0 → marginLeft   4px      sheet 78..2134      scrollWidth 2290
scrollX 156 → marginLeft 160px      sheet 78..2134      scrollWidth 2290
scrollX 300 → marginLeft 304px      sheet 78..2134      scrollWidth 2434
```

The sheet never moves. 234px of it sat off the right of the window and there was **no scroll position
that would show it** — the document just got longer as you tried. Both readings are taken in document
space now, which is the space the margin lives in. The column then stays put and the document scrolls
under the fixed rails, the way a canvas is supposed to.

**And a zoom that names no place centres the sheet** (`6md`). Ced: *"always make the the pdf center
unless zoomed in in specific place."* A ctrl-wheel names a place and the point under the pointer is
still held exactly. The + and − buttons, a fit and a keyboard zoom name none, so the sheet goes to the
middle of the window — which, once it is wider than the window, means equal amounts of it off each
side instead of flush against the left rail. Measured across the zoom range on that same sheet:

```
          sheet in the window          off-centre   cut left   cut right   left edge
 50%      644..1256                       0 px          0           0      reachable
100%      338..1562                       0 px          0           0      reachable
120%      216..1684                       0 px          0           0      reachable
168%      -78..1978                     0.2 px         78          78      reachable
250%     -580..2480                       0 px        580         580      reachable
```

Before the fix the same sweep read 104px, 312px and 569px off centre as the sheet outgrew the window.

**A zoom no longer rebuilds every redline on every notch** (`6mc`). Ced: *"the loading of pdf is too
slow"*, on a construction set carrying 167 redlines — and v48's profile had missed it entirely by
measuring a document with nothing drawn on it. 6gr's rule is that a zoom shows at once and sharpens
after: the canvas keeps its pixels and is stretched by CSS until the zooming stops. That was applied
to the canvas and the text layer and never to the marks, so `rezoomPages` called `layoutAnnos()` on
every notch, and `layoutAnnos` empties the layer and rebuilds every mark's element from scratch:

```
layoutAnnos, against the number of marks
  0 marks   0.2 ms      167 marks   8.2 ms
 40 marks   6.0 ms      400 marks  14.4 ms
```

The mark layers and the stroke SVGs are stretched with the canvas instead — a `scale()` on the layer
and a `viewBox` on the SVG, both free, both in the compositor — and laid out once when the zoom
settles. Whichever function does the real work takes its own stand-in off, in the one place it is
done: `layoutAnnos` clears the transform, `drawPageLines` clears the viewBox. A ten-notch ctrl-wheel
gesture on the 167-redline sheet, measured against v48 on the same machine in the same session:

```
                    v48                     v49
layoutAnnos         16 calls  31.5 ms        7 calls  14.8 ms
drawAllLines        16 calls  37.3 ms        7 calls  25.9 ms
drawPageLines       22 calls  57.1 ms       14 calls  44.3 ms
resizePageBoxes     29 calls  19.4 ms       20 calls  13.5 ms
p95 frame               61.6 ms                 24.9 ms
worst frame             85.7 ms                 68.3 ms
long tasks           8 (longest 90 ms)       1 (longest 61 ms)
```

A fast scroll on the same sheet goes from one long task to none.

**Three new behaviours in the suite**, each proved to fail with its own fix reverted: a sideways
scroll moves the sheet and reaches its right edge (with the reverted build the sheet moved 0px while
the window scrolled 3120px and the document grew from 2800 to 5920); a zoom with no place named puts
the sheet in the middle (reverted: 569px out); and a zoom leaves the marks where they belong having
rebuilt them about once rather than once a notch (reverted: 12). `scenario_v12`'s zoom probe claimed
the sheet's left edge is on screen at every zoom, which has stopped being the rule now that the
overflow is split evenly — it reports `centredInWindow` instead, and says why.

**Suite:** 214 checks in `tools.py`, **54** behaviours in `behave.py`, 19 wysiwyg marks, 10 text
marks, 4 stamp lines, every shortcut, photo reopen, and scenarios v19/v14/v12 — all green.

---

## v48

**The page renderer gets a queue, and that turns out to be three of the seven things asked for.**

**A fast scroll stops drawing the pages it goes past** (`6m7`). Ced: *"some pages are taking too long
to load. and some are not loading at all. also when zooming in and out, the loading is too long."*
The JavaScript was never the cost, and the profile says so plainly: a ten-notch ctrl-wheel zoom spends
**47ms inside `setZoom` altogether**, 95th-percentile frame 31–38ms. What costs is the thing a JS
profile cannot see — pdf.js drawing a page, which on this fixture is 61–88ms at 1×, 71–120ms at 2× and
**180–204ms at 3.5×**. And nothing stood between the IntersectionObserver and that work: measured on a
fast scroll, **29 renders started and 29 pages were unloaded**, about three seconds of drawing for
pages that were gone before the ink was dry, all of it competing with the page you were looking at.

One queue, three rules: one render at a time; the next one taken is the page nearest the middle of the
window; and a page is re-checked when its turn comes, not when it was asked for. Measured after: **26
of 30 renders are dropped in 0.1ms** instead of drawn in 100.

**And nothing on screen is left blank** (`6m7`). The other half: the observer fires on a *crossing*, so
a page whose render was dropped while it was already in view was never asked for again — which is
exactly the page that never loads. A sweep 120ms after the last scroll event asks for anything on
screen that is not drawn. Measured: blank-in-view goes from 1 page to **none**, after a fast scroll
down, a fast scroll back up, and a fast zoom.

**The zoom is seamless because the resharpen is serial** (`6m7`). `resharpenSoon` *started* every soft
page's render in the same turn — thirteen in flight at once on a six-press zoom. They go one at a time
now, nearest first, and any that has scrolled away by its turn is dropped.

| | before | after |
|---|---|---|
| ctrl-wheel zoom in ×10, worst frame | 56.8ms | **38.5ms** |
| zoom out ×10, worst frame | 76ms | **41ms** |
| zoom buttons ×6, worst frame | 86.3ms | **39.6ms** |
| long tasks in a zoom gesture | 1–2, up to 81ms | **none** |
| document open → first page drawn | 1.98s | **1.1s** |

**The sheet is centred in the window** (`6m8`). Ced: *"always make the the pdf center unless zoomed in
in specific place."* `margin:auto` centres the page in `#pages`, and `#pages` starts after the rail:
measured at 1500px wide, the column ran 74 to 1492, its middle was 783, the window's was 750, and the
sheet sat **33px right of centre at every zoom**. v44's 6lb widened the column and could not fix this,
because a column that starts after the rail has its middle to the right of the window's however wide it
is. The left margin is worked out from the window instead — measured after, **0.0px off** at 0.6×, 1×
and 1.6× — and the rule steps aside once the sheet is wider than the room, which is the "unless zoomed
in" half.

**Escape is two rungs** (`6m9`). Ced: *"when esc was clicked, always go to select current redline.
double esc is select tool."* 6jt built it as five — the caret, the field, the group, the selection, the
tool — and from inside a mark's text with a tool in hand that was four presses to reach Select. Press
once: the caret comes out, a half-drawn run is called off, an open group closes, and the redline stays
selected. Press again: the selection goes and Select is active. The same count from every state.

**The shortcuts, measured rather than assumed** (`6ma`). Ced: *"ctrl a, s, c, v, x, y, and del are not
working well all the time."* Every one of them, in nine states — nothing selected, a mark, a stroke, a
multi-selection, straight after drawing, with a ribbon control focused, with the properties popup open,
with the caret in a mark, with the caret in Find. **Seventeen of eighteen already worked.** The one that
did not: Ctrl+C and Ctrl+X with the caret in the Find box, which handed the key to the browser to copy
an empty selection in a search field. 6gu had already worked out the right rule for a mark — with text
under it, it means the text; with none, it means the drawing — and simply had not applied it to the
ribbon's own fields. Ctrl+V is deliberately left alone: pasting a search term is a real thing to want.

**Snapshot and Insert photo wear Ced's own marks** (`6mb`). A bracketed camera and the same frame with
his file in it, replacing U+25A3 and the picture emoji. Ced: *"just use the logo is sent no need to
replicate it"* — so they are **traced from the artwork**, not drawn by eye: `tools/traceicon.py` takes
the pixels through marching squares and Douglas-Peucker, and `tools/composeicon.py` builds the second
mark by rasterising the frame and the file together and tracing once, so there is no seam where two
separately-fitted outlines would meet.

**Verified.** `tools.py` 0 failing · `wysiwyg` 0/19 · `textparity` 0/10 · `stampparity` 0/4 ·
`behave` **0 of 52** (seven new) · `keys` all · `reopen` photos survive. Every new case was confirmed to
fail with its fix reverted.

---

## v47

**One language for every selection, and a picture editor that stops growing.** Twelve items, six of
which arrived mid-turn.

**The three grips read left to right: edit, turn, drag** (`6lw`). Ced: *"it makes more sense to put
the rotate in the middle, edit on left and drag on right."* Rotate is the one of the three that acts
on the box as a whole and about its own centre, so the middle is where it belongs — it sits under the
point it turns about.

**Every control stays the right way up** (`6lz`). Ced: *"when a redline is rotated, always make the
arrows of up and down layer retain the up and down orientation … retain this principle to all icons."*
A mark is turned by a `rotate()` on its element and everything inside turns with it. Measured at 30°:
the mark's transform was `matrix(0.866, 0.5, -0.5, 0.866, 0, 0)` and `.lup`'s was `none` — the
up-arrow was wearing the mark's angle, and past 90° it pointed down. The mark carries the turn and
each control cancels it, so the two matrices now multiply to the identity at every angle. The
controls still orbit the box; that is what says which box they belong to.

**The rotation cross hugs the shape** (`6lx`). Ced: *"make the grey lines only stretch up to the shape
… just a little extended."* Measured before: on a 734 × 950 page the two dashed axes ran `0 → 734` and
`0 → 950` — full rules cutting the drawing in half over a mark two inches across. Each axis is the
mark's own half-extent plus 16px now, recomputed from the angle each frame, because a rectangle's
extent changes as it turns.

**The angle reading lies down** (`6ly`). Ced: *"the input for the angle should be just a small prompt
… just always make it horizontal."* 46.1 × 44 stacked becomes 82 × 23.5 side by side, with
`white-space:nowrap` and an explicit `writing-mode` so nothing outside it can stand it back up, and a
clamp that keeps it inside the window.

**The picture editor's tools fit two rows** (`6m2`). Ced: *"make the tools at least just two rows …
separated by the same separator on the ribbon. make sure neumorphism is also in tach."* Measured in
his own 1471px window: four rows, each bar needing ~1720px of content against 1393px of room. Twenty
per cent came off in four places — the group plates become the ribbon's 1px dotted rule, the buttons
tighten, the type drops to 11px, the sliders shorten — and five labels were shortened. Nothing was
removed, nothing moved, and the emboss is untouched because it lives on the button, not the group.

**A free turn takes the smallest room it can** (`6m0`). Ced: *"do not make the selection or canvass
bigger every rotate."* Measured, sweeping ±10° four times on a 749 × 912 capture: 896×1029 → 1062×1169
→ 1249×1336 → 1463×1533. Nearly double, for nothing. Two causes: each turn resampled the *result* of
the last one, and nothing trimmed the empty corners. A run of free turns now resamples the pixels the
run began with by the accumulated angle, and the result is trimmed to its own ink. Measured after:
885×1029 → **749×912** → 885×1029 → **749×912**.

**The chequer stays square to the screen** (`6m0`). Ced: *"make the transparent background be still so
the user have visual cues if the shape is straight."* It was the turning element's own background, so
the one reference that could tell you whether an edge had come square was turning too. It is a
clipped, counter-rotated child now.

**Crop opens on the picture's edges** (`6m1`). Ced: *"crop should also come from the edges of the
photo, not dragged by the user."* Measured on entering the tool: zero painted pixels on the overlay —
nothing at all until the hand moved. The box now starts as the whole picture with a grip on every
corner and edge, nothing is cut until Apply, Escape leaves the picture alone, and dragging a fresh box
out of empty space still works.

**The selection bar's names sit level, and the band under it is gone** (`6m3`). Ced: *"make the texts
align middle, also what is up with the bottom part of the tool."* Every label began at the same y, so
a one-line name sat at the top of the two-line block its neighbours fill; the label block is a fixed
two lines and centres in it. The band is the horizontal scrollbar, painted with square corners inside
a 999px radius — the track is gone on all three engines and the bar still scrolls.

**A narrowed text box covers its own text** (`6m4`). Ced: *"text wrapping issue not yet solved. make
the default break inside a line. but the text should be all covered"*, and *"make sure the size of the
textbox the user puts is granted."* `growTextBox` was called from typing and pasting and nowhere else,
so narrowing a box with a side handle re-wrapped the text in the same height and the extra lines hung
out of the bottom. A text box also breaks inside the word again by default. Measured: width kept at
0.03542 exactly, height 0.06 → 0.0926, overflow −0.8px.

**The text tool previews a box, not a slab** (`6m5`). The text tool shares the box tool's drag, so the
shape ghost was painting the ribbon's fill over a mark that will never have one.

**One design for every box** (`6m6`). Ced: *"apply the updated colors of icons (grey) in all
redlines"*, and *"also be consistent on all designs of the boxs."* v46 greyed a single mark's five
controls and left the group's trio and the stroke's in selection blue — three sets of the same three
buttons, and which you got depended on what you had clicked. All three now read from the same
`--ctl-*` tokens at the same size.

**Verified.** `tools.py` 0 failing · `wysiwyg` 0/19 · `textparity` 0/10 · `stampparity` 0/4 ·
`behave` **0 of 45** (twelve new) · `keys` all · `reopen` photos survive. Every new case was confirmed
to fail with its fix reverted — and the chequer's case caught a real one: the counter-rotation was
written inside a `try` in the wrong function and had never run. Seven `tools.py` cases were corrected
rather than relaxed, and every editor button now carries a `data-k` handle so a label may be reworded
without breaking a test again.

---

## v46

**One stack for marks and strokes — which turns out to be three of the nine things asked for.**

**A line can rest on top of a photo** (`6ln`). Ced, twice: *"the lines still don't have layers"* and
*"they should also be able to rest on top of photos and other redlines"* — and separately *"the blue
dragger of the line is not visible as it rests below the redline."* All three were one fault, and it
was structural. A stroke was drawn into `svg.draw` and a mark into `.annolayer`, two sibling layers at
z-index 7 and 8, so a stroke was below every mark **by construction**, however many times you pressed
⤒. Worse, the two kinds kept separate z sequences, each renumbered 1..n inside its own array, so a
mark's z and a stroke's z were two scales that could not be compared at all.

One band, one sequence. `bandList` is every mark and every stroke in a band, `bandRenumber` gives them
one gapless order, and front / back / step all work on that list. On screen a stroke is drawn into a
**run layer** inside the mark layer — one SVG per unbroken run of strokes in the order, so a stroke
can sit between two marks; measured on the fixture that is 1–2 SVGs for a band of 25 items. The export
follows: two bands rather than four, each sorted by the one z.

**One press steps past what it overlaps** (`6lo`). Ced: *"if a page has 100 redlines, and two are
overlapping … the user clicking the up layer should not take 9 to ten clicks to swap with the item on
top."* The step was already "past the nearest neighbour" — but nearest **by z**, over everything in
the band, and most of what sits between you and the thing covering you is somewhere else on the sheet.
The neighbour to step past is now the nearest one above that actually **touches** the block's own
rectangle, falling back to nearest-by-z when nothing overlaps. Measured — line at the bottom, photo at
the top, twenty marks between that it does not touch: **21 presses became 1.**

**A selected stroke's handles are always on top** (`6lp`). They were drawn in the stroke's own layer,
so a stroke deliberately under a mark had its controls under that mark too. A mark's furniture has
lived in `.annoui` since 6is; a stroke's belongs there for the same reason. Where a stroke sits in the
stack is a decision about the drawing; where its handles sit is not.

**A box that wraps grows down to cover its text** (`6lv`). Ced: *"if the text wraps, the text box
should extend below to still cover the text"* — which pulls against his earlier *"do not change its
text box size after the fact."* They only conflict if height is read as fixed. **Width is the
decision** — it chooses where the words break and may never move. **Height is a floor** — the box will
not shrink below what the hand gave it and will grow below to cover the words. Measured on a
hand-narrowed box: the text overflowed by 11.9px before and is inside the box after, with the width
unchanged to five decimal places.

**A photo is never flattened** (`6lq`). Ced: *"do not flatten the photos so it can be editable on
other editors."* Flattening paints a mark into the sheet, which is right for a redline nobody should
be able to drag and wrong for a photo: exported as a Stamp annotation it can still be moved or deleted
in Bluebeam or Acrobat. Pictures are kept out of the flatten rather than the button being removed — a
selection of a note and a photo flattens the note and says so.

**The selection bar** (`6ls`): equal columns rather than natural widths, so the row reads as a row of
controls and not a ragged line of words — the spread across twelve buttons went from tens of pixels to
**4px** — with long names breaking to two lines, and the bar rounded to a pill.

**The controls round the box** (`6lt`): a hairline grey ring and a grey glyph instead of five blue
discs competing with the blue frame they hang off, filling light grey under the pointer. The resize
grips stay blue: they are the selection itself.

**The rotation** (`6lu`). Ced sent a picture and said *"apply this animation when rotating"*: the mark
on a pale ground, a dashed cross through the point it turns about, an arm out to the hand, and the
angle read twice — where it is now, and how far it has come. One number cannot answer both questions a
hand asks while turning something. None of it exists at rest.

**Seven new `behave.py` cases**, each confirmed to fail with its fix reverted — thirty-three
behaviours. Two older cases were reconciled rather than relaxed: `tools.py`'s stroke-stacking case
asserted the four-layer DOM that 6ln replaced (every behaviour in it still passes; the structural half
now asks whether the run layers are inside the mark layers and carry a z-index), and `behave.py`'s
"keeps the size the hand gave it" asserted a fixed height where 6lv makes it a floor.

**Not reproduced**: *"text wrapping is not working well in newly added texts."* Measured six ways —
drawn wide, drawn narrow, click-made, a tall box, while the caret is in it and after committing — and
in every one the screen's line breaks match the exporter's exactly and the block is vertically centred
as the export places it. The later message about the box covering wrapped text was the fault, and that
is fixed above; if something else remains, it needs the specific text.

---

## v45

**A zoom that does not throw the document away, a selection you can see and grab, and a bar that says
what its buttons do.**

**Zoom** (`6lh`). Ced: *"zoom in and out are again very slow … i am experiencing lags."* Every notch
was calling `setupVirtualization()`, which disconnects the IntersectionObserver and builds a new one
over every page — and a fresh observer delivers an entry for **every** element it is given, whether
or not anything changed. So each notch produced one record per page and unloaded every page off
screen, throwing away canvases the next notch had to draw again. Measured on the 32-page fixture:

| ten-notch wheel zoom | before | after |
|---|---|---|
| `unloadPage` calls | 300 | **0** |
| observers rebuilt | 10 | **0** |
| frames rendered in the gesture | 102 | **545** |
| 95th-percentile frame | 94.6 ms | **16.8 ms** |
| long tasks over 50 ms | — | **none** |

None of that work was ever needed: an observer watches ELEMENTS, and 6ep made a zoom keep every page
div. Rebuilding is only right after `renderAll`, which is where the other two calls already are.
Scroll, drag and idle were measured too and were already clean (p95 17 ms, worst 38 ms), so this one
cause was the whole of both complaints.

**The selection frame** (`6lj`). Ced: *"make the blue lines in display all even."* Measured on his
own capture, the 2px ring painted **2, 2, 2 and 3** pixels across and **2, 2, 1 and 2** down. Two
causes. The frame took `left`/`top` from the mark — a fraction — while taking width and height from
`offsetWidth`, which is rounded, so opposite edges fell on different sides of a half pixel. And THREE
rings were being drawn: `.anno.sel` carries one, the frame is itself an `.anno.sel`, and a picture's
`.ed.imgwrap` has an outline of its own. The frame now rounds and then nudges itself by whatever
fraction the page's own position leaves (rounding inside the page is not enough — the page is centred
in the free space and rarely lands on a whole number), and the mark under it stops drawing its ring
while the frame is up. Measured after: every scan line through the box reads **2, 2**.

**A press inside the selection moves the selection** (`6ll`). Ced: *"all dragger or tool drag should
be shown above the redlines and you should be moving the selected redline."* The handles were already
right — `elementsFromPoint` at the move grip answers the grip, and dragging it moved the selected
mark. The BODY was not: at the centre of the selected mark the topmost element was the OTHER mark's
`.ed`, so a drag that began inside the box you were working on picked up whatever lay over it.
Overlap is the normal state of a marked-up drawing. A click is still a click: `dragBody` does nothing
until the pointer passes the slop, so a press that never moves selects the mark actually under the
hand — drag what you are holding, click to pick up something else.

**The selection bar says what it is** (`6li`). Ced listed the names he wanted and asked for *"names on
the icons … small and all caps, kind of similar to the headers on the ribbon."* 6jf had left nine of
these wordless on the argument that hover says what they are; hover is not a label, and it does not
exist on a tablet. The word goes UNDER the glyph instead of beside it, so a button is as wide as its
own word and the bar stays one row. The type is the ribbon's own group header — 8px, 800, .1em,
uppercase. The lock's glyph and word turn red while it is on, which is the one state worth reading
across the room.

**An edit grip on every picture** (`6lk`). Ced wanted the picture editor *"beside the drag for easy
access"*, and *"if the photo was from a snapshot markup on tool, not only on added image photos."* It
is a round control next to the move grip, and the row of three re-centres under the box. On the
second half: measured first — the bar and the right-click menu already offered it for a snapshot, so
the grip is the thing that was missing, and it appears on any `kind:"img"` mark, photo or snapshot or
placed markup alike.

**A line's first point shows** (`6lm`). Ced: *"show the first point of a line if only inserted by
click and not dragging."* `clickRunArm` built a ghost from (x,y) to (x,y) — a stroke of zero length,
which draws nothing — so until the hand moved, a click that landed and a click that missed looked
identical. A dot in the stroke's colour inside a white ring, cleared by Escape with the run.

**Layers on lines** — Ced asked for these; measured before changing anything, a stroke already carries
`lay`, `maLayerStamp` assigns it, the bar shows its layer and moves it, `maLayerCount` counts it, and
hiding the layer takes the line off the screen and out of the export. Nothing to add, so nothing was
added; `behave.py` now has a case so it stays that way.

**Seven new `behave.py` cases**, each confirmed to fail with its fix reverted: the even ring, the
named bar, the edit grip, the overlap press, the line layers, the first point, and the zoom's cost.
Twenty-six behaviours. Three `tools.py` cases were corrected rather than relaxed: one matched the
properties button by its visible text (now by title, which is the stable handle), one asserted the
frame's `left` string equalled the mark's (now within a pixel, which is what the pixel snap allows),
and one expected the lock's old bare title.

---

## v44

**Nine things, and the two that could lose work are first.**

**Photo redlines survive a reopen** (`6le`). Ced: *"the photo redlines are not being kept when a pdf
was reopened on the tool."* This is 6fg's fault arriving by a second door. A photo's pixels live in
its annotation's own appearance stream; carrying a second copy in the re-edit payload or in the
mark's tag pushes those strings past what pdf-lib's `decodeText()` can read back, and an unreadable
payload loses every mark in it. 6fg wrote `delete o.src` in one caller and stopped there — and
`srcOrig` (6gs) and `picRaw` (6jb) have each held a whole picture since. Measured on three photos
that had been through the picture editor, which is all it takes to set `srcOrig`:

| | before | after |
|---|---|---|
| each photo's `MAPhoto` tag | 1,035,409 chars | 353 |
| the re-edit payload | 3,106,394 chars | 1,226 |
| the exported file | 21.7 MB | 6.2 MB |
| photos that came back | 0 of 3 | 3 of 3 |

The rule is now a function — `_stripPicBytes`, over a `PIC_FIELDS` list — used by both writers, so a
fourth field cannot be added without passing through it, and `_tagEnc` says so out loud if one ever
is. `picRaw` is recovered by cropping the framed picture's inner rectangle, which is exact because
the frame is stamped around the original and the original is drawn back on top of it.
`test/reopen.py` is new and fails on the two string lengths alone, before a photo has to go missing.

**The sheet sits in the middle** (`6lb`). Ced sent a capture of an 11x17 drawing jammed against the
right edge with 476px of empty white to its left. `.wrap` is a reading column and the page column
lived inside it; a sheet narrower than that column is centred by its auto margins, and a sheet wider
than it is not — auto margins resolve to zero, so the sheet goes flush to the column's left edge and
the overflow hangs off to the right. Reproduced within 2px of his capture. The page column now
escapes the cap by exactly as much as it needs to span the free space `_chromeInset()` measures, and
nothing else moves: off-centre went from 224px to 0, at every column width.

**Only a corner handle changes the point size** (`6lc`). `pos.indexOf("n")>=0` is true of `nw` and
`ne` as well as `n`, so six of the eight grips were scaling the type — which meant a top or bottom
grip could not give a note more room to wrap into, because the words grew with the box.

**Ctrl on a side grip widens a text box and nothing else** (`6lc`). A text box arrived in the shapes'
branch when 6kn made every free box one gesture, and picked up their square-off with it: one
Ctrl-drag took a 240x29 box to 331x331. Ctrl on a text box's side grip means what 6dr made it mean —
grow about the middle — and leaves the height alone.

**A text box shows the lines it cannot fit** (`6lc`). Screen and file agree on where the words break;
what was wrong is what happened to the lines that did not fit. 6kf said in words that a text box
overflows rather than hides, and `overflow:hidden` was set three hundred lines above it where every
free box passes. Measured: five lines needing 56px in a 38px box, the last two clipped away. A shape
keeps the clip — its fill is painted on that element.

**A pasted mark arrives selected** (`6ld`). It was going into `S.selMulti`, which is right for a set
and not for one mark: no grips, so it could not be resized without clicking it again, and the bar
offered what you do to a SET. Pasting with a tool still in hand also left the mode on that tool, so
the next drag drew instead of moving what had just arrived.

**The picture editor**: the Fill icon is Ced's own bucket, traced in its own proportions and drawn in
`currentColor` instead of an emoji (`6lf`); the shapes have sharp corners, since `lineJoin:"round"`
was putting a 24px fillet on a box drawn at 12pt (`6lf`); and the pen has a ring the size of the
stroke it will draw, in the ink it will draw with, sized by Shift-wheel like the eraser's (`6lf`).

**Auto reaches the lines the no-end rule cannot** (`6lg`). A leader that crosses the subject has both
ends on the contour, so it is part of a cycle — and worse, it makes the contour and the leader one
closed thing, which is why the largest closed component on Ced's capture was 7,504 skeleton pixels of
7,541 and the pass removed 3.0%. Four candidate rules were measured on his own capture before one was
written: continuity with the removed stumps (195px, 0.5%), the picture's edge as a line end (no
change), straightness (does not separate — every arc in a mount drawing is 0.98 straight), and where
the line sits. The last one separates: leaders ran 0.075-0.149 ink density against 0.18-0.92 for the
mount. Density alone then took `behave.py`'s floating bracket, because a bracket on its own IS alone,
so the rule needs the second half: a leader is also the LIGHTEST line on the sheet — 2.0-2.2 against a
median stroke of 4 on Ced's capture, 2.48 against 4.0 on the test picture. Long, alone and thin, all
three. 3.0% to 4.0% removed, both subjects whole, 297ms.

**Every shortcut, pressed** (`test/keys.py`). Ced, four versions running: *"make sure all shortcuts
work again for the nth time."* It kept coming back because nothing was watching it — 15 tool letters
and 14 other shortcuts now go through a real keyboard every release, and the suite fails if one of
them does nothing. All 29 pass. `tools.py`'s Escape-ladder expectation was corrected in the same
pass: it was reading a `_selFromDraw` flag left over from its own setup, and the ladder as a hand
meets it is tested in `behave.py` and `keys.py`, which draw with the tool first.

**Four new `behave.py` cases**, each confirmed to fail without its fix: the sheet's centring at four
column widths, the corner-only point size, Ctrl on a side grip, and the paste. Nineteen behaviours,
seven suites.

---

## v43

**The picture editor learns to fill, to select by shape, and to do the obvious thing on its own.**

**A bucket** (`6la`). `Fill selection` paints behind the ink, which is the job for putting a ground
under a capture. A bucket is the other job: click a space and that space takes the colour, on top,
with no selection step in between. Same flood as the wand, same tolerance, different composite.

**Shape select.** The lasso is for a region with no shape to it; most of what wants selecting on a
drawing is a rectangle, and drawing one by hand round it is both slower and worse. Rectangle or
ellipse, through the same New / Add / Subtract chips the wand uses.

**Auto.** Ced: *"have a automatic mode that will read the photo and will do what it should do ...
this is not ai assisted tool, it should be aware without ai."* It is not. It is one idea of his and
three set operations.

The idea is his too: *"look for the shape by looking at lines that does not have an end."* That is
the right test. A drawn object is made of closed contours — an outline comes back to where it
started — while a line arriving from elsewhere in the drawing has two ends, or one end and a frame
edge, which is the same thing because the outside of the picture is empty. So the capture is thinned
to one-pixel lines (Zhang–Suen), every pixel with one neighbour or none is deleted, and the deleting
repeats: an open line is eaten from its tip inward and vanishes, a loop has no such pixel and is
untouched. Measured on Ced's own capture, 8,120 thinned pixels: 6,855 closed, 1,265 ends.

Then his recipe, in his order — *"select the outside shape then inverse then fill"* — on the region
the surviving contour encloses, grown by the mean stroke width so the strokes that drew it are
covered. Ink beyond that is the outer lines and comes off; the region is filled **behind** the ink so
the drawing still reads on top of its new ground. Nothing is redrawn: *"dont regenerate the selected
shape"*. Measured, 36,073 of 37,867 ink pixels kept and 1,794 outer-line pixels taken, in 280ms.

Two things it deliberately does not do, both recorded in the code and said in the status line rather
than left for Ced to discover. A line that crosses right **through** the shape has both of its ends
on the contour, which makes it part of a closed loop, which makes it indistinguishable from a real
member by the only test there is — `Erase line` takes one in a click. And branches shorter than
`minLen` are put back, because the tick on a bracket is a detail and not an intruder.

An earlier version of this used density instead — a morphological closing as a crowd detector. Ced's
test is better and it replaced it outright.

---

## v42

**Tested by gesture.** Ced, after a version in which every one of his complaints had a passing audit
case: *"these must be made functioning well."* He was right and the cases were worthless. `tools.py`
asks the page questions — it calls a function, reads state, checks the answer — and a question
answered correctly by a function **no gesture ever reaches** is a test that passes while the tool is
broken.

`test/behave.py` is the answer: twelve behaviours, each driven by `page.mouse` and `page.keyboard`
and nothing else. Setup and measurement may read state; the action under test never may. Each case
gets a fresh page, because a tool that only works on the second document is a tool that does not
work.

Its first run reported five broken. **Three were the harness** — and those are the things a script
gets wrong that a hand does not, so they are written down: the ribbon auto-hides on scroll (`6gc`),
so clicking a tool button silently missed; the resize grips are not children of the mark, but of a
second element laid over it (`.anno.sel.selui`); and a shape takes words through a double-click, not
by typing at it.

**Two were real** (`6l7`). *A click is not a draw*: `6hq` is right that a tool in the hand must draw
OVER a mark rather than shove it aside, but drawing is a DRAG — a press that goes down and comes up
in the same place drew nothing, and plainly meant the mark underneath. It cannot be decided at
pointerdown, so the press is let through as before and the mark remembered, then read at the pointerup
that ends the gesture: no travel and nothing created means that mark is picked up and the tool goes
down. And *Escape on a bare start point*: a line tool armed by a click on blank paper was eating the
Escape meant to reach Select; that press now ends the run and puts the tool down together, while a
run with real segments still only ends.

Measured while proving the suite can fail: the brush holds **16.7 ms** frames through a forty-step
sweep; a markup's preview lands within **0.1 pt** of the mark it becomes (0.03 pt for a five-mark
group); what you drag out is within a point of what the mark says it is.

---

## v41

**The export's baseline, measured properly** (`6l4`). Ced, with the tool open beside the export:
*"make sure the redlines are rendered exactly how it was showing on the tool."* Measured off his two
screenshots, every line of a COP stamp sat high in the file by about 0.025 of the frame's inner
height — and by more at the bigger size, which is the signature of a rounding error rather than a
placement rule. `cssBaseline` was laying its probe out at the mark's point size read as a pixel
count: 4.73px for a stamp row, where half a pixel of rounding is half a point of the finished mark.
v38 found this exact fault and fixed it in the stamp's own layout and nowhere else — and this
function is read by the export, not the screen, which is why only the file was wrong. Asked at
twenty times and scaled back: title 5px out → 0, rows 2px → 0–1px.

`6l3` also made one definition of where a free box's block sits: v39 put a text box's block in the
middle on screen and left the export on top.

**New suite, `test/stampparity.py`.** The sheet and the file rendered onto one pixel grid at five
times the size, the frame's two rules found in each, and every band of ink between them compared as a
fraction of the inner height. It fails 4 of 4 against the pre-fix build and passes 4 of 4 after —
which is the only way to know a suite measures anything. `wysiwyg.py`'s five per-row stamp windows
are gone with it: measured, the same unmoved stamp read 2.2pt with a pixel of padding and 19pt with
none.

Also: the stamp card edits **every** stamp as you type rather than only a selected one, coalesced and
one history entry per burst (`6l5`); and Helvetica Neue leads the interface stack, with form controls
told to inherit it (`6l6`). The marks keep Arial — the export writes Helvetica and both parity suites
are measured against that pairing.

---

## v40

Eighteen items: four Ced opened with, three left over from v39, eleven that arrived mid-build.

**A text box is all box** (`6kn`). v39 deferred removing the 1×2pt inset on the reading that `.ed`
was content-box; measured again, it resolves border-box, so the padding was always inside the width
and the earlier 5-of-10 parity failure was a one-sided change. Both sides moved together. Fixing it
exposed two copies of the wrap rule — the screen broke at words, the file mid-word — now one.

**Flatten reaches only what is selected** (`6ko`): v37's group isolation reached the pointer and
stopped, so flattening one row of a stamp flattened the stamp.

**The picture editor** (`6kp`/`6kq`): `backdrop-filter: blur(2px)` on the dialog was 36 ms of every
frame of a brush stroke — 54.9 → 18.9 ms per pointer move, a steady 60 fps. And it draws now: Pen,
Line, Arrow, Box, Ellipse, weighted in points of the mark on the sheet, so a 3pt line in a 3×
capture measures 12px.

**Assist cut to three** (`6kx`): Redline report, As-built, Notes and Parts removed, buttons, cards
and modal with them.

Also: a locked mark can no longer be deleted or restyled (`6ky`); a stroke has no target unless Shift
or Ctrl asks for one (`6kt`); one Escape reaches Select when the selection came from clicking rather
than drawing (`6l1`); the Assist panel drags by its head and remembers where (`6ks`); Flip is two
buttons (`6kz`); a picture pastes from the HTML and data-URL clipboard flavours, not only as a file
(`6l0`).

---

## v39

The stamp card in Assist, marquee selection by overlap rather than by corner, text behaviour (a box
keeps the size the hand gave it; wrapping follows the width), cut shown as marching ants on the
border, and the export named from the document rather than from "Mount Analysis".

---

## v38

**The AT&T COP stamp, brought inside** (`6k4`). The standalone COP Stamp Tool was a batch processor
— feed it PDFs, it draws a stamp with pdf-lib and hands the files back — and MIU's export used to
send you to the hosted copy, so the two were used on one document with a download in between. The
stamp is now built out of MIU's own marks: one rectangle and four text boxes, grouped. From that
moment it is an ordinary redline — it appears as it is placed, it drags and resizes, v37's group
isolation means a double-click edits one line of it and the stamp survives, and the export writes it
through the same path as everything else, so there is no second export route and nothing flattened.

What came across from the old tool is its judgement: the sheet-scale rule (calibrated to a letter
page's 612pt short edge, clamped 1..4, so a 24x36 drawing gets a proportionally larger stamp) and the
blank-space search (an RFDS centres on the grey header band, clear of "Page 1 of 1"; a drawing hugs
the upper right and travels down past callouts, needing a band of white all round rather than merely
an absence of ink). Measured on a real mount analysis: a spot found in 66ms with **zero inked pixels
underneath it**. What did not come across is the multi-file queue — "every page of this document" is
the scope that means anything in a one-document tool.

Also in the card: realtime editing (a field change rewrites the selected stamp as you type), update
the date across every stamp while keeping status, GC and POC, and switch REDLINED ↔ AS-BUILT.

**The stamp's drawing, rebuilt from the artwork.** The first build ported the old tool's spacing,
which was tuned for pdf-lib — it draws a glyph at a baseline and nothing else. Here each line is a
real line box, and those numbers put the date's descenders through the bottom rule and left the
longest row flush against the right one. Worse, a row box sized exactly to its text let the
stylesheet's `break-all` fold "LC" onto a second line the box was too short to show: the mark read
"TSC CONSTRUCTION L" while its text and its width were both correct.

The geometry is now taken off the reference stamp, measured: box 893x390 with a 14px rule, title caps
76px against the rows' 49px, 41px from the title's baseline to the next line's caps, 19px between the
rows, and a margin of 33/32/33/34px — one margin, even all the way round. Expressed as multiples of
the row size those hold at any scale, and the result matches: gaps 0.833 and 0.389 of a cap against
the artwork's 0.837 and 0.388.

Three measurement bugs had to go first, all the same bug — asking a question at 4.73pt and getting a
rounded answer:

- text width measured at 4.73px gives 12.5248 points per point against 12.5540 at 94.6px;
- `cssBaseline` resolving a baseline inside a 5.8px line box rounds by half a pixel, which is half a
  point, which left the bottom margin 0.57pt tighter than the top;
- `TextMetrics.actualBoundingBox*` disagrees with what the engine paints — a 0.693em cap height for
  Arial Bold against its real 0.716, and almost no descent for a string containing a slash.

The first two are now asked at twenty times the size and scaled back; the third is a pixel scan of
the glyphs, which cannot disagree with the painter because it is the painter. Measured on the built
page at 527%: margins of 2.47 / 2.28 / 2.47 / 2.66pt, even within a pixel.

**Arial, bold** — the family throughout and the weight throughout, the title distinguished by size.
Measured off the reference artwork: stem-to-cap 0.211 on the title and 0.204 on the rows, where Arial
Regular would be about 0.13.

**Two supporting changes in the engine**, both general rather than stamp-specific:
`nowrap` is now honoured on free text boxes (`6k4`), and `pad0` lets a mark drop the 1x2pt inset that
exists so a text box's words do not sit flush against their own ground — on a stamp that inset pushed
every row 2pt off its computed margin and took 4pt out of the usable width.

**The site is the tool.** `/` boots into the loading screen and then the opening screen; the landing
page is gone, and `/app`, `/tool` and `/miu` redirect to `/`. The boot logo is smaller (300 -> 210px).

*Audit:* 206 checks, 0 failing, with three new cases — the stamp lands as redlines, it has room for
what it says (asserted for a 3-character contractor and a 48-character one), and it finds clear
paper.

---

## v37

Eleven items, plus one that arrived mid-build.

**Keyboard shortcuts stay live** (`6js`). Focus would stick in a chrome control and every keystroke
after that belonged to the browser. The guard was an *allowlist* of elements that hand focus back,
so every new ribbon control was outside it by default — which is why this regressed twice. Inverted:
a pointerdown on anything that is not a real text target releases chrome focus. A new button cannot
opt out by existing.

**Escape is a ladder, not a switch** (`6jt`). One press undoes one thing, nearest first: a
half-placed point → the caret in a mark → the caret in a field → the selection (tool stays in hand) →
the tool. Two presses still reach Select. A second handler in `ma.js` was dropping the tool ahead of
the ladder; that call is gone.

**A selected mark drags by its own body** (`6ju`). A tool in the hand still draws *over* an
unselected mark. The guard had to live in the page's `pointerdown` — pointer events fire before the
mark's `mousedown`.

**Arrowheads at their stated size** (`6jv`). `addLine` was dropping `leSz` and `join` when copying
the tool's style. Tiny 4.2pt · Small 6.8 · Medium 10 · Large 15, on screen and in the export alike.

**Corner style as a setting** (`6jw`). Sharp (now the default), Round or Bevel, on every line tool's
properties panel. One definition drives the CSS join and the PDF `j` operator.

**Lines by points** (`6jx`). Line, Arrow, Length and Cross out can be clicked rather than dragged:
click to start, click to finish, with a live preview between. Dragging is unchanged.

**Into a group, and out again** (`6jz`). Double-click a member and the group isolates — that one
mark selected, with its own handles, while every member keeps its grouping. Escape steps back out to
the whole group. Fixing this exposed a real bug: the selection frame's cover carries its own
`pointer-events`, so silencing only the frame left `elementFromPoint` returning the cover — the
double-click-into-text added in v29 had never actually reached the mark.

**Size floors, independent of weight and point size** (`6k0`). Measured before: a shape bottomed out
at 10×8 px whatever the rule weight, and a text box at 11 / 43 / 90 px for 6 / 14 / 30 pt. Three
causes — literal CSS pixels written into the resize (so the floor also moved with the zoom), the
stylesheet's `min-width:14px` on `.ed`, and a text box springing back to whatever its words need.
The floor is now the same fraction of the page the draw gesture uses (`MARK_MIN_N = 0.0012`, about
¾ pt), and a text box made shorter takes its type down with it. After: 0.88×1.13 px for every
weight, 4–5 px for every point size.

**The text tool finishes** (`6k1`). Text is no longer a sticky tool — every other sticky tool
finishes at the mouse-up, but a text box is drawn and then *typed in*, so the gesture that ends it is
the click somewhere else, and with the tool still armed that click landed a second, empty box. Place
→ caret → type → click away commits and Select is live. An empty box is discarded when the caret
leaves it, with no history entry.

**The layout stopped thrashing** (`6k2`). `layoutAnnos` took 19.96 ms on 41 marks and runs on every
mark added, every resize, every zoom step and every undo. Two causes, both found by measuring: the
loop wrote a mark then *read* `pg.offsetWidth`, forty times over, forcing a reflow each time — the
same code with `#pages` hidden ran in 2.6 ms; and twelve `display:none` handle elements were built
per mark to show twelve. The page is measured once per layout, and handles are built for the mark in
hand. **25.8 ms → 6–7 ms.**

**The top bar keeps the ribbon's column** (`6jy`). On a sheet wide enough to scroll sideways the
detection banner and save strip slid away while the ribbon held still — measured at 1600 with the
sheet at 2920: ribbon `74..1584`, banner `-426..1084`. Both strips take the ribbon's `--sx`
correction now.

**The selection's own ink** (`6k3`). The frame was a 1 px hairline in `#37a6ff`, which over a white
sheet crowded with red redlines read as a smudge. Now `#1268d1` at 2 px, and defined once as
`--selink` / `--selw` / `--selbw` — the frame, handles, grips, marquee, lasso and a stroke's round
handles all read it, the script through `selInk()`.

*Audit:* three existing cases encoded behaviour this version deliberately changed and were rewritten
(*Tool stays in hand*, *Every shortcut*, *A tool draws over a mark*); six added. 203 checks, 0
failing.

---

## v36

Redlines keep their size when applied to a differently-sized page (`maKeepSize`) — a stamp measured
91.7×41.6 pt was coming out 129.6×29.5 pt on a different sheet. Marks are drawn beyond the page edge
rather than clipped. Zooming leaves every mark where it was, text included.

## v35

Monochrome icon set for flip, lock, flatten, markup library, copy properties, group, edit picture,
layers, copy and duplicate. Redlines drag from one page to another without breaking. Zooming out no
longer moves marks.

## v34

The log stopped covering the pages. A right-click on a mark opens the tool's own menu rather than the
browser's.

## v33

Picture borders follow the picture's own alpha, not its box. Flatten works and asks first. Flip on
the mark's mini bar. Lock, Flatten, Add to markup, Apply to pages and Copy properties restored to the
bottom bar. Cut shows marching ants rather than vanishing. Named layers. New logo throughout.

## v32

Picture editor: border weight, a visible crop box, a restore button, erasing past the picture's edge.
Caps throughout the chrome. Shape tools no longer overlay the ribbon. Right-click opens settings.

## v31 and earlier

See `claude/vNN-notes.md` in the MIU project.
