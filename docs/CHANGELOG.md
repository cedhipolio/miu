# Changelog

Per-version working notes — what was asked for, what was measured, why each fix is shaped the way it
is — live alongside this repo in the **MIU (Mark It Up)** Claude project as `claude/vNN-notes.md`,
back to v11. This file is the summary.

Versions are numbered by release, not semver: v37 is the thirty-seventh published build.

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
