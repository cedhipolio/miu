/* Fill in the stamp, stamp every page, add a correction and a callout, then export. */
const out = {};
maLoadPrefs();
MA_PREFS.org = "TSC CONSTRUCTION, LLC";
MA_PREFS.ta = "EDEN TA";
MA_PREFS.date = "07/28/2026";
MA_PREFS.label = "REDLINED";
maSavePrefs();

out.pages = S.pages.length;
out.stamped = maStampAll("all");
out.annosAfterStamp = S.annos.length;
out.site = S.siteCode;
out.filename = outputFilename();

/* a correction on a printed run of page 3 (the antenna loading page in this sample) */
const P = S.pages[3];
const run = (P.items || []).find(t => /Ericsson/i.test(t.str)) || P.items[8];
if (run) { maStrikeAndWrite(3, run); out.fixOn = run.str; }

/* a callout on a later page */
MA_CALLOUT_TEXT = "New Sector Frame\nMFR: Sabre\nPart# C10841002C\n(1) per sector";
maPlaceCallout(5, 0.62, 0.55);

/* a note across a range */
maNoteOnPages("ACTUAL INSTALL: TRIAD MOUNT WITH STEALTH SHROUD", [6, 7, 8], 0.12, 0.90);

out.annos = S.annos.length;
out.lines = S.lines.length;
out.rotatedPages = S.pages.filter(p => p.w1 > p.h1).length;
return JSON.stringify(out);
