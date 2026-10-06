/* draw one of everything the new panels can set, then export */
const out={};
tpOpen("box"); tpPut("c_sw",2); tpSet("dash","dash"); tpSet("pat","cross"); tpSet("patCol","#1c60ff");
tpOpen("circle"); tpSet("colOp",0.5); tpSet("hl",true);
tpOpen("line"); tpSet("lpat","wave"); tpSet("le0","circle"); tpSet("le1","diamond");
tpOpen("arrow"); tpSet("dash","dot"); tpSet("le1","oarrow");
tpOpen("text"); tpSet("uline",true); tpSet("strikeout",false); tpPut("c_font","timesbold");
tpClose();
setMode("box");    maAddShape(0,"rect",0.08,0.28,0.18,0.08);
setMode("circle"); maAddShape(0,"ellipse",0.30,0.28,0.14,0.08);
setMode("line");   addLine(0,0.10,0.45,0.45,0.45,{});
setMode("arrow");  addLine(0,0.10,0.52,0.45,0.58,{});
setMode("text");   maAddTextBox(0,0.55,0.28,"UNDERLINED NOTE",0.22,0.05);
out.made=S.annos.map(a=>({k:a.maKind,dash:a.dash||null,pat:a.pat||null,colOp:a.colOp!=null?a.colOp:1,
                          hl:!!a.hl,uline:!!a.uline,font:a.font}));
out.strokes=S.lines.map(l=>({le:endsOf(l),lpat:l.lpat||"straight",dash:l.dash||"solid"}));
await exportPdf();
await new Promise(r=>setTimeout(r,1500));
return JSON.stringify(out);
