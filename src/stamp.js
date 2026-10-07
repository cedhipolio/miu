/* =================================================================================================
   6k4 — THE AT&T COP STAMP, BROUGHT INSIDE.

   Ced: "can you integrate this tool within the MIU tool? and make sure it works in realtime, and
   the stamps are editable as well."

   The standalone COP Stamp Tool was a batch processor: you fed it PDFs, it drew a stamp into each
   page with pdf-lib and handed the files back. Nothing about that survives contact with a redlining
   tool — you could not see the stamp until it was saved, you could not nudge it off a callout it had
   landed on, and correcting a typo in the POC meant stamping the file again from scratch. MIU's
   export already sent you to the hosted copy (`STAMP_URL`), which is to say the two tools were used
   on the same document, one after the other, with a download in between.

   WHAT IS DIFFERENT HERE. A stamp is not drawn into the page. It is built out of MIU's own marks —
   one rectangle and four text boxes, grouped — and from that moment it is an ordinary redline:

     · it appears the instant you place it, on the sheet, at the size it will export at;
     · it drags, it resizes, it rotates, it has a mini bar and a right-click menu;
     · v37's group isolation means a double-click edits ONE line of it and the stamp stays a stamp;
     · the export writes it through the same path as every other mark, so there is no second
       export route to keep in step and no flattening;
     · undo, autosave, reopen, apply-to-pages and the markup library all work on it already.

   The parts worth keeping from the old tool are its JUDGEMENT, and those are ported whole:

     THE SIZE RULE. Everything is calibrated to a letter page's 612pt short edge and then scaled by
     how the real sheet compares, clamped to 1..4. A 24x36 drawing gets a proportionally larger
     stamp, so it occupies the same share of every sheet and reads the same when each document is
     zoomed to fit. A fixed point size looks right on letter and vanishes on a large-format sheet.

     THE BLANK-SPACE SEARCH. An RFDS gets its stamp centred on the grey header band, right-aligned
     but clear of "Page 1 of 1". A drawing or a mount analysis hugs the upper right and travels DOWN
     the sheet past callouts and tables to find room, requiring a band of white all round rather than
     merely an absence of ink. Both are ported as they were; what changed is only that they measure a
     page MIU has already opened instead of a file being read for the first time.

   WHAT IS DELIBERATELY NOT PORTED: the multi-file queue. MIU is a one-document tool, and "every page
   of this document" is the scope that means anything here.
   ================================================================================================= */

/* The two lists are the ones the standalone tool shipped with. They are a starting point, not a
   closed set — "Other…" takes anything, and whatever is typed is remembered for next time. */
const COP_GCS=["TSC CONSTRUCTION LLC","HEIGHTS TOWER SERVICE","SWARTLEY BROTHERS ENGINEERS",
  "STS COMMUNICATIONS","ADB","KMM TELECOMMUNICATIONS","TRIPLE CONNECT",
  "TIMBERLINE COMMUNICATIONS","F&S TELECOM","NEXTEDGE NETWORKS"];
const COP_POCS=["JOSHUA BEAVER","AARON COOKE","JACKSON SHAFF","EDEN TA","DAVID WESTCOAT",
  "DANIEL OLIVER JR.","CODY HUBBARD","BEN MOTTER","TIM CARRICO","KYLE POWERS","MIKE DERSTINE",
  "BRAD BAUMAN","MICHAEL HAYNES","JEFF GIORDANI","ILLIA HIBKHIN","TANNER MATTINSON",
  "PATRICK MCCORMICK","TONY BELMAREZ","HOWIE KINER","SETH HOOVER","TOMMY WOOTEN"];

/* rgb(0.80,0.11,0.11) in the old tool, which is this. Kept exactly: a re-dated stamp sitting beside
   an older one on the same submission must be the same red. */
const COP_RED="#cc1c1c";
/* 6k4 — Arial, and bold. Ced asked for "Arial, and the Redlined or As-Built should be arial bold",
   then sent the stamp he wants it to look like — and measured off that artwork every line is bold:
   stem-to-cap 0.211 on the title and 0.204 on the rows, where Arial Regular would be about 0.13.
   So the family is Arial throughout and the weight is bold throughout; the title is distinguished by
   SIZE, not by weight. The two faces are still named separately below and every measurement takes
   the face as an argument, because a layout computed with one set of metrics and drawn with another
   is exactly how a row ends up clipped — and because one line going lighter is then a one-line
   change rather than a rewrite. */
const COP_FONT_TITLE="arialbold";
const COP_FONT_ROW="arialbold";
const COP_FONT=COP_FONT_ROW;                /* the default where a face is not named */
const COP_STATUSES=["REDLINED","AS-BUILT"];

/* The calibration, in points on a letter page — see THE SIZE RULE above.
   The two TYPE sizes are the standalone tool's, unchanged, because they are what makes a new stamp
   read like the ones already on file. THE SPACING IS NOT. Ced, on the first one placed: "make sure
   the stamp have great spacing", and "the minimum width is met which covers all characters".
   The old numbers were tuned for pdf-lib, which draws a glyph AT a baseline and nothing else; here
   each line is a real line box with ascent and descent, and a 1.6pt pad with 1.43pt between rows put
   the date's descenders through the bottom rule and left the longest row ending flush against the
   right one. Measured on the first build: box 62.44 x 30.15pt, contractor row 59.24pt wide in a
   59.24pt box — no room at all, in either direction.
   So the frame is laid out from LINE BOXES and given room: a pad you can see, a gap under the title,
   and a full pad of slack past the longest line so nothing is ever flush, let alone clipped. */
/* THE PROPORTIONS, TAKEN OFF THE ARTWORK CED SENT. Measured on it, in pixels: box 893x390 outside,
   a 14px rule, the title's caps 76px tall and each row's 49px, 41px from the title's baseline to the
   next line's caps, 19px between the rows after that, and a margin of 33, 32, 33 and 34px on the
   four sides — which is to say one margin, even all the way round.
   Everything below is that drawing, expressed as multiples of the ROW type size so it holds at any
   scale. The row size itself stays 4.73pt, the figure the standalone tool used, so a stamp placed
   today sits beside one placed last year without either looking wrong. */
const COP_ROW_PT=4.73;                  /* the baseline row size on a letter page */
const COP_TITLE_R=1.551;                /* title caps / row caps, 76px against 49px */
const COP_MARGIN_R=0.482;               /* ink to rule, all four sides, 33px against a 49px cap */
const COP_GAP1_R=0.599;                 /* title baseline to the next line's cap top, 41px */
const COP_GAP2_R=0.278;                 /* and between the rows after that, 19px */
const COP_LINE=1.22;                    /* the line box a free text mark lays one line out in */
/* 6kj/6kn — the inset a text mark used to carry (`1pt x 2pt`), which the stamp had to place its row
   boxes that much further out to cancel, because it positions its lines to measured baselines inside
   a frame and the inset moved the ink off them. 6kn took the inset away on the screen and in the
   export together, so a row box is now exactly the row: the allowance is zero and stays named, since
   the geometry below reads much more clearly as "the box, plus whatever the renderer steals". */
const COP_EDX=0, COP_EDY=0;
const COP_REF_SHORT=612, COP_K_MIN=1, COP_K_MAX=4;

const COP_PREF="ma.copStamp";

function copToday(d){
  d=d||new Date();
  return (d.getMonth()+1)+"/"+d.getDate()+"/"+d.getFullYear();
}
function copPrefs(){
  let o={};
  try{ o=JSON.parse(localStorage.getItem(COP_PREF)||"{}")||{}; }catch(e){ o={}; }
  return {
    status:COP_STATUSES.indexOf(o.status)>=0?o.status:"REDLINED",
    gc:typeof o.gc==="string"?o.gc:"",
    poc:typeof o.poc==="string"?o.poc:"",
    place:["auto","tr","tl","br","bl"].indexOf(o.place)>=0?o.place:"auto",
    date:copToday()                         /* never remembered — today is what today means */
  };
}
function copSavePrefs(f){
  try{ localStorage.setItem(COP_PREF,JSON.stringify({status:f.status,gc:f.gc,poc:f.poc,place:f.place})); }
  catch(e){}
}

/* ---------------------------------------------------------------------------------------------
   GEOMETRY. All in POINTS on the page named by `pi`, which is what every mark in this tool is
   measured in. `k` is the sheet-scale described at the top.
   --------------------------------------------------------------------------------------------- */
function copPageDims(pi){
  const P=S.pages[pi];
  if(P&&P.w1&&P.h1)return {w:P.w1,h:P.h1};
  return {w:612,h:792};
}
function copScale(pi){
  const d=copPageDims(pi);
  const k=Math.min(d.w,d.h)/COP_REF_SHORT;
  return Math.max(COP_K_MIN,Math.min(COP_K_MAX,k));
}
/* Width of a string in POINTS.
   Measured at TWENTY TIMES the real size and divided back down. A stamp's rows are 4.73pt, and a
   canvas asked for an advance width at 4.73px rounds it: measured on "TSC CONSTRUCTION LLC",
   12.5248 points of width per point of type at 4.73px against 12.5540 at 94.6px, which is the figure
   the browser actually lays the line out with. A quarter of a percent is nothing on a cell redline
   and it is the difference between a box that holds its text and one that does not. */
function copTextPt(text,sizePt,pi,fontKey){
  const P=S.pages[pi];
  const w1=(P&&P.w1)?P.w1:612;
  const t=String(text==null?"":text);
  if(!t)return 0;
  const M=20;
  try{ return (measureTextNorm(t,sizePt*M,pi,fontKey||COP_FONT,0)*w1)/M; }
  catch(e){ return t.length*sizePt*0.56; }
}

/* =================================================================================================
   EVEN MARGINS, MEASURED OFF THE INK.
   Ced: "make the spacing of top text to top side of box and bottom text and bottom side of box
   even."

   A line box is not the letters in it. The title's line box carries half-leading above it and the
   whole descender space below it, and the bottom row is digits, which have no descenders at all — so
   padding the two LINE BOXES equally puts visibly more air above "REDLINED" than below "11/24/2025".
   Even boxes, uneven stamp.

   So the padding is applied to the INK. The glyph extents come from the canvas, which reports the
   real inked ascent and descent of the actual string, and `cssBaseline` says where the browser puts
   the baseline inside the line box — the same measured-not-assumed route the export uses to place
   text. What is held constant is the gap a reader can see: top, bottom and both sides, one pad each.
   ================================================================================================= */
let _copCtx=null, _copInkMemo={};
/* How far the INK of this exact string reaches above and below its baseline, in points.
   The glyphs are drawn into a canvas at twenty times the real size and the pixels are SCANNED. The
   obvious route, `TextMetrics.actualBoundingBox*`, disagrees with what the engine then paints — on
   "REDLINED" at 7.65pt it reports a cap height of 0.693em against Arial Bold's 0.716, and on
   "11/24/2025" it reports almost no descent at all although the slash drops below the line. Those
   two errors pulled the top and bottom margins apart by about half a point, which at this size is
   the difference Ced could see. A pixel scan cannot disagree with the painter: it IS the painter. */
function copGlyphInk(text,sizePt,fontKey){
  const t=String(text==null?"":text)||"H";
  const key=(fontKey||COP_FONT)+"|"+t;
  const memo=_copInkMemo[key];
  if(memo)return {asc:memo.asc*sizePt, desc:memo.desc*sizePt};
  const EM=200;                                   /* one em, in canvas pixels, for the scan */
  let r={asc:0.716, desc:0.04};                   /* Arial Bold's cap height, as the fallback */
  try{
    if(!_copCtx)_copCtx=document.createElement("canvas").getContext("2d",{willReadFrequently:true});
    const F=MARK_FONTS[fontKey||COP_FONT]||MARK_FONTS[markFontKey(null)];
    const cx=_copCtx;
    cx.font=(F.weight?F.weight+" ":"")+EM+"px "+F.css;
    const w=Math.max(1,Math.ceil(cx.measureText(t).width)+8);
    const base=Math.round(EM*1.4);                /* room for the tallest ascender above it */
    const H=base+Math.round(EM*0.7);              /* and for anything that drops below */
    cx.canvas.width=w; cx.canvas.height=H;
    cx.font=(F.weight?F.weight+" ":"")+EM+"px "+F.css;
    cx.textBaseline="alphabetic";
    cx.fillStyle="#000";
    cx.clearRect(0,0,w,H);
    cx.fillText(t,4,base);
    const d=cx.getImageData(0,0,w,H).data;
    let top=-1, bot=-1;
    for(let y=0;y<H;y++){
      let hit=false;
      for(let x=0;x<w;x++){ if(d[(y*w+x)*4+3]>8){ hit=true; break; } }
      if(hit){ if(top<0)top=y; bot=y; }
    }
    if(top>=0){ r={asc:(base-top)/EM, desc:Math.max(0,(bot-base+1))/EM}; }
    cx.canvas.width=cx.canvas.height=1;
  }catch(e){}
  _copInkMemo[key]=r;
  return {asc:r.asc*sizePt, desc:r.desc*sizePt};
}
/* The baseline's height above a line box's bottom, in points.
   Asked at TWENTY TIMES the size and scaled back, for the third time in this file and the same
   reason: `cssBaseline` lays a real line out in the DOM and reads where it lands, and a stamp's rows
   are 4.73pt, so the browser is being asked to resolve a baseline inside a 5.8px line box. Rounding
   there is half a pixel, which is half a point, which is a third of the stamp's margin — measured,
   it left the bottom gap 0.57pt tighter than the top one while both were computed to be the same.
   At 94.6px the same question has no rounding worth the name. */
function copBase(sizePt,L,fontKey){
  const M=20;
  try{ return cssBaseline(sizePt*M,fontKey||COP_FONT,L*M)/M; }
  catch(e){
    try{ return cssBaseline(sizePt,fontKey||COP_FONT,L); }catch(e2){ return L-sizePt*0.905; }
  }
}

/* The box, and where every line inside it sits. One function so the preview, the placement and the
   re-layout of an existing stamp cannot disagree about any of it.
   `kOverride` re-derives the whole thing at a different scale, which is how a stamp the user has
   resized by hand keeps the size they gave it when its text changes. */
function copSpec(f,pi,kOverride){
  const k=(kOverride>0)?kOverride:copScale(pi);
  const rowPt=COP_ROW_PT*k, titlePt=rowPt*COP_TITLE_R;
  const title=String(f.status||"REDLINED");
  const rows=[String(f.gc||""),String(f.poc||""),String(f.date||"")];

  const border=Math.max(1,1*k);
  const M=COP_MARGIN_R*rowPt;                 /* ink to rule, the same on all four sides */
  const G1=COP_GAP1_R*rowPt, G2=COP_GAP2_R*rowPt;

  /* The rhythm is set by a CAP, not by each line's own ink: "JOSHUA BEAVER" and "10/6/2026" must sit
     on the same pitch as "TSC CONSTRUCTION LLC" whatever letters they happen to contain, or a row of
     digits would ride higher than the row above it. */
  const capT=copGlyphInk("H",titlePt,COP_FONT_TITLE).asc;
  const capR=copGlyphInk("H",rowPt,COP_FONT_ROW).asc;
  /* the one thing read off the real text: how far the bottom row drops below its baseline */
  const descLast=copGlyphInk(rows[rows.length-1],rowPt,COP_FONT_ROW).desc;

  /* BASELINES, measured down from the top of the box. Caps have no descender, so a line's ink runs
     from `baseline - cap` to `baseline`, which is what makes the margins come out even. */
  const base=[border+M+capT];
  for(let i=0;i<rows.length;i++)
    base.push(base[base.length-1]+(i===0?G1:G2)+capR);

  const h=base[base.length-1]+descLast+M+border;

  /* LENGTH is the one dimension that moves: the box is cut to its longest line, with the same margin
     either side. The advance width is used rather than the ink width, so a glyph with a wide right
     bearing cannot be the one thing that touches the rule. */
  let longest=copTextPt(title,titlePt,pi,COP_FONT_TITLE);
  rows.forEach(r=>{ longest=Math.max(longest,copTextPt(r,rowPt,pi,COP_FONT_ROW)); });
  let w=longest+(border+M)*2;
  if(w<h*1.15)w=h*1.15;                       /* a floor that only stops the box turning portrait */

  /* Each line is drawn as a one-line text mark, so the spec hands over the TOP of its line box —
     derived from the baseline it has to hit, which is the measured-not-assumed route the export
     uses for every other piece of text in this tool. */
  const titleL=titlePt*COP_LINE, rowL=rowPt*COP_LINE;
  const lineTop=(baseline,sizePt,L,face)=>baseline-(L-copBase(sizePt,L,face));
  const top=[lineTop(base[0],titlePt,titleL,COP_FONT_TITLE)];
  for(let i=0;i<rows.length;i++)
    top.push(lineTop(base[i+1],rowPt,rowL,COP_FONT_ROW));

  return {
    k, w, h, border,
    pad:border+M, margin:M, gap1:G1, gap2:G2,
    capT, capR, descLast, base,
    titlePt, rowPt, titleL, rowL,
    inner:Math.max(1,w-(border+M)*2),         /* the width every row box gets */
    title, rows, top
  };
}

/* ---------------------------------------------------------------------------------------------
   THE STAMP AS MARKS. Built as a `kind:"group"` markup record — the same shape the markup library
   stores a saved selection in — so `maPlaceMarkup` puts it on the page, which already handles the
   fresh ids, the group remapping, the z-order and the history entry.
   Coordinates are normalised to the TARGET page and relative to the stamp's own top-left corner.
   --------------------------------------------------------------------------------------------- */
function copRec(f,pi,kOverride){
  const sp=copSpec(f,pi,kOverride);
  const d=copPageDims(pi);
  const nx=v=>v/d.w, ny=v=>v/d.h;
  const annos=[];

  /* the box. Its rule is drawn INSIDE its own footprint, which is what shapeNeedsSvg arranges, so
     the stamp occupies exactly w x h on the sheet. */
  annos.push({
    nx:0, ny:0, nw:nx(sp.w), nh:ny(sp.h),
    text:"", shape:"rect", maKind:"rect", copRole:"box",
    col:COP_RED, sw:sp.border, fill:"#ffffff", fillOp:1, colOp:1,
    size:sp.rowPt, align:"center", font:COP_FONT_ROW,
    manualW:true, wrap:false, nowrap:false, onCell:false, fullcell:false,
    under:false, lineNh:null, lines:1, group:1, z:1
  });

  const line=(text,sizePt,top,lineH,role,z,fontKey)=>{
    annos.push({
      /* 6kj — the BOX is placed an inset further out so the INK lands on the margin */
      nx:nx(sp.pad-COP_EDX), ny:ny(top-COP_EDY),
      nw:nx(sp.inner+COP_EDX*2), nh:ny(lineH+COP_EDY*2),
      text:String(text||""), maKind:"text", copRole:role,
      col:COP_RED, colOp:1, bgNone:true, sw:0, size:sizePt, font:fontKey||COP_FONT_ROW,
      align:"left", alignSet:true,
      /* 6k4 — a stamp's line is ONE line. Without this the stylesheet's `break-all` folds the end of
         the longest row onto a second line the box is too short to show. */
      manualW:true, wrap:false, nowrap:true, onCell:false, fullcell:false,
      under:false, lineNh:null, lines:1, pLines:1, group:1, z:z
    });
  };
  line(sp.title,sp.titlePt,sp.top[0],sp.titleL,"title",2,COP_FONT_TITLE);
  line(sp.rows[0],sp.rowPt,sp.top[1],sp.rowL,"gc",3,COP_FONT_ROW);
  line(sp.rows[1],sp.rowPt,sp.top[2],sp.rowL,"poc",4,COP_FONT_ROW);
  line(sp.rows[2],sp.rowPt,sp.top[3],sp.rowL,"date",5,COP_FONT_ROW);

  return {kind:"group", name:"COP stamp", pw:d.w, ph:d.h, annos, lines:[], _spec:sp};
}

/* ---------------------------------------------------------------------------------------------
   WHERE IT GOES. The two searches from the standalone tool, running against a page this tool has
   already opened. They work in DISPLAY space — origin bottom-left, after the page's own rotation —
   because that is the space the old tool reasoned in and the space MIU's normalised coordinates
   already describe, so nothing has to be converted twice.
   --------------------------------------------------------------------------------------------- */
async function copRaster(pi,maxPx,cap){
  const P=S.pages[pi]; if(!P||!P.page)return null;
  const d=copPageDims(pi);
  const scale=Math.min(cap||1.6,(maxPx||1000)/Math.max(d.w,d.h));
  const vp=P.page.getViewport({scale});
  const cw=Math.max(1,Math.ceil(vp.width)), ch=Math.max(1,Math.ceil(vp.height));
  const cv=document.createElement("canvas");
  cv.width=cw; cv.height=ch;
  const cx=cv.getContext("2d",{willReadFrequently:true});
  cx.fillStyle="#fff"; cx.fillRect(0,0,cw,ch);
  try{ await P.page.render({canvasContext:cx,viewport:vp}).promise; }
  catch(e){ cv.width=cv.height=0; return null; }
  const px=cx.getImageData(0,0,cw,ch).data;
  cv.width=cv.height=0;
  return {px, cw, ch, scale, dispW:d.w, dispH:d.h};
}

/* an edge map: where the image CHANGES is content — text, logos, rules, icons. A flat fill, which is
   what a header band is, is not. Grown by one cell so a stamp keeps clear of letterforms rather than
   butting against them. */
function copEdgeMap(r,cell,T){
  const {px,cw,ch}=r;
  const cols=Math.ceil(cw/cell), rows=Math.ceil(ch/cell);
  const occ=new Uint8Array(cols*rows);
  for(let y=0;y<ch;y++){
    const rr=(y/cell)|0, base=y*cw*4;
    for(let x=0;x<cw;x++){
      const i=base+x*4;
      let dd=0;
      if(x+1<cw){ const k=i+4;
        dd=Math.max(dd,Math.abs(px[i]-px[k]),Math.abs(px[i+1]-px[k+1]),Math.abs(px[i+2]-px[k+2])); }
      if(y+1<ch){ const k=i+cw*4;
        dd=Math.max(dd,Math.abs(px[i]-px[k]),Math.abs(px[i+1]-px[k+1]),Math.abs(px[i+2]-px[k+2])); }
      if(dd>T)occ[rr*cols+((x/cell)|0)]=1;
    }
  }
  const grown=new Uint8Array(occ);
  for(let rr=0;rr<rows;rr++)for(let c=0;c<cols;c++){
    if(!occ[rr*cols+c])continue;
    for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
      const nr=rr+dr,nc=c+dc;
      if(nr>=0&&nr<rows&&nc>=0&&nc<cols)grown[nr*cols+nc]=1;
    }
  }
  return {occ:grown, cols, rows};
}
/* an ink map: anything that is not paper. Used where a flat fill DOES count as content. */
function copInkMap(r,cell){
  const {px,cw,ch}=r;
  const cols=Math.ceil(cw/cell), rows=Math.ceil(ch/cell);
  const occ=new Uint8Array(cols*rows);
  for(let y=0;y<ch;y++){
    const rr=(y/cell)|0, base=y*cw*4;
    for(let x=0;x<cw;x++){
      const i=base+x*4;
      if(px[i]<246||px[i+1]<246||px[i+2]<246)occ[rr*cols+((x/cell)|0)]=1;
    }
  }
  return {occ, cols, rows};
}
/* constant-time "how much of this rectangle is covered" */
function copSat(occ,cols,rows){
  const stride=cols+1;
  const sat=new Int32Array(stride*(rows+1));
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)
    sat[(r+1)*stride+(c+1)]=occ[r*cols+c]+sat[r*stride+(c+1)]+sat[(r+1)*stride+c]-sat[r*stride+c];
  return (c0,r0,c1,r1)=>sat[r1*stride+c1]-sat[r0*stride+c1]-sat[r1*stride+c0]+sat[r0*stride+c0];
}

/* RFDS: vertically CENTRED on the grey header band, right-aligned but pushed left of anything in the
   band's right end, such as "Page 1 of 1". It may cross the band's own boundary rules — those are
   background structure, not content. */
async function copBandSpot(pi,sw,sh){
  const r=await copRaster(pi,1000,1.6); if(!r)return null;
  const {cw,ch,px,scale,dispH}=r;

  /* 1 · flat non-white bands across the top, judged by each row's DOMINANT tone rather than its
     average: a band row carrying a caption would otherwise have its average dragged off the band
     colour and split one band into two short ones. */
  const limit=Math.floor(ch*0.45);
  const bandRow=new Uint8Array(limit);
  for(let y=0;y<limit;y++){
    const base=y*cw*4, hist=new Int32Array(16);
    for(let x=0;x<cw;x++){
      const i=base+x*4;
      hist[Math.min(15,((px[i]+px[i+1]+px[i+2])/3)>>4)]++;
    }
    let bi=0;
    for(let k=1;k<16;k++)if(hist[k]>hist[bi])bi=k;
    const near=hist[bi]+(bi>0?hist[bi-1]:0)+(bi<15?hist[bi+1]:0);
    const mid=bi*16+8;
    if(near/cw>0.55&&mid>=100&&mid<246)bandRow[y]=1;
  }
  const bands=[];
  let run=-1;
  for(let y=0;y<=limit;y++){
    if(y<limit&&bandRow[y]){ if(run<0)run=y; }
    else if(run>=0){ if(y-run>=8)bands.push({top:run,bot:y}); run=-1; }
  }
  if(!bands.length)return null;
  /* a real RFDS header sits hard against the top of the sheet. Requiring that stops a shaded table
     partway down a drawing being read as a header. */
  if(bands[0].top>ch*0.10)return null;

  const cell=4;
  const m0=copEdgeMap(r,cell,26);
  const {occ,cols,rows}=m0;
  /* a mark running most of the page width is a rule or a band edge, not content */
  for(let rr=0;rr<rows;rr++){
    let n=0;
    for(let c=0;c<cols;c++)n+=occ[rr*cols+c];
    if(n>=cols*0.6)for(let c=0;c<cols;c++)occ[rr*cols+c]=0;
  }
  const filled=copSat(occ,cols,rows);

  const shPx=sh*scale, swPx=sw*scale;
  const m=Math.max(1,Math.round((8*scale)/cell));
  const needC=Math.ceil(swPx/cell);
  const gap=Math.max(1,Math.round((7*scale)/cell));
  const rowsFor=b=>{
    let topPx=(b.top+b.bot)/2-shPx/2;
    topPx=Math.max(2,Math.min(topPx,ch-shPx-2));
    const r0=Math.max(0,Math.round(topPx/cell));
    return {r0, r1:Math.min(rows,r0+Math.ceil(shPx/cell))};
  };
  const spot=(c,r0)=>({dxl:(c*cell)/scale, dyb:dispH-((r0*cell)/scale)-sh});

  /* topmost band first, so the grey header wins over a table header lower down */
  for(const b of bands){
    const rg=rowsFor(b);
    for(let c=cols-needC-m;c>=m;c--){
      const a=Math.max(0,c-gap), z=Math.min(cols,c+needC+gap);
      if(filled(a,rg.r0,z,rg.r1)===0)return spot(c,rg.r0);
    }
  }
  /* nothing clear: the least-covered position on the topmost band */
  const rg=rowsFor(bands[0]);
  let bestC=m, bestFill=Infinity;
  for(let c=cols-needC-m;c>=m;c--){
    const f=filled(c,rg.r0,c+needC,rg.r1);
    if(f<bestFill){ bestFill=f; bestC=c; }
  }
  return spot(bestC,rg.r0);
}

/* Drawings and mount analyses: hug the upper right and travel DOWN past callouts and tables.
   A candidate must not merely avoid ink — it must have a clear band of white all round, so the stamp
   never ends up almost touching a paragraph or wedged between two callouts. The band starts generous
   and relaxes a step at a time if the sheet is too dense. */
async function copOpenSpot(pi,sw,sh,forceUpper){
  const r=await copRaster(pi,950,1.4); if(!r)return null;
  const {scale,dispH}=r;
  const cell=4;
  const map=forceUpper?copEdgeMap(r,cell,26):copInkMap(r,cell);
  const {occ,cols,rows}=map;
  const ink=new Uint8Array(occ);                      /* real ink, before the page-edge guard */

  const m=Math.max(1,Math.round((12*scale)/cell));
  for(let rr=0;rr<rows;rr++)for(let c=0;c<cols;c++)
    if(rr<m||c<m||rr>=rows-m||c>=cols-m)occ[rr*cols+c]=1;

  const needC=Math.ceil((sw*scale)/cell), needR=Math.ceil((sh*scale)/cell);
  if(needC>cols||needR>rows)return null;
  const filled=copSat(occ,cols,rows);
  const inked=copSat(ink,cols,rows);
  const spotAt=(c,rr)=>({dxl:(c*cell)/scale, dyb:dispH-((rr*cell)/scale)-sh});
  const cRight=cols-needC-m;

  /* FIRST CHOICE: the page's own upper right corner, if it is clear. */
  if(cRight>=m&&filled(cRight,m,cRight+needC,m+needR)===0)return spotAt(cRight,m);

  const qRowEnd=Math.min(rows-needR-m,Math.floor(rows*(forceUpper?0.45:0.5)));
  const qColEnd=forceUpper?m:Math.max(m,Math.floor(cols*0.40));

  if(forceUpper){
    for(let rr=m;rr<=qRowEnd;rr++)
      for(let c=cRight;c>=qColEnd;c--)
        if(filled(c,rr,c+needC,rr+needR)===0)return spotAt(c,rr);
    const deeper=Math.min(rows-needR-m,Math.floor(rows*0.7));
    for(let rr=qRowEnd+1;rr<=deeper;rr++)
      for(let c=cRight;c>=m;c--)
        if(filled(c,rr,c+needC,rr+needR)===0)return spotAt(c,rr);
    let bC=Math.max(m,cRight), bR=m, bF=Infinity;
    for(let rr=m;rr<=qRowEnd;rr++)
      for(let c=cRight;c>=m;c--){
        const f=filled(c,rr,c+needC,rr+needR);
        if(f<bF){ bF=f; bC=c; bR=rr; }
      }
    return spotAt(bC,bR);
  }

  const rEnd=Math.min(rows-needR-m,Math.floor(rows*0.85));
  const spanC=Math.max(1,cRight-qColEnd), spanR=Math.max(1,rEnd-m);
  const PAD_STEPS=[12,8,5,2,0];
  for(let si=0;si<PAD_STEPS.length;si++){
    const pad=Math.ceil(PAD_STEPS[si]/cell);
    let bC=-1,bR=-1,bD=Infinity;
    for(let c=cRight;c>=qColEnd;c--){
      for(let rr=m;rr<=rEnd;rr++){
        if(filled(c,rr,c+needC,rr+needR)!==0)continue;
        if(pad>0){
          const a=Math.max(0,c-pad), z=Math.min(cols,c+needC+pad);
          const t=Math.max(0,rr-pad), u=Math.min(rows,rr+needR+pad);
          if(inked(a,t,z,u)!==0)continue;
        }
        const dx=(cRight-c)/spanC, dy=(rr-m)/spanR;
        /* rightness dominates: the stamp stays in the corner and travels down to find room */
        const dist=8*dx*dx+dy*dy;
        if(dist<bD){ bD=dist; bC=c; bR=rr; }
      }
    }
    if(bC>=0)return spotAt(bC,bR);
  }
  return null;
}

function copCornerSpot(mode,w,h,pi){
  const d=copPageDims(pi), m=18;
  const left=m, right=Math.max(m,d.w-m-w);
  const bottom=m, top=Math.max(m,d.h-m-h);
  switch(mode){
    case "tl": return {dxl:left, dyb:top};
    case "bl": return {dxl:left, dyb:bottom};
    case "br": return {dxl:right, dyb:bottom};
    default:   return {dxl:right, dyb:top};
  }
}

/* The document kind, read off the file name exactly as the standalone tool read it. "MA" and "CD"
   are short enough to appear inside other words, so they are honoured only as whole tokens. */
function copDocType(){
  const n=String((S.doc&&S.doc.name)||S.fileName||S.siteCode||"").toUpperCase();
  if(/RFDS/.test(n))return "RFDS";
  if(/MOUNT\s*ANALYS/.test(n))return "MA";
  if(/CONSTRUCTION\s*DRAWING/.test(n))return "CDs";
  if(/(^|[^A-Z0-9])MA([^A-Z0-9]|$)/.test(n))return "MA";
  if(/(^|[^A-Z0-9])CDS?([^A-Z0-9]|$)/.test(n))return "CDs";
  return "Auto";
}

/* where this stamp should sit on this page, in normalised coordinates */
async function copFindSpot(pi,sp,place){
  const d=copPageDims(pi);
  let spot=null;
  if(place==="auto"){
    const type=copDocType();
    const forced=(type==="RFDS");
    try{
      /* AUTO tries the header band first and falls through when the page has none — a missing band
         is itself the signal that this is not an RFDS layout. RFDS forces it; CDs and MA skip it. */
      if(forced||type==="Auto")spot=await copBandSpot(pi,sp.w,sp.h);
      if(!spot)spot=await copOpenSpot(pi,sp.w,sp.h,forced);
    }catch(e){ spot=null; }
  }
  if(!spot)spot=copCornerSpot(place==="auto"?"tr":place,sp.w,sp.h,pi);
  return {
    nx:Math.max(0,spot.dxl/d.w),
    ny:Math.max(0,(d.h-spot.dyb-sp.h)/d.h),
    auto:(place==="auto")
  };
}

/* ---------------------------------------------------------------------------------------------
   PLACING, AND CHANGING ONE THAT IS ALREADY THERE
   --------------------------------------------------------------------------------------------- */
function copFieldsValid(f){ return !!(String(f.gc||"").trim()&&String(f.poc||"").trim()); }

/* 6kl — STAMPING A PAGE AGAIN REPLACES THE STAMP ON IT.
   Ced: "clicking stamp again should not overlay the stamp but rather remove the current stamps and
   replace them with new."
   A stamp is not a redline you add another of; it is a statement about the document, and a document
   says one thing at a time. Pressing Stamp twice used to leave two of them in the same corner,
   slightly offset, which looks exactly like the bug it is. The old one goes first — and because it
   goes before the new one is placed, the blank-space search sees the page WITHOUT it and can put the
   replacement back in the same clear corner instead of treating its predecessor as an obstacle. */
function copRemoveFrom(pi){
  const gs=copStampsOn(pi);
  if(!gs.length)return 0;
  const doomed=new Set();
  gs.forEach(g=>{ (S.annos||[]).forEach(a=>{ if(a.group===g)doomed.add(a.id); }); });
  if(!doomed.size)return 0;
  S.annos=(S.annos||[]).filter(a=>!doomed.has(a.id));
  if(doomed.has(S.sel))selectAnno(null);
  doomed.forEach(id=>{ try{ S.selMulti.delete(id); }catch(e){} });
  return gs.length;
}
async function copPlaceOn(pi,f){
  copRemoveFrom(pi);                      /* 6kl — one stamp per page, always the newest */
  const rec=copRec(f,pi);
  const at=await copFindSpot(pi,rec._spec,f.place||"auto");
  return maPlaceMarkup(rec,pi,at.nx,at.ny,"tl");
}

/* every stamp on a page, as a list of group ids. A stamp IS its group: the five marks share one, and
   `copRole` is what says the group is a stamp rather than any other grouped set of marks. */
function copStampsOn(pi){
  const out=[];
  (S.annos||[]).forEach(a=>{
    if(a.copRole&&a.group!=null&&(pi==null||a.page===pi)&&out.indexOf(a.group)<0)out.push(a.group);
  });
  return out;
}
function copPartsOf(gid){
  const parts={};
  (S.annos||[]).forEach(a=>{ if(a.group===gid&&a.copRole)parts[a.copRole]=a; });
  return parts;
}
/* what a stamp already on the page says */
function copReadStamp(gid){
  const p=copPartsOf(gid);
  if(!p.box)return null;
  return {
    status:(p.title&&p.title.text)||"REDLINED",
    gc:(p.gc&&p.gc.text)||"",
    poc:(p.poc&&p.poc.text)||"",
    date:(p.date&&p.date.text)||""
  };
}

/* Rewrite a stamp in place. The box's TOP-LEFT and the scale the user left it at are both kept: if
   they resized the stamp by hand, a new date must not spring it back to the size the page would have
   given it. Everything else — the box's new length, where each line sits inside it — is re-derived
   from `copSpec`, so an edited stamp is laid out by exactly the rule a new one is. */
function copApplyTo(gid,f){
  const p=copPartsOf(gid);
  if(!p.box)return false;
  const pi=p.box.page;
  const d=copPageDims(pi);
  /* the scale this stamp is actually drawn at, read back off its own height */
  const natural=copSpec(f,pi,null);
  const curH=(p.box.nh||0)*d.h;
  let k=copScale(pi);
  if(curH>1&&natural.h>0)k=k*(curH/natural.h);
  k=Math.max(0.2,Math.min(COP_K_MAX*2,k));

  const sp=copSpec(f,pi,k);
  const nx=v=>v/d.w, ny=v=>v/d.h;
  const x0=p.box.nx, y0=p.box.ny;

  p.box.nw=nx(sp.w); p.box.nh=ny(sp.h);
  p.box.sw=sp.border; p.box.col=COP_RED; p.box.fill="#ffffff";

  const put=(role,text,sizePt,top,lineH,fontKey)=>{
    const a=p[role]; if(!a)return;
    a.text=String(text||"");
    a.size=sizePt;
    a.col=COP_RED;
    a.font=fontKey||COP_FONT_ROW;
    a.nx=x0+nx(sp.pad-COP_EDX);
    a.ny=y0+ny(top-COP_EDY);
    a.nw=nx(sp.inner+COP_EDX*2);
    a.nh=ny(lineH+COP_EDY*2);
    a.manualW=true; a.nowrap=true; a.wrap=false;
  };
  put("title",sp.title,sp.titlePt,sp.top[0],sp.titleL,COP_FONT_TITLE);
  put("gc",sp.rows[0],sp.rowPt,sp.top[1],sp.rowL,COP_FONT_ROW);
  put("poc",sp.rows[1],sp.rowPt,sp.top[2],sp.rowL,COP_FONT_ROW);
  put("date",sp.rows[2],sp.rowPt,sp.top[3],sp.rowL,COP_FONT_ROW);
  return true;
}

/* Which stamps a bulk edit acts on: the ones selected, or every stamp in the document if none are. */
function copTargetGroups(){
  const sel=[];
  const add=id=>{ const a=(S.annos||[]).find(z=>z.id===id);
    if(a&&a.copRole&&a.group!=null&&sel.indexOf(a.group)<0)sel.push(a.group); };
  if(S.sel!=null)add(S.sel);
  (S.selMulti||new Set()).forEach(add);
  if(sel.length)return sel;
  return copStampsOn(null);
}

/* =================================================================================================
   THE CARD. It lives in Assist beside Notes, Parts, Markups and As-built, because it is the same
   kind of thing: something you set up once per document and then apply to pages.

   REALTIME, which is the word Ced used, means two things here and the card does both:
     · the preview is the stamp, drawn from the same `copSpec` the page will use, redrawing as you
       type rather than when you press something;
     · with a stamp selected on the sheet, changing a field changes THAT STAMP as you change it. No
       apply step, no re-stamping, no second copy to delete.
   ================================================================================================= */
let COP_F=null;                 /* the card's live fields, shared with the preview and the page */

function copFields(){ if(!COP_F)COP_F=copPrefs(); return COP_F; }

/* the preview, drawn at a fixed magnification so a 1.6pt pad is visible */
function copPaintPreview(host){
  if(!host)return;
  const f=copFields();
  const pi=(typeof currentPageIdx==="function"?currentPageIdx():0)||0;
  const sp=copSpec(f,pi,1);                      /* k=1: the letter-page baseline, always */
  /* 6ka — THE PREVIEW FITS THE CARD. It was drawn at a flat 2.4x, so a long contractor name pushed
     a 150pt-wide stamp to 360px inside a 330px panel and the drawing ran out over the controls —
     Ced's screenshot, with REDLINED and the rule crossing the whole dropdown. The magnification is
     whatever shows the whole stamp in the room available, capped at 2.4 so a short one is not blown
     up past the point of being a preview. */
  const room=Math.max(120,(host.clientWidth||290)-24);
  const Z=Math.min(2.4, room/Math.max(1,sp.w));
  host.innerHTML="";
  const wrap=document.createElement("div");
  wrap.className="cop-pvwrap";
  wrap.style.height=(sp.h*Z).toFixed(1)+"px";
  host.appendChild(wrap);
  const box=document.createElement("div");
  box.className="cop-pv";
  box.style.width=(sp.w*Z).toFixed(1)+"px";
  box.style.height=(sp.h*Z).toFixed(1)+"px";
  box.style.borderWidth=Math.max(0.5,sp.border*Z).toFixed(2)+"px";
  const put=(text,sizePt,top,lineH,bold)=>{
    const t=document.createElement("div");
    t.className="cop-pv-l"+(bold?" b":"");
    t.textContent=text||"—";
    t.style.fontSize=(sizePt*Z).toFixed(2)+"px";
    t.style.left=(sp.pad*Z).toFixed(1)+"px";
    t.style.width=(sp.inner*Z).toFixed(1)+"px";
    t.style.top=(top*Z).toFixed(1)+"px";
    t.style.height=(lineH*Z).toFixed(2)+"px";
    t.style.lineHeight=(lineH*Z).toFixed(2)+"px";
    box.appendChild(t);
  };
  /* the preview wears whatever face the page will use, so the two cannot disagree about weight */
  const bT=(COP_FONT_TITLE==="arialbold"), bR=(COP_FONT_ROW==="arialbold");
  put(sp.title,sp.titlePt,sp.top[0],sp.titleL,bT);
  put(sp.rows[0],sp.rowPt,sp.top[1],sp.rowL,bR);
  put(sp.rows[1],sp.rowPt,sp.top[2],sp.rowL,bR);
  put(sp.rows[2],sp.rowPt,sp.top[3],sp.rowL,bR);
  wrap.appendChild(box);
  const cap=document.createElement("div");
  cap.className="cop-pv-cap";
  cap.textContent=`${sp.w.toFixed(1)} × ${sp.h.toFixed(1)} pt on letter · ×${copScale(pi).toFixed(2)} on this sheet`;
  host.appendChild(cap);
}

/* a <select> with an "Other…" twin that appears only when it is chosen */
function copPick(label,id,items,value,onChange){
  const wrap=document.createElement("div");
  const l=document.createElement("label");
  l.className="ma-f";
  const known=items.indexOf(value)>=0;
  l.innerHTML=`<span>${maEsc(label)}</span><select id="${id}"></select>`;
  wrap.appendChild(l);
  const sel=l.querySelector("select");
  items.forEach(v=>sel.add(new Option(v,v)));
  sel.add(new Option("Other…","__other__"));
  sel.value=(value&&known)?value:(value?"__other__":items[0]);

  const other=document.createElement("input");
  other.type="text"; other.className="ma-in cop-other";
  other.placeholder="Type it";
  other.spellcheck=false;
  other.value=known?"":(value||"");
  other.style.display=(sel.value==="__other__")?"block":"none";
  wrap.appendChild(other);

  const read=()=>((sel.value==="__other__")?other.value:sel.value).trim().toUpperCase();
  sel.onchange=()=>{ other.style.display=(sel.value==="__other__")?"block":"none";
                     if(sel.value==="__other__")other.focus(); onChange(read()); };
  other.oninput=()=>onChange(read());
  /* The caller seeds the field from `read()` once the card is fully built — not here. Firing the
     change handler during construction reaches `touched()`, which closes over consts that do not
     exist yet, and the card dies with "Cannot access 'dtIn' before initialization". */
  return {wrap, read};
}

function maRenderStampTab(body){
  const f=copFields();
  const sec=maSection("");
  body.appendChild(sec);

  const note=document.createElement("p");
  note.className="ma-note";
  note.textContent="The stamp lands as a group of ordinary redlines — drag it, resize it, "+
    "double-click a line to retype it. Nothing is flattened.";
  sec.appendChild(note);

  /* ---- status ---- */
  const st=document.createElement("label");
  st.className="ma-f";
  st.innerHTML=`<span>Status</span><select id="copStatus">
    <option value="REDLINED">REDLINED</option><option value="AS-BUILT">AS-BUILT</option></select>`;
  { const w=document.createElement('div'); w.appendChild(st); sec.appendChild(w); }
  const stSel=st.querySelector("select");
  stSel.value=f.status;

  /* ---- GC and POC ---- */
  const gc=copPick("General contractor","copGc",COP_GCS,f.gc,v=>{ f.gc=v; touched(); });
  sec.appendChild(gc.wrap);
  const poc=copPick("Point of contact","copPoc",COP_POCS,f.poc,v=>{ f.poc=v; touched(); });
  sec.appendChild(poc.wrap);

  /* ---- date ---- */
  const dt=document.createElement("label");
  dt.className="ma-f";
  dt.innerHTML=`<span>Date</span><input type="text" id="copDate" spellcheck="false">`;
  { const w=document.createElement('div'); w.appendChild(dt); sec.appendChild(w); }
  const dtIn=dt.querySelector("input");
  dtIn.value=f.date;

  /* ---- placement ---- */
  const pl=document.createElement("label");
  pl.className="ma-f";
  pl.innerHTML=`<span>Placement</span><select id="copPlace">
    <option value="auto">Auto — find clear space</option>
    <option value="tr">Top right</option><option value="tl">Top left</option>
    <option value="br">Bottom right</option><option value="bl">Bottom left</option></select>`;
  { const w=document.createElement('div'); w.appendChild(pl); sec.appendChild(w); }
  const plSel=pl.querySelector("select");
  plSel.value=f.place;

  /* ---- preview ---- */
  const pv=document.createElement("div");
  pv.className="cop-stage";
  sec.appendChild(pv);

  /* =================================================================================================
     6l5 — REALTIME MEANS EVERY STAMP, NOT JUST A SELECTED ONE. Ced: "make the changes on stamp tool
     in realtime if possible."

     v38 made a SELECTED stamp follow the fields as you type. In use the stamp is almost never
     selected — it is placed on every page and then left alone — so the realtime path reached nothing
     and the card's fields looked inert until "Update stamp" was pressed. The scope is now the same
     one every other bulk action on this card uses (`copTargetGroups`: whatever is selected, or every
     stamp in the document if nothing is), so changing the contractor changes the contractor,
     everywhere, as you change it. "Update stamp" stays, because it is still the way to re-apply
     without touching a field.

     Two things keep that from being expensive or destructive. A typed date would otherwise rewrite
     five marks per page per keystroke — on a 23-page set, 115 marks and a full layout each — so the
     write is coalesced on a frame-and-a-bit while the PREVIEW stays instant, which is the part the
     eye is on. And a burst of typing is ONE history entry, taken before the first write of the
     burst: an undo per keystroke is not an undo anybody wants, and no undo at all is worse.
     ================================================================================================= */
  let _liveT=0, _liveBurst=0;
  function copWriteLive(){
    const gs=copTargetGroups();
    if(!gs.length)return;
    const now=Date.now();
    if(now-_liveBurst>1200){ try{ pushHistory(); }catch(e){} }
    _liveBurst=now;
    gs.forEach(g=>copApplyTo(g,f));
    layoutAnnos(); updateCount(); updateRail();
    try{ autosave(); }catch(e){}
  }
  function touched(opts){
    f.status=stSel.value; f.date=dtIn.value.trim(); f.place=plSel.value;
    copSavePrefs(f);
    copPaintPreview(pv);                      /* the preview is never debounced */
    /* 6l5 — the card being BUILT is not a change: seeding the fields from the saved preferences
       must not quietly rewrite every stamp on the document the moment Assist is opened. */
    if(opts&&opts.quiet)return;
    clearTimeout(_liveT);
    _liveT=setTimeout(copWriteLive,20);
  }
  [stSel,plSel].forEach(n=>n.onchange=()=>touched());
  dtIn.oninput=()=>touched();

  /* 6ka — Ced: "in stamp tool, the preloaded details should show up as well."
     A <select> always shows its first entry, so the card opened displaying a contractor and a POC
     while the fields behind them were empty: the preview said "—" and Stamp refused to run on
     details the user could plainly see. What is on screen IS the field, from the moment the card is
     built — and because this runs through the same handler a change does, the preview and any
     selected stamp agree with it immediately. */
  f.gc=gc.read(); f.poc=poc.read();
  touched({quiet:true});                      /* 6l5 — seed the preview, write nothing */

  /* ---- actions ---- */
  const needFields=()=>{
    if(copFieldsValid(f))return true;
    setStatus("Pick a general contractor and a point of contact first.",true);
    return false;
  };
  /* 6l2 — AND IT OPENS ON EVERY PAGE. Ced: "in stamp, always start with every page."
     A COP stamp is a document-level thing — the package is stamped, not one sheet of it — so "the
     page I am on" was the wrong default to have to notice and change on every set. Opening on
     "Every page" makes the common case no choice at all, and the two narrower scopes are still one
     press away in the same control. */
  const scope=maScopeControl("all");
  sec.appendChild(scope);

  const stampGo=maBtn("Stamp",`go`,async()=>{
    if(!needFields())return;
    if(!S.pages.length){ setStatus("Open a report first.",true); return; }
    const pages=maScopePages(($("#maScope")||{}).value||"page",($("#maRange")||{}).value||"");
    if(!pages.length){ setStatus("No pages in that range.",true); return; }
    stampGo.disabled=true;
    const was=setStatus;
    let n=0;
    try{
      for(const pi of pages){
        setStatus(`Stamping page ${pi+1} of ${S.pages.length}…`);
        /* eslint-disable no-await-in-loop */
        const id=await copPlaceOn(pi,f);
        if(id!=null)n++;
      }
    } finally { stampGo.disabled=false; }
    layoutAnnos(); drawAllLines(); updateRail(); updateCount();
    try{ autosave(); }catch(e){}
    setStatus(n===1?`Stamped page ${pages[0]+1}.`:`Stamped ${n} pages.`);
  });
  sec.appendChild(stampGo);

  /* 6km — UPDATE THE STAMP, NOT JUST ITS DATE.
     Ced: "have the ability to update stamps if the selections on the stamp tool were changed, no
     just date. so instead of just date. change it to update stamp."
     Re-dating was the only thing this did, which made the card a form you could fill in and then
     only partly apply — change the contractor and the stamps on the sheet kept the old one unless
     you deleted and re-stamped every page. It writes ALL FOUR fields now, which is what the card is
     showing and what the user has just decided. */
  const reDate=maBtn("Update stamp",null,()=>{
    const gs=copTargetGroups();
    if(!gs.length){ setStatus("There are no stamps on this document yet.",true); return; }
    if(!needFields())return;
    pushHistory();
    const now={status:stSel.value, gc:f.gc, poc:f.poc, date:dtIn.value.trim()||copToday()};
    gs.forEach(g=>copApplyTo(g,now));
    layoutAnnos(); updateCount(); updateRail();
    try{ autosave(); }catch(e){}
    setStatus(`${gs.length} stamp${gs.length===1?"":"s"} updated — ${now.status}, ${now.gc}, `+
              `${now.poc}, ${now.date}.`);
  });
  sec.appendChild(reDate);

  const flip=maBtn("Switch REDLINED ↔ AS-BUILT",null,()=>{
    const gs=copTargetGroups();
    if(!gs.length){ setStatus("There are no stamps on this document yet.",true); return; }
    pushHistory();
    let to=null;
    gs.forEach(g=>{
      const cur=copReadStamp(g); if(!cur)return;
      const next=/^AS/i.test(String(cur.status).replace(/\s+/g,""))?"REDLINED":"AS-BUILT";
      if(!to)to=next;
      copApplyTo(g,{status:next,gc:cur.gc,poc:cur.poc,date:cur.date});
    });
    layoutAnnos(); updateCount();
    try{ autosave(); }catch(e){}
    setStatus(`Switched ${gs.length} stamp${gs.length===1?"":"s"}${to?" to "+to:""}.`);
  });
  sec.appendChild(flip);

  const hint=document.createElement("p");
  hint.className="ma-note";
  hint.textContent="Stamping a page replaces the stamp already on it. Update and Switch act on the "+
    "stamps you have selected, or on every stamp in the document when nothing is selected.";
  sec.appendChild(hint);

  copPaintPreview(pv);
}
