function modeGroups(doc){
  const tb=doc&&doc.getElementById("toolbar"); if(!tb)return [];
  return [...tb.children].filter(e=>e.classList.contains("grp")&&!e.classList.contains("mode-spacer")&&
    doc.defaultView.getComputedStyle(e).display!=="none");
}
function modeClearAlign(doc){
  if(!doc)return;
  doc.querySelectorAll("#toolbar .mode-spacer, #toolbar .mode-ph, #miniBar .mode-ph").forEach(e=>e.remove());
  doc.querySelectorAll("[data-mslot]").forEach(g=>{
    ["flex","min-width","min-height","box-sizing"].forEach(p=>g.style.removeProperty(p));
    if(g.dataset.mslot==="h")g.style.removeProperty("height");
    if(g.dataset.mslot==="row"){ ["align-self","margin-left","width","flex"].forEach(p=>g.style.removeProperty(p)); }
    if(g.dataset.mslot==="pages"){ g.style.removeProperty("margin-left"); g.style.removeProperty("margin-right"); }
    g.removeAttribute("data-mslot");
  });
}
function modeNatural(doc,right){
  const gs=modeGroups(doc);
  if(!right)gs.forEach(g=>g.style.flexGrow="0");
  const out=gs.map(g=>{ const r=g.getBoundingClientRect();
    return {el:g,lbl:(g.dataset.lbl||g.id||"").trim(),size:right?r.height:r.width,cross:right?r.width:r.height,
            rows:[...g.children].filter(c=>c.classList.contains("grow"))}; });
  out.forEach(o=>o.rw=o.rows.map(c=>c.getBoundingClientRect().width));
  if(!right)gs.forEach(g=>g.style.removeProperty("flex-grow"));
  return out;
}
/* line the two group lists up: shared names are anchors (longest common run); between two anchors the
   leftovers pair off in order, and whatever is left over gets an empty slot on the other side */
function modeMerge(A,B){
  const n=A.length,m=B.length, L=[...Array(n+1)].map(()=>new Array(m+1).fill(0));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)
    L[i][j]=A[i].lbl&&A[i].lbl===B[j].lbl?L[i+1][j+1]+1:Math.max(L[i+1][j],L[i][j+1]);
  const out=[]; let i=0,j=0, ra=[], rb=[];
  const flush=()=>{ const k=Math.max(ra.length,rb.length);
    for(let q=0;q<k;q++)out.push({a:ra[q]||null,b:rb[q]||null,same:false}); ra=[]; rb=[]; };
  while(i<n||j<m){
    if(i<n&&j<m&&A[i].lbl&&A[i].lbl===B[j].lbl){ flush(); out.push({a:A[i],b:B[j],same:true}); i++; j++; }
    else if(j>=m||(i<n&&L[i+1][j]>=L[i][j+1])){ ra.push(A[i]); i++; }
    else { rb.push(B[j]); j++; }
  }
  flush();
  return out;
}
/* the same tool under two names */
const SEAT_ALIAS={grab:"pan"};
function modeSeatKey(e){ const k=e.id||(e.dataset&&(e.dataset.mode||e.dataset.click))||""; return SEAT_ALIAS[k]||k; }
/* display, not visibility: while one tool is in front the other is visibility-hidden as a whole, and
   that must not read as "has no buttons" */
function modeVisible(e){ return e.ownerDocument.defaultView.getComputedStyle(e).display!=="none"&&!e.hidden; }
function modeSeats(ga,gb,direct){
  const ra=direct?[ga]:[...ga.children].filter(c=>c.classList.contains("grow")),
        rb=direct?[gb]:[...gb.children].filter(c=>c.classList.contains("grow"));
  for(let q=0;q<Math.min(ra.length,rb.length);q++){
    const A=[...ra[q].children].filter(modeVisible).map(e=>({el:e,lbl:modeSeatKey(e)}));
    const B=[...rb[q].children].filter(modeVisible).map(e=>({el:e,lbl:modeSeatKey(e)}));
    const pairs=modeMerge(A,B);
    /* an RFDS tool left over at the END would open a seat past Mark It Up's last one and wrap the group
       onto a new row; it takes the last empty RFDS seat instead (only the RFDS side is ever reordered) */
    while(pairs.length&&!pairs[pairs.length-1].a&&pairs[pairs.length-1].b){
      let k=-1; for(let z=pairs.length-2;z>=0;z--){ if(pairs[z].a&&!pairs[z].b){k=z;break;} }
      if(k<0)break;
      const x=pairs.pop().b; pairs[k].b=x; pairs[k].moved=true;
    }
    let la=null, lb=null;
    const seat=(row,last,other)=>{
      const r=other.el.getBoundingClientRect(), ph=row.ownerDocument.createElement("span");
      ph.className="mode-ph"; ph.setAttribute("aria-hidden","true");
      ph.style.cssText="display:inline-block;flex:none;visibility:hidden;width:"+r.width+"px;height:"+r.height+"px";
      if(last)last.after(ph); else row.insertBefore(ph,row.firstChild);
      return ph;
    };
    pairs.forEach(p=>{
      la=p.a?p.a.el:seat(ra[q],la,p.b);
      if(p.b&&p.moved){ if(lb)lb.after(p.b.el); else rb[q].insertBefore(p.b.el,rb[q].firstChild); }
      lb=p.b?p.b.el:seat(rb[q],lb,p.a);
    });
  }
}
