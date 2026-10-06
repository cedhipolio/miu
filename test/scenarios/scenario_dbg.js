const out={pages:maLoadingPages().map(p=>p+1)};
const pi=maLoadingPages()[0];
if(pi!=null){
  const lines=pageLines(pi);
  out.hdrHits=lines.map((l,i)=>({i,norm:l.norm.slice(0,90),hit:maLoadHeaderLine(l)})).filter(z=>z.hit);
  out.firstLines=lines.slice(0,14).map(l=>l.norm.slice(0,80));
  const t=readTableByCell([pi],maLoadHeaderLine,MA_LOAD_SKIP);
  out.tbl={cols:t.columns,rows:t.rows.length};
  out.log=(window._logBuf||[]).slice(-8);
}
return JSON.stringify(out);
