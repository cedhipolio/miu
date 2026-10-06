  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  await sleep(600);
  const a=S.annos.find(x=>x.kind==="img");
  return {annos:S.annos.length,lines:S.lines.length,
          img:a?{maKind:a.maKind,nw:+a.nw.toFixed(4),nh:+a.nh.toFixed(4),col:a.col,sw:a.sw,op:a.fillOp,
                 src:!!a.src}:null};
