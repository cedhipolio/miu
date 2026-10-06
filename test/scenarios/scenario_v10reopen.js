  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  await sleep(400);
  drawAllLines();
  const box=S.annos.find(a=>a.maKind==="callout");
  const ld=S.lines.find(l=>l.maKind==="calloutleader");
  return {annos:S.annos.length,lines:S.lines.length,
    hatch:(S.annos.find(a=>a.pat)||{}).pat||null,
    closed:(S.lines.find(l=>l.closed)||{}).pat||null,
    callout:!!box, leader:!!ld,
    adopted:!!(box&&ld&&ld.coFor===box.id),
    grouped:!!(box&&box.group!=null)};
