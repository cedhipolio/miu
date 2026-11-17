/* ===== Mark It Up v90 — a centred cell redline aims at its COLUMN (appended to the RFDS app by tools/embed_rfds.py) =====
   Ced, with a clip of an Antenna Position page: the as-built figures in the first position column sat a
   few points left of the design figures above them, while the second column lined up. The redline aimed
   at the printed value of its OWN cell, and in that column the as-built cells print off the column's
   axis — so the correction faithfully copied the page's misplacement. Where the column's other printed
   values agree on one centre line (a centred column: most of them within half a point of each other), that
   line is the target; a column that is not centred (left-set values of different lengths) has no such line
   and keeps the old aim. */
function _miuColCentre(pi,box,printedC){
  try{
    const P=S.pages[pi]; if(!P||box.colL==null||box.colR==null)return printedC;
    const L=box.colL, R=box.colR, y0=box.ny, y1=(box.y2!=null?box.y2:box.ny+(box.nh||0));
    const cs=[];
    (P.items||[]).forEach(t=>{
      if(!String(t.str||"").trim())return;
      const x1=t.nx, x2=t.nx+(t.nw||0);
      if(x1<L-0.002||x2>R+0.002)return;                       // wholly inside this column
      const ty0=t.ny, ty1=t.ny+(t.nh||0);
      if(ty1>y0-0.001&&ty0<y1+0.001)return;                   // not this cell's own row
      cs.push((x1+x2)/2);
    });
    if(cs.length<3)return printedC;
    cs.sort((a,b)=>a-b);
    const med=cs[Math.floor(cs.length/2)];
    const tol=0.5/((P.wPt||612));                              // half a point, in page widths
    const agree=cs.filter(c=>Math.abs(c-med)<=Math.max(tol,0.0008)).length;
    if(agree<Math.max(3,Math.ceil(cs.length*0.6)))return printedC;
    /* only a correction of a few points: anything bigger means this is not the same column */
    if(printedC!=null&&Math.abs(med-printedC)>0.02)return printedC;
    return med;
  }catch(e){ return printedC; }
}
