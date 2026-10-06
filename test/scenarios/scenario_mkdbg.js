const px="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR42mNkYPhfz0AEYBxVSF+FjIyM/xkYGBhGFQ6DUAQAxbEH/eMTgkAAAAAASUVORK5CYII=";
MA_MARKUPS.unshift({id:"t1",name:"test mark",src:px,w:8,h:8});
const id=maPlaceMarkup(MA_MARKUPS[0],0,0.30,0.90);
const a=S.annos.find(z=>z.id===id);
let err=null;
try{ await exportPdf(); }catch(e){ err=String(e&&e.stack||e); }
return JSON.stringify({id,mark:a?{kind:a.kind,nw:a.nw,nh:a.nh,srclen:(a.src||"").length}:null,err,
  status:(document.getElementById("status")||{}).textContent});
