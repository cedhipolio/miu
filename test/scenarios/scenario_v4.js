const out={};
/* ---- per-tool styles ---- */
setMode("box");       out.boxStyle={fill:$("#c_fill").value,op:$("#c_fop").value,col:$("#c_text").value};
$("#c_text").value="#1c7ed6"; $("#c_text").dispatchEvent(new Event("input"));
setMode("arrow");     out.arrowStyleAfter=$("#c_text").value;
setMode("box");       out.boxRemembered=$("#c_text").value;
setMode("redline");   out.redlineStyle={col:$("#c_text").value,size:$("#c_pt").value};

/* ---- shapes come with a white opaque fill ---- */
setMode("box");
const b=maAddShape(0,"rect",0.15,0.30,0.22,0.07,{text:"BOX WITH TEXT"});
const bb=S.annos.find(a=>a.id===b);
out.shapeFill={fill:bb.fill,op:bb.fillOp};

/* ---- resize a shape that has text ---- */
const w0=bb.nw,h0=bb.nh;
bb.nw+=0.05; bb.nh+=0.02;           /* what a handle drag does */
layoutAnnos();
out.shapeResized={from:+w0.toFixed(3),to:+bb.nw.toFixed(3)};

/* ---- a text box, sized and resizable from the start ---- */
setMode("text");
const t=maAddTextBox(0,0.15,0.46,"A NOTE THAT WRAPS INSIDE ITS OWN BOX",0.22,0.05);
const tb=S.annos.find(a=>a.id===t);
out.textBox={nw:+tb.nw.toFixed(3),nh:+tb.nh.toFixed(3),wrap:tb.wrap,manualW:tb.manualW,kind:tb.maKind};

/* ---- the callout leader turns to follow its head ---- */
setMode("callout");
MA_CALLOUT_TEXT="New Sector Frame\nMFR: Sabre\nPart# C10841002C";
maPlaceCallout(0,0.72,0.60);
const lead=S.lines.find(l=>l.maKind==="calloutleader");
const box=S.annos.find(a=>a.maKind==="callout");
out.leader0={pts:lead.pts.map(p=>p.map(v=>+v.toFixed(3))),arrow:lead.arrow};
/* move the head to the other side of the box and redraw */
lead.pts[2]=[box.nx-0.12,box.ny+box.nh/2]; drawAllLines();
out.leaderLeft=lead.pts.map(p=>p.map(v=>+v.toFixed(3)));
/* and below it */
lead.pts[2]=[box.nx+box.nw/2,box.ny+box.nh+0.12]; drawAllLines();
out.leaderBelow=lead.pts.map(p=>p.map(v=>+v.toFixed(3)));
out.boxRect=[+box.nx.toFixed(3),+box.ny.toFixed(3),+box.nw.toFixed(3),+box.nh.toFixed(3)];
await exportPdf();
return JSON.stringify(out);
