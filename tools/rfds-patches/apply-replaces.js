/* ===== Mark It Up v92 — Apply replaces a redline whose value changed (appended to the RFDS app by tools/embed_rfds.py) =====
   Ced: "If a redline was changed on analyze rfds, regardless if there is a redline on that space already,
   please replace the overlaid redline. only apply the rule of not changing redline if the redline was
   unchanged. however, if a redline was updated, make sure it is replaced once redline was clicked again."
   6ev left ANY redline you had drawn on a cell alone when Apply came to it, so a value corrected in the
   analysis never reached a cell that already carried a redline. Now the rule is about the VALUE: a redline
   already reading what Apply would write is left exactly as it is; one that reads anything else is taken
   off and the corrected value placed in its stead, by the same placement a fresh cell gets. A stamp or a
   picture over the cell is never a redline and is never removed. */
function _miuHandKeep(dup,value){
  if(!dup)return false;
  if(dup.kind==="img"||dup.kind==="stamp"||dup.st)return false;      // not a redline: ignore it, keep it
  const norm=v=>String(v==null?"":v).replace(/\s+/g," ").trim().toUpperCase();
  if(norm(dup.text)===norm(value)){
    _azHandHeld++;
    LOG("Analyze: the redline on this cell already reads",JSON.stringify(String(dup.text)),"— left as it is");
    return true;
  }
  S.annos=S.annos.filter(x=>x!==dup);
  if(S.sel===dup.id)S.sel=null;
  try{ const d=document.querySelector('.anno[data-id="'+dup.id+'"]'); if(d)d.remove(); }catch(e){}
  LOG("Analyze: replaced the redline on this cell (",JSON.stringify(String(dup.text)),") with",JSON.stringify(String(value)));
  return false;
}
/* And an Apply that UPDATES its own redline on a cell takes off anything you had laid over that cell
   with a different value: the cell ends with one redline, reading the corrected value. Apply's own mark is
   found first (markCoveringCell prefers it), so without this a hand-drawn mark on top of it survived the
   update and still showed the old figure. Only when the value changed — an unchanged cell is not touched. */
let _miuVal;
;(function(){
  const norm=v=>String(v==null?"":v).replace(/\s+/g," ").trim().toUpperCase();
  const wrap=(fn,vi)=>function(){ const keep=_miuVal; _miuVal=arguments[vi];
    try{ return fn.apply(this,arguments); } finally{ _miuVal=keep; } };
  addText=wrap(addText,3);
  stampWholeCell=wrap(stampWholeCell,2);
  const find=markCoveringCell;
  markCoveringCell=function(pi,box){
    const hit=find(pi,box);
    if(!_azApplying||_miuVal===undefined||!hit||!hit.fromAnalyze||norm(hit.text)===norm(_miuVal))return hit;
    const bx2=(box.x2!=null?box.x2:box.nx+(box.nw||0)), by2=(box.y2!=null?box.y2:box.ny+(box.nh||0.011));
    const cx=box.nx+(bx2-box.nx)/2, cy=box.ny+(by2-box.ny)/2;
    const over=(S.annos||[]).filter(a=>a!==hit&&a.page===pi&&!a.fromAnalyze&&a.kind!=="img"&&a.kind!=="stamp"&&!a.st&&
      (a.nw||0)>0&&(a.nw||0)<=0.25&&cx>=a.nx-0.0005&&cx<=a.nx+a.nw+0.0005&&
      cy>=a.ny-0.0005&&cy<=a.ny+(a.nh||a.lineNh||0.011)+0.0005&&norm(a.text)!==norm(_miuVal));
    if(over.length){
      S.annos=S.annos.filter(a=>over.indexOf(a)<0);
      over.forEach(a=>{ try{ const d=document.querySelector('.anno[data-id="'+a.id+'"]'); if(d)d.remove(); }catch(e){} });
      LOG("Analyze: took off",over.length,"redline(s) laid over this cell — the corrected value replaces them");
    }
    return hit;
  };
})();
