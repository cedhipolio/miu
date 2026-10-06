/* the side ribbon and the page-view chrome are the two layouts the new group has to survive */
const out={};
setRibbonSide("right");
await new Promise(r=>setTimeout(r,500));
const g=document.querySelector("#toolbar .grp-style .stylegrid");
const r=g.getBoundingClientRect();
const tb=document.getElementById("toolbar").getBoundingClientRect();
out.side={grid:Math.round(r.width),ribbon:Math.round(tb.width),fits:r.right<=tb.right+2};
setRibbonSide("top");
await new Promise(r2=>setTimeout(r2,500));
const r2=g.getBoundingClientRect(), tb2=document.getElementById("toolbar").getBoundingClientRect();
out.top={grid:Math.round(r2.width),fits:r2.right<=tb2.right+2};
/* every control still reachable */
out.controls=["c_text","c_bg","c_fill","c_sw","c_fop","c_pt","c_font"].map(id=>{
  const e=document.getElementById(id); const b=e.getBoundingClientRect();
  return {id,w:Math.round(b.width),visible:b.width>0&&b.height>0};
});
return JSON.stringify(out);
