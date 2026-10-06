const out={};
$("#c_text").value="#0b7285"; $("#c_sw").value="2"; $("#c_fill").value="#c5f6fa"; $("#c_fop").value="45";
maAddShape(0,"rect",0.15,0.40,0.22,0.06,{text:"KEEP ME"});
maAddShape(0,"ellipse",0.45,0.40,0.14,0.08);
addLine(0,0.15,0.70,0.40,0.78,{arrow:"both",col:"#0b7285",sw:3});
maPolyPoint(0,0.55,0.60); maPolyPoint(0,0.68,0.68); maPolyPoint(0,0.80,0.60); maPolyFinish();
await manualSave();
out.saved=S.annos.length+"/"+S.lines.length;
S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
/* the restore asks first — kick it off and answer it below */
tryRestoreAutosave();
out.asked=true;
return JSON.stringify(out);
