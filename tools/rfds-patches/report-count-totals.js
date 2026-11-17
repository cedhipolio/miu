/* ===== Mark It Up v89 — what the equipment count correction WAS (appended to the RFDS app by tools/embed_rfds.py) =====
   Ced: "add the total changes on Actual equipment count in Alpha, Beta and Gamma on Design Summary. only the
   total value of the changed item example: (9 existing RRHs removals, 5 DC trunks total, 1 fiber trunk in
   Beta, 2 squids (Alpha and Beta))".
   "Actual equipment count in Alpha, Beta and Gamma" said a count had moved and not which, or to what. The
   parenthesis now carries one entry per corrected item: the value that was corrected, summed over the
   sectors it was corrected in — Existing when Before was changed, Final ("total") when After was, the
   Removal or Addition typed when the counts were edited directly. The sectors follow when they are not
   every sector the table carries: "in Beta" for one, "(Alpha and Beta)" for several. */
function _miuDsCountPair(A,uDs){
  const val=(o,k)=>int(o[k]!=null?o[k]:o[k+"s"]);
  const G=new Map();
  (A&&A.designSummary||[]).forEach(r=>{
    if(r.struck||r.inserted)return;
    const chB=int(r.before)!==int(r.origBefore), chA=int(r.after)!==int(r.origAfter);
    if(!chB&&!chA&&!r.manual)return;
    const d=rowCounts(r), p=r.printed||{};
    if(!["existing","removal","addition","final"].some(k=>val(d,k)!==val(p,k)))return;
    /* ONE value per corrected row — the one that was corrected: the Removal/Addition typed directly,
       else the Final total when After moved, else Existing when only Before did */
    const cols=[];
    if(r.manual){ const k=(d.lead==="addition")?"addition":"removal"; if(val(d,k)!==val(p,k))cols.push(k); }
    if(!cols.length&&chA)cols.push("final");
    if(!cols.length&&chB)cols.push("existing");
    if(!cols.length)["final","existing","removal","addition"].forEach(k=>{ if(!cols.length&&val(d,k)!==val(p,k))cols.push(k); });
    const sx=_rlSector(r.sector);
    cols.forEach(k=>{
      const key=String(canonType(String(r.type||"").trim())||"")+"|"+k;
      if(!G.has(key))G.set(key,{type:r.type,k,n:0,secs:[]});
      const g=G.get(key); g.n+=val(d,k); if(sx)g.secs.push(sx);
    });
  });
  const U=[...new Set((uDs||[]).filter(s=>s&&!/^site-wide$/i.test(s)))];
  const out=[];
  G.forEach(g=>{
    const one=g.n===1, noun=_rlModelPhrase(g.type,"",one), unit=_rlModelPhrase(g.type,"",true);
    let t=g.k==="existing"?(g.n+" existing "+noun)
         :g.k==="final"   ?(g.n+" "+noun+" total")
         :(g.n+" "+unit+" "+(g.k==="removal"?"removal":"addition")+(one?"":"s"));
    const S2=[...new Set(g.secs.filter(s=>!/^site-wide$/i.test(s)))];
    const all=U.length>=2&&U.every(s=>S2.indexOf(s)>=0);
    if(S2.length===1&&!all)t+=" in "+S2[0];
    else if(S2.length>1&&!all)t+=" ("+_rlJoin(S2)+")";
    out.push(t);
  });
  return out.join(", ");
}
