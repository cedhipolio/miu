const p0=S.annos.filter(a=>a.page===0).map(a=>({id:a.id,k:a.maKind||"-",box:!!a.box,size:a.size,nw:+(a.nw||0).toFixed(4),t:(a.text||"").slice(0,14)}));
return JSON.stringify({p0,det:(window._detached?{a:_detached.annos.length,l:_detached.lines.length,removed:_detached.removed}:null)});
