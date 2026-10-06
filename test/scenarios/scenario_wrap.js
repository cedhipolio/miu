const out={};
/* a free text box with prose that must break between words */
maAddTextBox(0,0.12,0.30,"A NOTE THAT WRAPS INSIDE ITS OWN BOX",0.22,0.05);
const tb=S.annos[S.annos.length-1];
out.tb={nw:tb.nw,nh:tb.nh,kind:tb.maKind};
out.tbLines=redlineWrapLines(tb.text,tb.size,0,tb.nw,markFontKey(tb),wrapsWords(tb));
/* a callout box */
MA_CALLOUT_TEXT="New Sector Frame\nMFR: Sabre\nPart# C10841002C\n(1) per sector";
maPlaceCallout(0,0.62,0.55);
const shp=S.annos.filter(a=>isShape(a)).pop();
out.calloutLines=redlineWrapLines("New Sector Frame",shp.size,0,shp.nw*0.9,markFontKey(shp),true);
/* an over-long single word still fills per character */
out.longWord=redlineWrapLines("SUPERCALIFRAGILISTIC",8,0,0.03,markFontKey(null),true);
/* a CELL redline must still break per character */
const pn=Math.min(3,S.pages.length-1); const P=S.pages[pn]; const run=(P.items||[]).find(t=>/Ericsson/i.test(t.str))||P.items[8];
if(run){ maStrikeAndWrite(pn,run); const c=S.annos[S.annos.length-1];
  out.cellWordsMode=wrapsWords(c); }
await new Promise(r=>setTimeout(r,600));
const ed=(function(){const d=document.querySelector('.anno[data-id="'+tb.id+'"]');return d&&d.querySelector('.ed');})();
out.css=ed?{wb:getComputedStyle(ed).wordBreak,ow:getComputedStyle(ed).overflowWrap,lh:getComputedStyle(ed).lineHeight}:null;
out.h=ed?Math.round(ed.getBoundingClientRect().height):null;
return JSON.stringify(out);
