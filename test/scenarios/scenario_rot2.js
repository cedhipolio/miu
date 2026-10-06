const rot=S.pages.findIndex(p=>p.w1>p.h1);
$("#c_text").value="#e03131"; $("#c_sw").value="2"; $("#c_fill").value="#ffec99"; $("#c_fop").value="25";
maAddShape(rot,"ellipse",0.30,0.35,0.12,0.10);
addLine(rot,0.50,0.30,0.38,0.40,{col:"#e03131",sw:2,arrow:"end"});
MA_CALLOUT_TEXT="New Sector Frame\nMFR: Sabre\nPart# C10841002C";
maPlaceCallout(rot,0.62,0.55);
maPolyPoint(rot,0.20,0.70); maPolyPoint(rot,0.30,0.78); maPolyPoint(rot,0.45,0.70); maPolyFinish();
await exportPdf();
return JSON.stringify({rot:rot+1,annos:S.annos.length,lines:S.lines.length});
