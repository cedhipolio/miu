/* ===== Mark It Up v88 — the redline report, per sector (appended to the RFDS app by tools/embed_rfds.py) =====
   Ced: "make the summary for rfds tool not too specific. for sectors with same redline, just make it per
   sector." The RFDS report named every antenna position a correction touched, and every position's own
   value — nine places for what is, on the tower, three sectors each set one way. Now:
     where   a sector whose every position was corrected is named as the sector ("in Alpha and B-2"), and
             a correction in every sector's every position is still "every position";
     values  a sector whose positions all moved to the same value is ONE entry for the sector ("Alpha 30°
             instead of 0°"), and sectors (or positions) that share a value share an entry ("Alpha and Beta
             120' instead of 118'"). Positions are only spelled out where one sector's positions differ.
   Two small call-site patches pass the position list the line covers (uPos / uPort) as the universe. */
;(function(){
  const sec=p=>{ try{ return _rlSector(p)||""; }catch(e){ return ""; } };
  const uniq=a=>[...new Set((a||[]).filter(Boolean))];
  const bySector=list=>{ const m=new Map(); list.forEach(p=>{ const s=sec(p); if(!m.has(s))m.set(s,[]); m.get(s).push(p); }); return m; };
  const full=(s,have,U)=>{ if(!s||/^site-wide$/i.test(s))return false; const all=U.get(s); return !!(all&&all.length>1&&all.every(p=>have.indexOf(p)>=0)); };
  /* v93 — Ced: "make it simpler by saying POS 1 in all sectors and POS 3 in all sectors". A position
     number corrected in EVERY sector that carries it (A-1, B-1 and C-1) is "POS 1 in all sectors". */
  const posNo=p=>{ const m=String(p||"").match(/^[A-Za-z]+\s*-\s*(\d+)$/); return m?m[1]:null; };
  const byPos=(places,Ua)=>{
    const U=new Map(); Ua.forEach(p=>{ const n=posNo(p); if(n){ if(!U.has(n))U.set(n,new Set()); U.get(n).add(sec(p)); } });
    const out=[], done=new Set();
    places.forEach(p=>{
      const n=posNo(p);
      if(n&&!done.has(n)&&U.has(n)&&U.get(n).size>=2){
        const want=[...U.get(n)], got=new Set(places.filter(q=>posNo(q)===n).map(sec));
        if(want.every(s=>got.has(s))){ done.add(n); out.push("POS "+n+" in all sectors"); return; }
      }
      if(n&&done.has(n))return;
      out.push(p);
    });
    return out;
  };
  _rlPosPhrase=function(hit,universe){
    const H=uniq(hit); if(!H.length)return "";
    const Ua=uniq(universe);
    if(Ua.length>=3&&Ua.every(x=>H.indexOf(x)>=0))return "every position";
    const U=bySector(Ua), HB=bySector(H), out=[]; let allSec=true;
    const rest=[];
    HB.forEach((ps,s)=>{ if(full(s,H,U))out.push(s); else { allSec=false; rest.push(...ps); } });
    if(rest.length)out.push(...byPos(rest,Ua.filter(p=>out.indexOf(sec(p))<0)));
    const secsU=[...U.keys()].filter(s=>s&&!/^site-wide$/i.test(s));
    if(allSec&&secsU.length>=2&&secsU.every(s=>out.indexOf(s)>=0))return "all sectors";
    return _rlJoin(out);
  };
  _rlPairsWithPlace=function(items,universe){
    const it=(items||[]).filter(x=>x&&x.pair);
    const bare=uniq(it.map(x=>x.pair));
    if(bare.length<=1)return bare;
    const U=bySector(uniq(universe)), groups=new Map();
    it.forEach(x=>{ const s=sec(x.place); if(!groups.has(s))groups.set(s,[]); groups.get(s).push(x); });
    const entries=[];
    groups.forEach((xs,s)=>{
      const pairs=uniq(xs.map(x=>x.pair)), places=uniq(xs.map(x=>x.place));
      /* one value across the sector: the sector is the place — when the rows cover the whole sector, or
         when the line has no position list to check against */
      const whole=!U.size?places.length>1:full(s,places,U);
      if(s&&!/^site-wide$/i.test(s)&&pairs.length===1&&whole)entries.push({place:s,pair:pairs[0]});
      else xs.forEach(x=>entries.push({place:x.place||"",pair:x.pair}));
    });
    /* places that share a value share an entry */
    const byPair=new Map();
    entries.forEach(e=>{ if(!byPair.has(e.pair))byPair.set(e.pair,[]); const a=byPair.get(e.pair); if(e.place&&a.indexOf(e.place)<0)a.push(e.place); });
    const Ua=uniq(universe);
    return [...byPair].map(([pair,places])=>{
      const pl=Ua.length?byPos(places,Ua):places;
      return (pl.length?_rlJoin(pl)+" ":"")+pair; });
  };
})();
