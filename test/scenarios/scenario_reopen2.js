const p0=S.annos.filter(a=>a.page===0);
return JSON.stringify({p0:p0.map(a=>({k:a.maKind||"plain",t:(a.text||"").slice(0,20),x:+a.nx.toFixed(3),y:+a.ny.toFixed(3)})),
  total:S.annos.length, log:(window._logBuf||[]).slice(-14)});
