const out={};
/* a text box with no ground, over printed text */
$("#c_text").value="#1864ab"; $("#c_bg").value="#ffffff"; $("#c_sw").value="2";
$("#c_fill").value="#d0ebff"; $("#c_fop").value="30"; $("#c_font").value="arialbold"; $("#c_pt").value="10";
const t=maAddTextBox(0,0.14,0.30,"NOTE WITH NO GROUND");
selectAnno(t);
document.querySelector('#annobar [data-bgoff]').click();
out.bgNone=S.annos.find(a=>a.id===t).bgNone;
/* a box, then restyle it from the mark's own bar after changing the ribbon */
const b=maAddShape(0,"rect",0.14,0.38,0.26,0.06,{text:"RESTYLE ME"});
$("#c_text").value="#c92a2a"; $("#c_fill").value="#ffe3e3"; $("#c_fop").value="55"; $("#c_sw").value="3";
selectAnno(b);
document.querySelector('#annobar [data-style]').click();
const bb=S.annos.find(a=>a.id===b);
out.restyled={col:bb.col,fill:bb.fill,op:bb.fillOp,sw:bb.sw};
/* a polyline, then a head added from the stroke bar */
maPolyPoint(0,0.55,0.60); maPolyPoint(0,0.66,0.68); maPolyPoint(0,0.80,0.60);
const lid=maPolyFinish();
selectLine(lid);
document.querySelector('#linebar [data-larrow]').click();
out.arrow=S.lines.find(l=>l.id===lid).arrow;
document.querySelector('#linebar [data-larrow]').click();
out.arrow2=S.lines.find(l=>l.id===lid).arrow;
/* the marks drawer names things */
refreshMarks();
out.drawer=[...document.querySelectorAll("#marksList .mk-t")].map(e=>e.textContent.trim()).slice(0,6);
await exportPdf();
out.counts={annos:S.annos.length,lines:S.lines.length};
return JSON.stringify(out);
