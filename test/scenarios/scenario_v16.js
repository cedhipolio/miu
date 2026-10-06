  const out={}; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  maPanelOpen(false); gotoPageInstant(0); await sleep(400);
  S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
  const pg=document.querySelector('.page[data-idx="0"]');
  const R=()=>pg.getBoundingClientRect();
  const P=(fx,fy)=>({clientX:R().left+R().width*fx,clientY:R().top+R().height*fy,bubbles:true,button:0});
  skPick("snapshot"); await sleep(120);
  /* snap a patch of the printed cover page — black text on white */
  pg.dispatchEvent(new PointerEvent("pointerdown",P(0.12,0.16)));
  pg.dispatchEvent(new PointerEvent("pointermove",P(0.62,0.30)));
  pg.dispatchEvent(new PointerEvent("pointerup",P(0.62,0.30)));
  await sleep(2500);
  const a=S.annos.find(x=>x.maKind==="snapshot");
  out.mark={col:a&&a.col,sw:a&&a.sw,tint:a&&a._tintCol};
  const px=async src=>await new Promise(res=>{
    const im=new Image();
    im.onload=()=>{ const c=document.createElement("canvas"); c.width=im.width;c.height=im.height;
      const g=c.getContext("2d"); g.drawImage(im,0,0);
      const d=g.getImageData(0,0,c.width,c.height).data;
      let clear=0,ink=0,other=0,sample=null;
      for(let k=0;k<d.length;k+=4){
        if(d[k+3]<8){ clear++; continue; }
        ink++;
        if(!sample&&d[k+3]>200)sample=[d[k],d[k+1],d[k+2]];
        if(Math.abs(d[k]-d[k+1])<20&&Math.abs(d[k+1]-d[k+2])<20)other++;   /* grey/black = not tinted */
      }
      res({w:im.width,h:im.height,clear,ink,grey:other,sample}); };
    im.onerror=()=>res(null);
    im.src=src; });
  out.picture=await px(a.src);
  /* changing the colour re-inks it */
  a.col="#12b886"; layoutAnnos(); await sleep(900);
  out.afterRecolour=await px(S.annos.find(x=>x.maKind==="snapshot").src);
  out.tintNow=S.annos.find(x=>x.maKind==="snapshot")._tintCol;
  return out;
