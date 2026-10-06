const out={};
/* style: a thick orange stroke with a 25% yellow fill */
$("#c_text").value="#e8590c"; $("#c_sw").value="2.5"; $("#c_fill").value="#ffd43b"; $("#c_fop").value="25";
maAddShape(0,"rect",0.15,0.30,0.25,0.08,{text:"BOX WITH TEXT"});
maAddShape(0,"ellipse",0.55,0.30,0.18,0.10);
addLine(0,0.15,0.50,0.45,0.58,{col:"#1971c2",sw:3,arrow:"end"});
addLine(0,0.15,0.62,0.45,0.62,{col:"#2f9e44",sw:1});
maPolyPoint(0,0.55,0.50); maPolyPoint(0,0.65,0.58); maPolyPoint(0,0.80,0.50); maPolyFinish();
MA_CALLOUT_TEXT="New Sector Frame\nMFR: Sabre\nPart# C10841002C\n(1) per sector";
maPlaceCallout(0,0.70,0.75);
out.annos=S.annos.map(a=>({k:a.maKind||a.kind||"text",shape:a.shape||null,col:a.col,sw:a.sw,fill:a.fill,op:a.fillOp}));
out.lines=S.lines.map(l=>({col:l.col,sw:l.sw,arrow:l.arrow||null,pts:(l.pts||[]).length}));
/* restyle the selection */
selectAnno(S.annos[0].id);
$("#c_text").value="#c2255c";
out.restyled=maRestyleSelection("col");
out.firstCol=S.annos[0].col;
await exportPdf();
return JSON.stringify(out);
