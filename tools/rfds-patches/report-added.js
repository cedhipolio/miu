/* ===== Mark It Up v91 — WHAT was added, not only that something was (appended to the RFDS app by tools/embed_rfds.py) =====
   Ced: "in rfds report, also add the added equipment on design summary and rf inventory. ie (Added
   FB-L98B-235 in Beta) if a row is added". "Equipment added to the design in Beta on Design Summary"
   said a row was inserted and not what it was. A row added on Design Summary or RF Inventory now reads as
   the equipment it adds, one line per model, with its sectors and the tabs it was added on — the same
   model added on both tabs is one line: "Added FB-L98B-235 in Beta on Design Summary and RF Inventory".
   A row with no model says its kind ("Added squid in Alpha"). Rows added on the other tabs keep the old
   general line. */
function _miuAddedLines(A,rf,add,uDs,uRf){
  const G=new Map(), restT=[], restS=[];
  const note=(model,type,sector,tab,key)=>{
    const m=String(model||"").trim();
    const name=m||_rlModelPhrase(type,"",true)||"equipment";
    const k=(typeof normModelKey==="function"&&m?normModelKey(m):name.toLowerCase())||name.toLowerCase();
    if(!G.has(k))G.set(k,{name,secs:[],tabs:[],keys:[]});
    const g=G.get(k); const sx=_rlSector(sector); if(sx)g.secs.push(sx);
    g.tabs.push(RL_TAB[tab]); g.keys.push(key||tab);
  };
  (A.designSummary||[]).forEach(r=>{ if(r.inserted&&!r.struck)note(r.model,r.type,r.sector,"designSummary"); });
  if(rf&&rf.columns&&rf.rows){
    const mc=rfModelCol(rf.columns);
    const tc=rf.columns.find(c=>/equipment\s*type|^type$/i.test(String(c).trim()));
    rf.rows.forEach(r=>{ if(r.inserted&&!r.struck)note(mc?r.cells[mc]:"",tc?r.cells[tc]:"",rfRowSector(r,rf.columns),"rfInventory"); });
  }
  G.forEach(g=>{
    const tabs=[...new Set(g.tabs)];
    const uni=(tabs.length===1&&tabs[0]===RL_TAB.rfInventory)?uRf:uDs;
    add(_rlLine("Added "+g.name,{sector:_rlSecPhrase(g.secs,uni),where:_rlJoin(tabs,2)}),g.keys[0]);
  });
  /* the other tabs: as before */
  ["equipmentCalc"].concat(_rlAntKeys()).forEach(k=>(A[k]||[]).forEach(r=>{
    if(!r.inserted)return; restT.push(RL_TAB[k]);
    const sx=_rlSector(r.sector!=null?r.sector:r.secPos); if(sx)restS.push(sx); }));
  [["equipmentCalc",A.ecTable],["portLevel",A.portLevel]].forEach(([k,T])=>{
    if(T&&T.rows)T.rows.forEach(r=>{ if(!r.inserted)return; restT.push(RL_TAB[k]);
      const sx=_rlSector(rfRowSector(r,T.columns)); if(sx)restS.push(sx); }); });
  if(restT.length)add(_rlLine("Equipment added to the design",
    {sector:_rlJoin(restS),where:_rlJoin(restT,2)}),"designSummary");
}
