const out={};
$("#c_text").value="#e8590c"; $("#c_sw").value="2.5"; $("#c_fill").value="#ffec99"; $("#c_fop").value="35";
const b=maAddShape(0,"rect",0.15,0.40,0.22,0.06,{text:"BOX"});
const c=maAddShape(0,"ellipse",0.45,0.40,0.14,0.08);
maPolyPoint(0,0.55,0.60); maPolyPoint(0,0.68,0.68); maPolyPoint(0,0.80,0.60);
const pl=maPolyFinish();
const ar=addLine(0,0.15,0.70,0.40,0.78,{arrow:"end"});
maAddTextBox(0,0.15,0.86,"TEXT");

/* --- the drawer names things --- */
toggleMarks();
await new Promise(r=>setTimeout(r,300));
out.drawer=[...document.querySelectorAll("#marksList .mk-t")].map(e=>e.textContent.trim());
toggleMarks();

/* --- group a shape with a stroke, move the group, ungroup --- */
selectAnno(b); S.selMulti.add(b); S.selMultiL.add(ar); paintMulti();
out.grouped=groupSelected();
const g=S.annos.find(a=>a.id===b).group;
out.groupIdsMatch=(g!=null && S.lines.find(l=>l.id===ar).group===g);
selectGroup(g);
out.groupSel={a:S.selMulti.size,l:S.selMultiL.size};
ungroupSelected();
out.ungrouped=(S.annos.find(a=>a.id===b).group==null);

/* --- zoom: the marks must keep their place on the page --- */
const before=S.annos.find(a=>a.id===b);
const geo0={nx:before.nx,ny:before.ny,nw:before.nw};
await setZoom(1.9);
await new Promise(r=>setTimeout(r,500));
const after=S.annos.find(a=>a.id===b);
out.zoomStable=(Math.abs(after.nx-geo0.nx)<1e-6&&Math.abs(after.nw-geo0.nw)<1e-6);
const el=document.querySelector('.anno[data-id="'+b+'"] .ed');
const pgEl=document.querySelector('.page[data-idx="0"]');
out.zoomDrawn=el?Math.round(el.getBoundingClientRect().width):0;
out.zoomExpect=Math.round(geo0.nw*pgEl.offsetWidth);
await setZoom(1.2);
await new Promise(r=>setTimeout(r,400));

return JSON.stringify(out);
