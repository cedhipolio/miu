const out={};
/* --- Analyze MA --- */
maAnalyzeOpen();
out.table = MA_TABLE ? {rows:MA_TABLE.rows.length, cols:MA_TABLE.columns} : null;
if(MA_TABLE){
  const mc=MA_TABLE.columns.find(c=>/model/i.test(c));
  MA_TABLE.rows[0].cells[mc]="Ericsson AIR 6449 B77";
  out.applied=maApplyTable();
}
maAnalyzeClose();
/* --- drawing tools, each with its own style --- */
$("#c_text").value="#1971c2"; $("#c_sw").value="2"; $("#c_fill").value="#ffe066"; $("#c_fop").value="30";
maAddShape(0,"rect",0.12,0.62,0.22,0.06,{text:"AS BUILT"});
maAddShape(0,"ellipse",0.44,0.60,0.14,0.09);
addLine(0,0.12,0.75,0.40,0.82,{col:"#e03131",sw:2.5,arrow:"end"});
maPolyPoint(0,0.55,0.74); maPolyPoint(0,0.66,0.80); maPolyPoint(0,0.82,0.74); maPolyFinish();
MA_CALLOUT_TEXT="New Ring Mount\nMFR: Site Pro 1\nPart# LWRM\n(2) per sector";
maPlaceCallout(0,0.78,0.40);
/* --- a markup from the library --- */
const px="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR42mNkYPhfz0AEYBxVSF+FjIyM/xkYGBhGFQ6DUAQAxbEH/eMTgkAAAAAASUVORK5CYII=";
MA_MARKUPS.unshift({id:"t1",name:"test mark",src:px,w:8,h:8});
maPlaceMarkup(MA_MARKUPS[0],0,0.30,0.90);
out.counts={annos:S.annos.length,lines:S.lines.length,
  shapes:S.annos.filter(a=>a.shape).length,
  img:S.annos.filter(a=>a.kind==="img").length,
  arrows:S.lines.filter(l=>l.arrow).length,
  polys:S.lines.filter(l=>l.pts).length};
await exportPdf();
return JSON.stringify(out);
