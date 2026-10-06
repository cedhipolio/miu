maAddShape(0,"rect",0.12,0.62,0.22,0.06,{text:"AS BUILT"});
maPolyPoint(0,0.55,0.74); maPolyPoint(0,0.66,0.80); maPolyFinish();
let err=null;
try{ await exportPdf(); }catch(e){ err=String(e&&e.message||e); }
const logEl=document.getElementById("logBody");
return JSON.stringify({err,status:(document.getElementById("status")||{}).textContent,
  log:(logEl?logEl.textContent:"").slice(-900)});
