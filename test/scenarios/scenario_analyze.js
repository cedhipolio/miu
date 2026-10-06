const out={};
maAnalyzeOpen();
out.read = MA_TABLE ? {rows:MA_TABLE.rows.length, cols:MA_TABLE.columns, pages:MA_TABLE.pages.map(p=>p+1)} : null;
if(MA_TABLE){
  out.sample=MA_TABLE.rows.slice(0,3).map(r=>MA_TABLE.columns.map(c=>r.cells[c]||""));
  /* change two cells the way a redliner would */
  const modelCol=MA_TABLE.columns.find(c=>/model/i.test(c))||MA_TABLE.columns[1];
  const numCol=MA_TABLE.columns.find(c=>/center|centre|elev/i.test(c));
  MA_TABLE.rows[0].cells[modelCol]="Ericsson AIR 6449 B77";
  if(numCol)MA_TABLE.rows[0].cells[numCol]="398.0";
  out.edits=maTableEdits().map(e=>({col:e.col,was:e.was,now:e.now}));
  out.applied=maApplyTable();
  out.marks=S.annos.filter(a=>a.maKind==="loading").map(a=>({p:a.page+1,t:a.text}));
}
maAnalyzeRender();
return JSON.stringify(out);
