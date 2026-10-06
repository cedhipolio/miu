const out={};
maAnalyzeOpen();
if(MA_TABLE){ const mc=MA_TABLE.columns.find(c=>/model/i.test(c));
  MA_TABLE.rows[0].cells[mc]="Ericsson AIR 6449 B77"; out.applied=maApplyTable(); }
maAnalyzeClose();
$("#c_text").value="#1971c2"; $("#c_sw").value="2"; $("#c_fill").value="#ffe066"; $("#c_fop").value="30";
maAddShape(0,"rect",0.12,0.62,0.22,0.06,{text:"AS BUILT"});
maAddShape(0,"ellipse",0.44,0.60,0.14,0.09);
addLine(0,0.12,0.75,0.40,0.82,{col:"#e03131",sw:2.5,arrow:"end"});
maPolyPoint(0,0.55,0.74); maPolyPoint(0,0.66,0.80); maPolyPoint(0,0.82,0.74); maPolyFinish();
MA_CALLOUT_TEXT="New Ring Mount\nMFR: Site Pro 1\nPart# LWRM\n(2) per sector";
maPlaceCallout(0,0.78,0.40);
out.counts={annos:S.annos.length,lines:S.lines.length};
let err=null;
try{ await exportPdf(); }catch(e){ err=String(e&&e.message||e); }
out.err=err; out.status=(document.getElementById("status")||{}).textContent;
return JSON.stringify(out);
