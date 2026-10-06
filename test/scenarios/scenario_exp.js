  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const out={errors:[]};
  window.addEventListener("error",e=>out.errors.push(String(e.message)));
  gotoPageInstant(0); await sleep(300);
  S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
  MA_CALLOUT_TEXT="sample";
  maPlaceCallout(0,0.55,0.40,"sample");
  await sleep(400);
  try{document.activeElement.blur();}catch(e){}
  out.marks={a:S.annos.length,l:S.lines.length};
  /* the UI path: press the ribbon's Export button */
  const btn=document.querySelector("#exportBtn")||document.querySelector('[id*="xport"]');
  out.button=btn?btn.id:null;
  try{ if(btn)btn.click(); }catch(e){ out.errors.push("click: "+e.message); }
  await sleep(4000);
  out.status=(document.querySelector("#status")||{}).textContent||null;
  /* and the direct path, with the error surfaced */
  try{ await exportPdf(); }catch(e){ out.errors.push("exportPdf: "+(e&&e.message||e)); }
  await sleep(3000);
  out.status2=(document.querySelector("#status")||{}).textContent||null;
  return out;
