# Changelog

Per-version working notes — what was asked for, what was measured, why each fix is shaped the way it
is — live alongside this repo in the **MIU (Mark It Up)** Claude project as `claude/vNN-notes.md`,
back to v11. This file is the summary.

Versions are numbered by release, not semver: v48 is the forty-eighth published build.

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
