const out={};
$("#c_font").value="arial";
const id1=addText(0,0.15,0.30,"ARIAL DEFAULT");
$("#c_font").value="timesbold";
const id2=addText(0,0.15,0.36,"TIMES BOLD");
$("#c_font").value="courier";
maAddShape(0,"rect",0.15,0.44,0.26,0.05,{text:"COURIER IN A BOX"});
out.fonts=S.annos.map(a=>({t:(a.text||"").slice(0,16),font:a.font}));
/* restyle the first one to Courier via the dropdown path */
selectAnno(id1); $("#c_font").value="courierbold"; out.restyled=maRestyleSelection("font");
out.after=S.annos.map(a=>a.font);
await exportPdf();
return JSON.stringify(out);
