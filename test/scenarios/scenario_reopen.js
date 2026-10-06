/* the file opened here is one this tool exported — the marks should come back editable */
const out={annos:S.annos.length,lines:S.lines.length,
  stamps:S.annos.filter(a=>a.maKind==="stampbox").length,
  kinds:{}, site:S.siteCode};
S.annos.forEach(a=>{ const k=a.maKind||"plain"; out.kinds[k]=(out.kinds[k]||0)+1; });
out.sampleText=S.annos.filter(a=>a.text).slice(0,3).map(a=>a.text.replace(/\n/g," | "));
return JSON.stringify(out);
