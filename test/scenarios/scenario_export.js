const out={};
maLoadPrefs();
MA_PREFS.org="TSC CONSTRUCTION, LLC"; MA_PREFS.ta="EDEN TA"; MA_PREFS.date="07/28/2026";
maSavePrefs();
out.stamped=maStampAll("all");
/* a callout on a landscape drawing sheet, to prove the rotation maths */
const rot=S.pages.findIndex(p=>p.w1>p.h1);
out.rotIdx=rot;
if(rot>=0){ MA_CALLOUT_TEXT="New Sector Frame\nMFR: Sabre\nPart# C10841002C\n(1) per sector";
            maPlaceCallout(rot,0.55,0.45); }
const P=S.pages[3];
const run=(P.items||[]).find(t=>/^\d{2,3}\.\d$/.test(String(t.str).trim()))||P.items[6];
if(run){ maStrikeAndWrite(3,run); out.fixOn=run.str; }
out.annos=S.annos.length; out.lines=S.lines.length;
await exportPdf();
out.exported=true;
return JSON.stringify(out);
