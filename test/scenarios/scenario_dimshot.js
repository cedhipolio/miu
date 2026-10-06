  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  maPanelOpen(false); gotoPageInstant(0); await sleep(400);
  S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
  /* three measurements, the way they land on a mount drawing: across, up, and on the diagonal */
  maPlaceDim(0,0.18,0.34,0.62,0.34);
  maPlaceDim(0,0.72,0.28,0.72,0.62);
  maPlaceDim(0,0.22,0.52,0.58,0.70);
  setMode("select"); selectLine(null); selectAnno(null);
  layoutAnnos(); drawAllLines(); await sleep(400);
  const out={ readings:S.annos.filter(a=>a.maKind==="dimlabel").map(a=>a.text),
              rots:S.annos.filter(a=>a.maKind==="dimlabel").map(a=>a.rot) };
  window.scrollTo(0,document.querySelector('.page[data-idx="0"]').offsetTop-120);
  await sleep(400);
  if(window.__shotOnly)return out;
  await exportPdf(); await sleep(3000);
  return out;
