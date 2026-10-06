const byKind={};
S.annos.forEach(a=>{ const k=a.maKind||a.kind||"text"; byKind[k]=(byKind[k]||0)+1; });
return JSON.stringify({
  annos:S.annos.length, lines:S.lines.length, byKind,
  shapes:S.annos.filter(a=>a.shape).map(a=>({shape:a.shape,col:a.col,sw:a.sw,fill:a.fill,op:a.fillOp,t:(a.text||"").slice(0,12)})),
  strokes:S.lines.map(l=>({col:l.col,sw:l.sw,arrow:l.arrow||null,pts:(l.pts||[]).length})),
  img:S.annos.filter(a=>a.kind==="img").map(a=>({src:(a.src||"").slice(0,20),nw:+a.nw.toFixed(3)}))
});
