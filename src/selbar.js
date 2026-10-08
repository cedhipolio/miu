/* =================================================================================================
   SELECTION ACTION BAR
   =================================================================================================
   Ced: "also add this tab on the lower part of ui when editing single or multiple items/shapes."

   A bar across the bottom of the window, shown whenever anything is selected and hidden the moment
   nothing is — the row of actions from the screenshot, and every one of them does the thing it says:

     count           how many marks the bar is acting on, groups counted whole
     Edit properties opens the properties panel for what is selected; changing a control there restyles
                     the selection, which is how that panel already behaves
     Duplicate       a copy, offset, selected
     Layer           to the front, to the back, or behind the printed page so the page reads over it
     Flatten         burn into the page on export: it stops being an annotation and becomes part of
                     the drawing, which is what a flatten is for
     Group/Ungroup   the same pair the ribbon has, on the selection in front of you
     Lock            a locked mark cannot be moved, resized, restyled or deleted until it is unlocked
     Markup library  keeps the selection as a reusable stamp, placeable on any page later
     Apply to pages  drops the same selection onto a range of pages
     Copy            to the clipboard, pasteable with Ctrl+V
     Edit subject    the label the mark carries — shown in the redlines drawer and written to the PDF
                     as /Subj, which is what another editor shows in its own list
     ⋯               align, order and select-all-of-this-kind
     🗑              delete

   Everything here works through the functions that already existed (`duplicateSelected`,
   `groupSelected`, `copySelectedAnnos`, `pushHistory`, `maSelectedMarks`); the bar adds no second way
   of doing anything, which is what keeps undo honest.
   ================================================================================================= */

/* =================================================================================================
   6ff — THE BAR HAS TO WORK WHEREVER THIS RUNS
   Ced: "the bottom tools when selecting a redline is not working, those are not for display only."

   Three of the actions asked a question with `prompt()`, and a published artifact runs in a sandboxed
   frame where `prompt()` is either blocked outright or returns null without ever showing — so Edit
   subject, Apply to pages and Add to markup library did nothing at all, silently. `sbAsk` is the
   replacement: a small modal of our own, inside the page, with Enter to accept and Escape to cancel.
   Nothing here calls a browser dialog any more.
   ================================================================================================= */
function sbEl(tag,cls,txt){ const n=document.createElement(tag); if(cls)n.className=cls;
  if(txt!=null)n.textContent=txt; return n; }

/* 6je — the same card as sbAsk with no field in it: a question that only needs an answer. */
function sbConfirm(opts){
  return new Promise(resolve=>{
    const wrap=sbEl("div","sb-ask");
    const card=sbEl("div","sb-askcard");
    card.appendChild(sbEl("div","sb-asktitle",opts.title||""));
    if(opts.hint)card.appendChild(sbEl("p","sb-askhint",opts.hint));
    const row=sbEl("div","sb-askrow");
    const cancel=sbEl("button","sb-askb",opts.cancel||"Cancel"); cancel.type="button";
    const ok=sbEl("button","sb-askb primary"+(opts.danger?" danger":""),opts.ok||"OK"); ok.type="button";
    row.appendChild(cancel); row.appendChild(ok);
    card.appendChild(row); wrap.appendChild(card); document.body.appendChild(wrap);
    const done=v=>{ wrap.remove(); document.removeEventListener("keydown",key,true); resolve(v); };
    const key=e=>{
      if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); done(false); }
      else if(e.key==="Enter"){ e.preventDefault(); e.stopPropagation(); done(true); }
    };
    document.addEventListener("keydown",key,true);
    cancel.onclick=()=>done(false);
    ok.onclick=()=>done(true);
    wrap.onpointerdown=e=>{ if(e.target===wrap)done(false); };
    setTimeout(()=>ok.focus(),20);
  });
}
function sbAsk(opts){
  return new Promise(resolve=>{
    const wrap=sbEl("div","sb-ask");
    const card=sbEl("div","sb-askcard");
    card.appendChild(sbEl("div","sb-asktitle",opts.title||""));
    if(opts.hint)card.appendChild(sbEl("p","sb-askhint",opts.hint));

    /* 6g8 — the dialog can carry a chooser as well as a field.
       Ced: "apply the same feature to apply to pages function", with a Page range dropdown of
       All pages (N) / Even / Odd / Custom range. Pass `choices` and the select appears above the
       field; pass `freeOn` and the field only shows itself for that choice. With a chooser the
       promise answers {choice,text}; without one it answers the text, exactly as before. */
    let sel=null;
    const choices=opts.choices||null;
    if(choices){
      const lab=sbEl("label","sb-asklabel",opts.choiceLabel||"Range");
      sel=document.createElement("select"); sel.className="sb-askselect";
      choices.forEach(c=>{ const o=document.createElement("option");
        o.value=c.value; o.textContent=c.label; sel.appendChild(o); });
      sel.value=opts.choice||choices[0].value;
      lab.appendChild(sel);
      card.appendChild(lab);
    }

    const inp=document.createElement("input");
    inp.type="text"; inp.className="sb-askinput";
    inp.value=opts.value||""; inp.placeholder=opts.placeholder||"";
    card.appendChild(inp);

    const syncField=()=>{
      if(!choices||!opts.freeOn)return;
      const on=(sel.value===opts.freeOn);
      inp.style.display=on?"":"none";
      if(on)setTimeout(()=>{ inp.focus(); inp.select(); },10);
    };
    if(sel){ sel.onchange=syncField; syncField(); }

    const row=sbEl("div","sb-askrow");
    const cancel=sbEl("button","sb-askb","Cancel"); cancel.type="button";
    const ok=sbEl("button","sb-askb primary",opts.ok||"OK"); ok.type="button";
    row.appendChild(cancel); row.appendChild(ok);
    card.appendChild(row);
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    const answer=()=>choices?{choice:sel.value,text:inp.value}:inp.value;
    const done=v=>{ wrap.remove(); document.removeEventListener("keydown",key,true); resolve(v); };
    const key=e=>{
      if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); done(null); }
      else if(e.key==="Enter"){ e.preventDefault(); e.stopPropagation(); done(answer()); }
    };
    document.addEventListener("keydown",key,true);
    cancel.onclick=()=>done(null);
    ok.onclick=()=>done(answer());
    wrap.onpointerdown=e=>{ if(e.target===wrap)done(null); };
    setTimeout(()=>{ (choices&&inp.style.display==="none"?sel:inp).focus();
      if(inp.style.display!=="none")inp.select(); },20);
  });
}


/* What the bar is acting on. A group answers as a whole — the same rule the restyle path uses. */
function sbSel(){
  try{
    const sel=maSelectedMarks();
    /* 6gg — a measurement's reading travels with it: the bar copies, stamps and deletes the whole
       mark, never the run on its own. It goes on the END so nothing that reads the first selected
       mark — "which panel is this?" — is answered by a label. */
    try{ maOwnedReadings(sel).forEach(a=>sel.annos.push(a)); }catch(e){}
    return sel;
  }catch(e){ return {annos:[],lines:[]}; }
}
/* 6gb — a callout counts as ONE. Its leader is part of the selection so that every action reaches it,
   but the bar should not announce "2 selected" for a single callout. */
function sbCount(){
  const s=sbSel();
  let owned=s.lines.filter(l=>l.coFor!=null&&s.annos.some(a=>a.id===l.coFor)).length;
  /* 6gg — and a measurement is one mark, not a run and a reading */
  owned+=s.lines.filter(l=>l.dimFor!=null&&s.annos.some(a=>a.id===l.dimFor)).length;
  return Math.max(1,s.annos.length+s.lines.length-owned)*((s.annos.length+s.lines.length)?1:0);
}

/* The tool whose properties panel matches what is selected, so "Edit properties" opens the right one. */
function sbToolFor(sel){
  const a=sel.annos[0], l=sel.lines[0];
  /* 6gg — a measurement first: its run is the mark, whatever else the selection has picked up */
  if((sel.lines||[]).some(z=>z.maKind==="dim"))return "dim";
  if(a){
    if(a.kind==="img")return "snapshot";       /* 6gd — a picture's frame and opacity */
    if(a.maKind==="callout")return "callout";
    if(shapeOf(a)==="ellipse")return "circle";
    if(shapeOf(a)==="rect")return "box";
    if(isTextBox(a))return "text";
    return "redline";
  }
  if(l){
    if(l.maKind==="dim")return "dim";        /* 6gg — a measurement, scale and units and all */
    if((l.pts||[]).length>2)return "poly";
    const e=endsOf(l);
    return (e[0]||e[1])?"arrow":"line";
  }
  return maToolOf();
}

/* =================================================================================================
   6g1 — COPY PROPERTIES
   Ced: "Add 'Copy Properties' and the next item/s selected would have the same properties."

   A format painter. Press it with something selected and its whole look is picked up; the button stays
   lit, and every mark you select after that takes it, until you press the button again or press
   Escape. It copies the LOOK and nothing else — never the text, the geometry, the group, the lock or
   the subject — so painting a box's style onto a line moves the colour, weight, dash and opacity
   across and leaves both marks where and what they are.
   ================================================================================================= */
const SB_PAINT_KEYS_A=["col","colOp","sw","dash","fill","fillOp","bg","bgNone","font","size",
                       "uline","strikeout","align","valign","pat","patCol","patScale","patRot","patOp","hl"];
const SB_PAINT_KEYS_L=["col","colOp","sw","dash","lpat","le0","le1","hl","fill","fillOp",
                       "pat","patCol","patScale","patRot","patOp"];
let SB_PAINT=null;          /* the look on the brush, or null */
let _sbPaintSig="";         /* the selection it was picked up from, so it is not re-applied to itself */

function sbSelSig(){
  return [S.sel,S.selLine,[...(S.selMulti||[])].join(","),[...(S.selMultiL||[])].join(",")].join("|");
}
function sbCopyProps(){
  const sel=sbSel(); const o=sel.annos[0]||sel.lines[0];
  if(!o){ toast("Select a mark to copy from"); return; }
  const look={};
  (sel.annos.length?SB_PAINT_KEYS_A:SB_PAINT_KEYS_L).forEach(k=>{ if(o[k]!=null)look[k]=o[k]; });
  if(sel.lines.length&&!sel.annos.length){ const e=endsOf(o); look.le0=e[0]; look.le1=e[1]; }
  SB_PAINT=look; _sbPaintSig=sbSelSig();
  selbarSync();
  toast("Properties copied");
  setStatus("Copy properties on — Escape stops it.");
}
function sbStopPaint(quiet){
  if(!SB_PAINT)return false;
  SB_PAINT=null; _sbPaintSig=""; _sbPaintHold=0; selbarSync();
  if(!quiet)setStatus("Copy properties off.");
  return true;
}
/* 6i0 — WHAT COUNTS AS PAINTING, AND WHAT IS JUST SELECTING.
   Ced: "if a text is at a specific font size and the user moves or selects it with ctrl, it should not
   change font size", and "copying properties should end if esc is clicked."

   The brush applied itself to whatever the selection became, and a selection changes for reasons that
   have nothing to do with painting: Ctrl-clicking a second mark to move the pair, Ctrl+A to take the
   page, an undo that brings marks back. A twenty-point heading picked up by one of those came back the
   size of whatever was on the brush, and the only way out was a button the user had stopped looking at.

   So a press that ADDS to a selection, or one that takes the whole page, is a selection gesture and the
   brush keeps its hands off it; a plain click on one mark is the painting gesture and still paints.
   `_sbPaintHold` is set by those gestures for the moment it takes the selection to settle. */
let _sbPaintHold=0;
function sbPaintHold(){ _sbPaintHold=Date.now(); }
/* Called whenever the selection changes while the brush is loaded. */
function sbPaintOnto(){
  if(!SB_PAINT)return;
  if(Date.now()-_sbPaintHold<400)  { _sbPaintSig=sbSelSig(); return; }
  const sig=sbSelSig();
  if(!sig||sig===_sbPaintSig)return;
  const sel=sbSel(); if(!sel.annos.length&&!sel.lines.length)return;
  /* more than one mark at once is a selection, not a brush stroke — the brush paints what you point at */
  if((sel.annos.length+sel.lines.length)>1){ _sbPaintSig=sig; return; }
  _sbPaintSig=sig;
  pushHistory();
  sel.annos.forEach(a=>{ SB_PAINT_KEYS_A.forEach(k=>{ if(SB_PAINT[k]!=null)a[k]=SB_PAINT[k]; }); });
  sel.lines.forEach(l=>{ SB_PAINT_KEYS_L.forEach(k=>{ if(SB_PAINT[k]!=null)l[k]=SB_PAINT[k]; });
                         try{syncArrowFlag(l);}catch(e){} });
  layoutAnnos(); drawAllLines();
  const n=sel.annos.length+sel.lines.length;
  setStatus(`Properties applied to ${n} mark${n===1?"":"s"}. Still copying — Escape to stop.`);
}

/* ---- the actions -------------------------------------------------------------------------------- */
function sbLocked(sel){ return sel.annos.concat(sel.lines).some(o=>o.lock); }
function sbSetLock(on){
  const sel=sbSel(); if(!sbCount())return;
  pushHistory();
  sel.annos.forEach(a=>{ a.lock=on||undefined; });
  sel.lines.forEach(l=>{ l.lock=on||undefined; });
  layoutAnnos(); drawAllLines(); selbarSync();
  setStatus(on?"Locked — these marks cannot be moved, restyled or deleted until you unlock them."
              :"Unlocked.");
}
function sbLayer(where){
  const sel=sbSel(); if(!sbCount())return;
  pushHistory();
  const zs=S.annos.map(a=>a.z||0);
  const top=zs.length?Math.max(...zs):0, bot=zs.length?Math.min(...zs):0;
  sel.annos.forEach(a=>{
    if(where==="front"){ a.z=top+1; a.under=false; }
    else if(where==="back"){ a.z=bot-1; a.under=false; }
    else if(where==="under"){ a.under=true; }
    else if(where==="over"){ a.under=false; }
  });
  layoutAnnos(); selbarSync();
  setStatus(where==="under"?"Behind the page — the printed drawing reads over these marks."
           :where==="over"?"In front of the page."
           :where==="front"?"Brought to the front.":"Sent to the back.");
}
/* 6je — FLATTEN, AS A FLATTEN. Ced: "flatten does not work. make sure to add a prompt if the user is
   sure to flatten the redline." It always set the flag the exporter reads — the marks really were drawn
   into the page rather than added as annotations — but on screen absolutely nothing happened: the mark
   still selected, still dragged, still looked like a mark, so from the outside the button did nothing.
   It behaves like the one in Bluebeam now. It asks first, because it is not a small thing to do; then
   the marks become part of the page — still drawn, no longer something you can pick up — and the bar
   goes away with the selection. Ctrl+Z puts them back, and so does "Unflatten everything on this page"
   in the page's own right-click menu. */
async function sbFlatten(){
  const sel=sbSel(); if(!sbCount())return;
  /* ==================================================================================================
     6lq — A PICTURE IS NEVER FLATTENED.
     Ced: "do not flatten the photos so it can be editable on other editors."
     Flattening paints a mark into the sheet, which is the right answer for a redline somebody must not
     be able to drag — and the wrong one for a photo. A photo exported as a Stamp annotation can be
     moved, resized and deleted in Bluebeam or Acrobat by whoever receives the package; painted into
     the page it is pixels on a drawing and nobody can do anything with it, here or anywhere else.
     So pictures are kept out of the flatten, rather than the button being taken away: a selection of
     a note and a photo flattens the note and says so.
     ================================================================================================== */
  const pics=sel.annos.filter(a=>a&&a.kind==="img");
  const flatA=sel.annos.filter(a=>!(a&&a.kind==="img"));
  const n=flatA.length+sel.lines.length;
  if(!n){
    toast(pics.length===1?"A photo is left editable rather than flattened"
                         :"Photos are left editable rather than flattened");
    return;
  }
  const yes=await sbConfirm({
    title:"Flatten "+n+" redline"+(n===1?"":"s")+"?",
    hint:"They become part of the page: still drawn, but no longer selectable or editable, and on "+
         "export they are painted into the sheet rather than added as annotations. Ctrl+Z undoes it, "+
         "and right-clicking the page offers to unflatten everything on it."+
         (pics.length?("  The "+(pics.length===1?"photo stays":"photos stay")+
                       " editable — a picture is exported as an annotation so it can still be moved "+
                       "or removed in another PDF editor."):""),
    ok:"Flatten", danger:true});
  if(!yes)return;
  pushHistory();
  flatA.forEach(a=>{ a.flat=true; });
  sel.lines.forEach(l=>{ l.flat=true; });
  try{ clearMulti&&clearMulti(); }catch(e){}
  S.sel=null; S.selLine=null;
  try{ selectAnno(null); }catch(e){}
  layoutAnnos(); drawAllLines(); selbarSync();
  try{ autosave(); }catch(e){}
  toast(`${n} mark${n===1?"":"s"} flattened`);
  setStatus("Flattened — part of the page now. Ctrl+Z puts "+(n===1?"it":"them")+" back, or right-click "+
            "the page and unflatten everything on it.");
}
/* the way back, for marks that can no longer be clicked: every flattened mark on one page */
function sbUnflattenPage(pi){
  const A=(S.annos||[]).filter(a=>a.page===pi&&a.flat);
  const L=(S.lines||[]).filter(l=>l.page===pi&&l.flat);
  if(!A.length&&!L.length){ toast("Nothing is flattened on this page"); return; }
  pushHistory();
  A.forEach(a=>{ a.flat=undefined; });
  L.forEach(l=>{ l.flat=undefined; });
  layoutAnnos(); drawAllLines();
  try{ autosave(); }catch(e){}
  setStatus((A.length+L.length)+" mark"+((A.length+L.length)===1?"":"s")+" unflattened on page "+(pi+1)+".");
}
function sbUnflatten(){
  const sel=sbSel(); if(!sbCount())return;
  pushHistory();
  sel.annos.forEach(a=>{ a.flat=undefined; });
  sel.lines.forEach(l=>{ l.flat=undefined; });
  layoutAnnos(); drawAllLines(); selbarSync();
  setStatus("No longer flattened — these export as movable annotations again.");
}
async function sbSubject(){
  const sel=sbSel(); if(!sbCount())return;
  const cur=(sel.annos[0]||sel.lines[0]||{}).subj||"";
  const v=await sbAsk({title:"Subject",
    hint:"Shown in the redlines drawer, and written into the PDF as /Subj — which is what another "+
         "editor lists its markups by.",
    value:cur, placeholder:"Mount correction", ok:"Set subject"});
  if(v==null)return;
  pushHistory();
  sel.annos.forEach(a=>{ a.subj=v||undefined; });
  sel.lines.forEach(l=>{ l.subj=v||undefined; });
  updateRail&&updateRail(); selbarSync();
  setStatus(v?`Subject set to “${v}”.`:"Subject cleared.");
}
async function sbApplyToPages(){
  const sel=sbSel(); if(!sbCount())return;
  const total=S.pages.length;
  const here=(S.pages[S.page]?S.page:0)+1;
  const v=await sbAsk({title:"Apply annotations to pages",
    hint:`A copy of ${sbCount()} mark${sbCount()===1?"":"s"} onto every page in the range. `+
         `The page it is already on is skipped.`,
    choiceLabel:"Page range",
    choices:[{value:"all",   label:`All pages (${total})`},
             {value:"even",  label:"Even pages"},
             {value:"odd",   label:"Odd pages"},
             {value:"custom",label:"Custom range"}],
    choice:"all", freeOn:"custom",
    value:"", placeholder:`e.g. ${here}-${Math.min(total,here+4)}, ${total}`, ok:"Apply"});
  if(v==null)return;
  const want=new Set();
  if(v.choice==="all"){ for(let k=1;k<=total;k++)want.add(k-1); }
  else if(v.choice==="even"){ for(let k=2;k<=total;k+=2)want.add(k-1); }
  else if(v.choice==="odd"){ for(let k=1;k<=total;k+=2)want.add(k-1); }
  else{
    String(v.text||"").split(",").forEach(part=>{
      const m=/^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(part); if(!m)return;
      const a=Math.max(1,parseInt(m[1],10)), b=Math.min(total,parseInt(m[2]||m[1],10));
      for(let k=a;k<=b;k++)want.add(k-1);
    });
  }
  if(!want.size){ toast("No pages matched that"); return; }
  let made=0, resized=0;
  historyBatch(()=>{
    want.forEach(pi=>{
      const gmap={}, comap={}, newA=[], newL=[];
      let from=null;
      sel.annos.forEach(a=>{ if(a.page===pi)return;
        if(from==null)from=a.page;
        const b=Object.assign({},_cleanA(a),{id:seq++,page:pi});
        if(a.group!=null){ if(gmap[a.group]==null)gmap[a.group]=seq++; b.group=gmap[a.group]; }
        comap[a.id]=b.id;                       /* 6g9 — so a copied leader finds its copied box */
        S.annos.push(b); newA.push(b); made++; });
      sel.lines.forEach(l=>{ if(l.page===pi)return;
        if(from==null)from=l.page;
        const b=Object.assign({},_cleanL(l),{id:seq++,page:pi});
        if(l.pts)b.pts=l.pts.map(p=>[p[0],p[1]]);
        if(l.group!=null){ if(gmap[l.group]==null)gmap[l.group]=seq++; b.group=gmap[l.group]; }
        if(l.coFor!=null)b.coFor=comap[l.coFor];
        if(l.dimFor!=null)b.dimFor=comap[l.dimFor];   /* 6gg — and its reading with it */
        S.lines.push(b); newL.push(b); made++; });
      /* 6jp — a copy that lands on a page of another size keeps its SIZE, not its fraction. Ced sent
         a document with six landscape pages among sixty-one portrait ones, where the same stamp came
         out half again as wide and a third shorter on the six. */
      if(from!=null){ try{ if(maKeepSize(newA,newL,from,pi))resized++; }catch(e){} }
    });
  });
  layoutAnnos(); drawAllLines(); updateRail(); updateCount();
  toast(`Copied onto ${want.size} page${want.size===1?"":"s"}`);
  setStatus(`${made} mark${made===1?"":"s"} placed across ${want.size} page${want.size===1?"":"s"}.`+
    (resized?` ${resized} page${resized===1?"":"s"} ${resized===1?"is":"are"} a different size — the `+
             `marks there were kept at their own size rather than stretched to fit.`:""));
}
/* Keep the selection as a reusable stamp. It joins the Markups tab beside the uploaded graphics, and a
   click drops it on the page you are on — the same placement a photo markup uses. */
async function sbToLibrary(){
  const sel=sbSel(); if(!sbCount())return;
  const name=await sbAsk({title:"Add to markup library",
    hint:"It joins the Markups tab and can be dropped on any page, in this report or the next.",
    value:(sel.annos[0]&&String(sel.annos[0].text||"").split("\n")[0])||"Markup",
    placeholder:"New sector frame", ok:"Save markup"});
  if(!name)return;
  const xs=[],ys=[];
  sel.annos.forEach(a=>{ xs.push(a.nx); ys.push(a.ny); });
  sel.lines.forEach(l=>linePts(l).forEach(p=>{ xs.push(p[0]); ys.push(p[1]); }));
  const ox=Math.min(...xs), oy=Math.min(...ys);
  const rec={
    id:"grp"+Date.now().toString(36), name, kind:"group",
    /* 6hl — the page it was taken from, so the preview keeps the markup's proportions */
    pw:((S.pages[sel.annos[0]?sel.annos[0].page:(sel.lines[0]||{}).page]||{}).w1)||612,
    ph:((S.pages[sel.annos[0]?sel.annos[0].page:(sel.lines[0]||{}).page]||{}).h1)||792,
    annos:sel.annos.map(a=>Object.assign({},_cleanA(a),{nx:a.nx-ox,ny:a.ny-oy})),
    lines:sel.lines.map(l=>Object.assign({},_cleanL(l),{
      x1:l.x1-ox,y1:l.y1-oy,x2:l.x2-ox,y2:l.y2-oy,
      pts:(l.pts||[]).map(p=>[p[0]-ox,p[1]-oy])}))
  };
  MA_MARKUPS.unshift(rec);
  if(!maSaveMarkups()){ MA_MARKUPS.shift(); toast("No room left in this browser's storage"); return; }
  maRenderPanel();
  MA_TAB="markups"; maPanelOpen(true,document.getElementById("markupsBtn"));
  toast("Added to your markups");
  setStatus(`“${name}” saved — click it in the Markups tab, then click a page to drop it.`);
}
/* =================================================================================================
   6i6 — FLIP
   Ced: "also add flip in edit photo, also in all tools in the toolbar below … flip vertical or
   horizontal."

   A flip MIRRORS the selection about its own middle: every mark's box is reflected, every stroke's
   points are reflected, and a turned mark's angle is negated so the mirror image is a true one. A
   PICTURE is mirrored in its pixels as well, because that is what flipping a photograph means; text
   is not, because mirrored words are not words. Two marks side by side swap sides, which is the other
   half of what a flip is for.
   ================================================================================================= */
function sbFlip(axis){
  const sel=sbSel();
  const n=sel.annos.length+sel.lines.length;
  if(!n){ toast("Select something to flip"); return; }
  if(sbLocked(sel)){ toast("Some of this is locked"); return; }
  const H=(axis==="h");
  /* the selection's own extent, in the page's own coordinates */
  const X=[],Y=[];
  sel.annos.forEach(a=>{ X.push(a.nx,a.nx+(a.nw||0)); Y.push(a.ny,a.ny+(a.nh||0)); });
  sel.lines.forEach(l=>linePts(l).forEach(p=>{ X.push(p[0]); Y.push(p[1]); }));
  if(!X.length)return;
  const x0=Math.min(...X), x1=Math.max(...X), y0=Math.min(...Y), y1=Math.max(...Y);
  const mx=v=>x0+x1-v, my=v=>y0+y1-v;
  pushHistory();
  sel.annos.forEach(a=>{
    if(H)a.nx=mx(a.nx+(a.nw||0));
    else  a.ny=my(a.ny+(a.nh||0));
    if(a.rot)a.rot=-a.rot;
    /* a picture mirrors its own pixels too; everything else keeps its content the right way round */
    if(a.kind==="img"){ if(H)a.flipX=!a.flipX; else a.flipY=!a.flipY; }
    /* a callout's leader is a stroke and is mirrored with the rest below */
  });
  sel.lines.forEach(l=>{
    const f=p=>[H?mx(p[0]):p[0], H?p[1]:my(p[1])];
    if(l.pts&&l.pts.length)l.pts=l.pts.map(f);
    const a2=f([l.x1,l.y1]), b2=f([l.x2,l.y2]);
    l.x1=a2[0]; l.y1=a2[1]; l.x2=b2[0]; l.y2=b2[1];
    try{ syncArrowFlag(l); }catch(e){}
  });
  try{ maSyncCallouts&&maSyncCallouts(); }catch(e){}
  layoutAnnos(); drawAllLines(); paintMulti(); updateRail(); autosave();
  toast(H?"Flipped left to right":"Flipped top to bottom");
}
function sbAlign(how){
  const sel=sbSel();
  if(sel.annos.length+sel.lines.length<2){ toast("Select two or more marks to align"); return; }
  const L=[], R=[], T=[], B=[];
  sel.annos.forEach(a=>{ L.push(a.nx); R.push(a.nx+(a.nw||0)); T.push(a.ny); B.push(a.ny+(a.nh||0)); });
  sel.lines.forEach(l=>linePts(l).forEach(p=>{ L.push(p[0]); R.push(p[0]); T.push(p[1]); B.push(p[1]); }));
  const l0=Math.min(...L), r0=Math.max(...R), t0=Math.min(...T), b0=Math.max(...B);
  pushHistory();
  const dxOf=(x,w)=>how==="left"?l0-x:how==="right"?(r0-w)-x:how==="cx"?((l0+r0)/2-w/2)-x:0;
  const dyOf=(y,h)=>how==="top"?t0-y:how==="bottom"?(b0-h)-y:how==="cy"?((t0+b0)/2-h/2)-y:0;
  sel.annos.forEach(a=>{ a.nx+=dxOf(a.nx,a.nw||0); a.ny+=dyOf(a.ny,a.nh||0); });
  sel.lines.forEach(l=>{
    const p=linePts(l);
    const xs=p.map(q=>q[0]), ys=p.map(q=>q[1]);
    const dx=dxOf(Math.min(...xs),Math.max(...xs)-Math.min(...xs));
    const dy=dyOf(Math.min(...ys),Math.max(...ys)-Math.min(...ys));
    const np=p.map(q=>[q[0]+dx,q[1]+dy]);
    if(l.pts||np.length>2)l.pts=np;
    l.x1=np[0][0]; l.y1=np[0][1]; l.x2=np[np.length-1][0]; l.y2=np[np.length-1][1];
  });
  layoutAnnos(); drawAllLines();
  setStatus("Aligned.");
}
/* Even gaps between three or more marks, along one axis. */
function sbDistribute(axis){
  const sel=sbSel();
  const items=sel.annos.map(a=>({o:a,kind:"a"})).concat(sel.lines.map(l=>({o:l,kind:"l"})));
  if(items.length<3){ toast("Select three or more marks to distribute"); return; }
  const posOf=it=>{
    if(it.kind==="a")return (axis==="x")?(it.o.nx+(it.o.nw||0)/2):(it.o.ny+(it.o.nh||0)/2);
    const p=linePts(it.o), xs=p.map(q=>q[(axis==="x")?0:1]);
    return (Math.min(...xs)+Math.max(...xs))/2;
  };
  const moveBy=(it,d)=>{
    if(it.kind==="a"){ if(axis==="x")it.o.nx+=d; else it.o.ny+=d; return; }
    const p=linePts(it.o).map(q=>[q[0]+((axis==="x")?d:0), q[1]+((axis==="x")?0:d)]);
    if(it.o.pts||p.length>2)it.o.pts=p;
    it.o.x1=p[0][0]; it.o.y1=p[0][1];
    it.o.x2=p[p.length-1][0]; it.o.y2=p[p.length-1][1];
  };
  items.sort((a,b)=>posOf(a)-posOf(b));
  const first=posOf(items[0]), last=posOf(items[items.length-1]);
  const step=(last-first)/(items.length-1);
  pushHistory();
  items.forEach((it,i)=>{ if(i===0||i===items.length-1)return;
    moveBy(it,(first+step*i)-posOf(it)); });
  layoutAnnos(); drawAllLines();
  setStatus(`Distributed ${items.length} marks evenly ${axis==="x"?"across":"down"}.`);
}

/* 6jc — THE LAYER LIST. Ced sent Bluebeam's — a column of names, a tick on the one being drawn into,
   "Create layer" at the foot — and asked for "something like this on the layers". This is that list,
   hung off the button that already said "Layer", because a mark's layer and a mark's place in the
   stack are the same question asked at two scales: which set of marks is this one part of, and where
   in that set does it sit. The eye at the end of a row switches the whole layer off — on screen and in
   the exported file both. */
function sbLayerItems(sel){
  const ls=maLayers();
  const ids=new Set(sel.annos.concat(sel.lines).map(o=>maLayerOf(o)));
  const out=[{head:"LAYER"}];
  ls.forEach(L=>{
    const mine=ids.size===1&&ids.has(L.id);
    out.push({
      label:(mine?"✓  ":"   ")+L.name,
      on:mine,
      note:String(maLayerCount(L.id)),
      title:"Move the selection onto “"+L.name+"”",
      run:()=>sbLayerMove(L.id),
      aux:{glyph:(L.vis===false?"◌":"◉"), on:L.vis!==false,
           title:(L.vis===false?"Show":"Hide")+" this layer everywhere, the export included",
           run:()=>sbLayerVis(L.id)}
    });
  });
  out.push({label:"+  Create layer…", run:()=>sbLayerNew()});
  if(ls.length>1&&ids.size===1)
    out.push({label:"Rename this layer…", run:()=>sbLayerRename([...ids][0])},
             {label:"Delete this layer",  run:()=>sbLayerDrop([...ids][0])});
  else if(ids.size===1)
    out.push({label:"Rename this layer…", run:()=>sbLayerRename([...ids][0])});
  return out;
}
function sbLayerMove(id){
  const sel=sbSel(); if(!sbCount())return;
  pushHistory();
  sel.annos.forEach(a=>{ a.lay=id; });
  sel.lines.forEach(l=>{ l.lay=id; });
  S.layCur=id;
  layoutAnnos(); drawAllLines(); selbarSync();
  try{ autosave(); }catch(e){}
  setStatus("Moved onto “"+maLayer(id).name+"” — new marks join it too.");
}
function sbLayerVis(id){
  const L=maLayer(id); if(!L)return;
  L.vis=(L.vis===false);
  layoutAnnos(); drawAllLines(); updateCount&&updateCount();
  try{ autosave(); }catch(e){}
  /* the menu is still open on purpose; rebuild it in place so the eye and the tick agree */
  const b=document.querySelector("#selbar .sb-lay");
  if(b){ const sel=sbSel(); sbMenu(b,sbLayerItems(sel).concat(sbStackItems())); }
  setStatus("“"+L.name+"” is "+(L.vis===false?"hidden — it will not be exported either.":"showing again."));
}
async function sbLayerNew(){
  const name=await sbAsk({title:"Create layer",
    hint:"A name for a set of marks you want to be able to turn on and off together — the way a CAD "+
         "sheet keeps its dimensions, its notes and its symbols apart.",
    value:"", placeholder:"Proposed equipment", ok:"Create"});
  if(name==null)return;
  pushHistory();
  const id=maLayerAdd(name.trim()||null);
  if(sbCount())sbLayerMove(id);
  else { layoutAnnos(); try{ autosave(); }catch(e){}
         setStatus("“"+maLayer(id).name+"” created — new marks join it."); }
}
async function sbLayerRename(id){
  const L=maLayer(id); if(!L)return;
  const name=await sbAsk({title:"Rename layer",value:L.name,ok:"Rename"});
  if(name==null)return;
  pushHistory();
  L.name=String(name).trim().slice(0,60)||L.name;
  try{ autosave(); }catch(e){}
  setStatus("Renamed to “"+L.name+"”.");
}
async function sbLayerDrop(id){
  const L=maLayer(id); if(!L)return;
  const n=maLayerCount(id);
  const yes=await sbConfirm({title:"Delete the layer “"+L.name+"”?",
    hint:n?("Its "+n+" mark"+(n===1?"":"s")+" are not deleted — they move to the first layer."):
           "It is empty.",
    ok:"Delete layer", danger:true});
  if(!yes)return;
  pushHistory();
  if(!maLayerRemove(id)){ toast("There has to be one layer"); return; }
  layoutAnnos(); drawAllLines(); selbarSync();
  try{ autosave(); }catch(e){}
  setStatus("Layer deleted.");
}
/* where a mark sits INSIDE its layer — what the ≡ button always did */
function sbStackItems(){
  return [
    {sep:true},
    {head:"STACK"},
    {label:"Bring to front",run:()=>sbLayer("front")},
    {label:"Send to back",run:()=>sbLayer("back")},
    {sep:true},
    {label:"Behind the printed page",run:()=>sbLayer("under")},
    {label:"In front of the page",run:()=>sbLayer("over")}
  ];
}
function sbSelectKind(){
  const sel=sbSel(); const a=sel.annos[0], l=sel.lines[0];
  const pi=(a||l||{}).page;
  clearMulti(); selectAnno(null); selectLine(null);
  let n=0;
  if(a){ const k=shapeOf(a)||a.maKind||"";
    S.annos.forEach(o=>{ if(o.page!==pi)return;
      if((shapeOf(o)||o.maKind||"")===k){ S.selMulti.add(o.id); n++; } }); }
  if(l){ S.lines.forEach(o=>{ if(o.page===pi){ S.selMultiL.add(o.id); n++; } }); }
  paintMulti(); selbarSync();
  setStatus(`Selected ${n} mark${n===1?"":"s"} of the same kind on this page.`);
}
function sbDelete(){
  const sel=sbSel(); if(!sbCount())return;
  if(sbLocked(sel)){ toast("Unlock these first"); return; }
  pushHistory();
  const aid=new Set(sel.annos.map(a=>a.id)), lid=new Set(sel.lines.map(l=>l.id));
  S.annos=S.annos.filter(a=>!aid.has(a.id));
  S.lines=S.lines.filter(l=>!lid.has(l.id));
  clearMulti(); S.sel=null; S.selLine=null;
  try{ $("#annobar").classList.remove("show"); $("#linebar").classList.remove("show"); }catch(e){}
  layoutAnnos(); drawAllLines(); updateRail(); updateCount(); selbarSync();
}

/* ---- the little drop-up menus the bar uses ------------------------------------------------------ */
let _sbMenu=null;
/* 6jc — ONE ROW BUILDER FOR BOTH MENUS. A layer row is a menu item with two more things on it: a tick
   when it is the one being drawn into, and an eye at the end that switches the layer off without
   closing the menu — so you can try two or three combinations in one press-and-look. */
function sbMenuRow(m,it){
  if(it.sep){ m.appendChild(sbEl("div","sb-sep")); return; }
  if(it.head){ m.appendChild(sbEl("div","sb-mh",it.head)); return; }
  const row=sbEl("div","sb-mrow");
  const b=sbEl("button","sb-mi"+(it.off?" off":"")+(it.on?" tick":""),it.label); b.type="button";
  if(it.title)b.title=it.title;
  if(it.off)b.disabled=true;
  else b.onclick=()=>{ if(!it.keepOpen)sbMenuClose(); it.run&&it.run(); };
  row.appendChild(b);
  if(it.note)row.appendChild(sbEl("span","sb-mnote",it.note));
  if(it.aux){
    const x=sbEl("button","sb-maux"+(it.aux.on?" on":""),it.aux.glyph); x.type="button";
    if(it.aux.title)x.title=it.aux.title;
    x.onclick=e=>{ e.stopPropagation(); it.aux.run(); };
    row.appendChild(x);
  }
  m.appendChild(row);
}
function sbMenu(anchor,items){
  sbMenuClose();
  const m=sbEl("div","sb-menu");
  items.forEach(it=>sbMenuRow(m,it));
  document.body.appendChild(m);
  const r=anchor.getBoundingClientRect();
  m.style.left=Math.max(8,Math.min(window.innerWidth-m.offsetWidth-8,r.left))+"px";
  m.style.top=Math.max(8,r.top-m.offsetHeight-8)+"px";
  _sbMenu=m;
}
function sbMenuClose(){ if(_sbMenu){ _sbMenu.remove(); _sbMenu=null; } }
/* the same menu, opened at a point rather than under a button, and allowed to drop DOWN when there is
   room below — which is where a right-click expects it */
function sbMenuAt(x,y,items,keep){
  sbMenuClose();
  const m=sbEl("div","sb-menu sb-ctx");
  items.forEach(it=>sbMenuRow(m,it));
  document.body.appendChild(m);
  const w=m.offsetWidth, h=m.offsetHeight;
  let left=x, top=y;
  if(left+w>window.innerWidth-8)left=Math.max(8,x-w);
  if(top+h>window.innerHeight-8)top=Math.max(8,window.innerHeight-h-8);
  m.style.left=left+"px"; m.style.top=top+"px";
  if(keep)m._keep=true;
  _sbMenu=m;
  return m;
}

/* =================================================================================================
   6j7 — THE RIGHT-CLICK MENU
   Ced sent a picture of Bluebeam's page menu and asked for one: "right click should open these
   settings." Right-clicking a MARK gives that mark's actions — the same ones the selection bar and its
   overflow carry, so there is one definition of what can be done and two ways to reach it. Right
   clicking the sheet gives the page's: what to do with this page, what to do with the whole document,
   and the two Assist panels that read it. The browser's own menu is suppressed only where this one
   opens; over the ribbon, a field or a panel it is left alone, because that is where you would want
   Copy and Paste.
   ================================================================================================= */
function sbCtxMark(sel){
  const all=sel.annos.concat(sel.lines);
  const locked=sbLocked(sel);
  const flat=all.some(o=>o.flat);
  const grouped=all.some(o=>o.group!=null);
  const one=(sel.annos.length===1&&!sel.lines.length)?sel.annos[0]:null;
  const out=[
    {label:"Edit properties…", run:()=>{ try{ tpOpen(sbToolFor(sel),
        document.querySelector("#selbar .sb-b")||document.body,true); }catch(e){} }},
    {label:"Duplicate",        run:()=>{ duplicateSelected(); selbarSync(); }},
    /* 6jl — cut, copy and paste, because this menu now answers where the browser's used to */
    {label:"Cut",              run:()=>copySelectedAnnos(true)},
    {label:"Copy",             run:()=>copySelectedAnnos(false)},
    {label:"Paste",            run:()=>{ try{ pasteAnnos(); }catch(e){ toast("Nothing to paste"); } },
                               off:!(typeof clipCount==="function"&&clipCount())},
    {sep:true},
    {label:"Bring to front",   run:()=>sbLayer("front")},
    {label:"Send to back",     run:()=>sbLayer("back")},
    {label:"Behind the printed page", run:()=>sbLayer("under")},
    {label:"In front of the page",    run:()=>sbLayer("over")},
    {sep:true}].concat(sbLayerItems(sel),[
    {sep:true},
    {label:(grouped?"Ungroup":"Group"), run:()=>{ if(grouped)ungroupSelected(); else groupSelected(); selbarSync(); }},
    {label:(locked?"Unlock":"Lock"),    run:()=>sbSetLock(!locked)},
    {label:(flat?"Unflatten":"Flatten"),run:()=>flat?sbUnflatten():sbFlatten()},
    {sep:true},
    {label:"Flip left to right", run:()=>sbFlip("h")},
    {label:"Flip top to bottom", run:()=>sbFlip("v")},
    {sep:true},
    {label:"Add to markup library", run:()=>sbToLibrary()},
    {label:"Apply to pages…",       run:()=>sbApplyToPages()},
    {label:"Copy properties",       run:()=>{ if(SB_PAINT)sbStopPaint(); else sbCopyProps(); }},
    {label:"Edit subject…",         run:()=>sbSubject()}
  ]);
  if(one&&one.kind==="img")
    out.splice(3,0,{label:"Edit picture…",run:()=>{ try{ skEditor(one); }catch(e){} }});
  out.push({sep:true},{label:"Delete",run:()=>sbDelete()});
  return out;
}
function sbCtxPage(pi){
  const n=(S.pages||[]).length, P=(S.pages||[])[pi];
  const go=(id)=>{ const b=document.getElementById(id); if(b&&!b.disabled)b.click(); };
  return [
    {head:"PAGE "+(pi+1)+" OF "+n},
    {label:"Select every mark on this page", run:()=>{ try{ selectAllOnPage(); }catch(e){} }},
    {label:"Paste here",  run:()=>{ try{ pasteAnnos(); }catch(e){ toast("Nothing to paste"); } }},
    {sep:true},
    /* what the tool actually keeps per page: whether it is locked against redlining, and whether it
       goes into the export. There is deliberately no "rotate page" here — the export takes each page's
       rotation from the PDF itself and nothing in the tool turns one, so a menu item for it would be a
       promise the export could not keep. */
    {label:(P&&P.locked)?"Unlock this page":"Lock this page (no redlines)",
                          run:()=>sbLockPage(pi)},
    {label:(P&&P.dropped)?"Put this page back in the export"
                         :"Leave this page out of the export", run:()=>sbDropPage(pi)},
    /* 6je — the way back from a flatten, for marks that can no longer be clicked */
    {label:"Unflatten everything on this page", run:()=>sbUnflattenPage(pi),
     off:!((S.annos||[]).some(a=>a.page===pi&&a.flat)||(S.lines||[]).some(l=>l.page===pi&&l.flat))},
    {sep:true},
    {label:"Organize pages…", run:()=>go("orgBtn")},
    {label:"Read table…",     run:()=>go("analyzeMaBtn")},
    {label:"Notes…",          run:()=>go("maBtn")},
    {label:"Markups…",        run:()=>go("markupsBtn")},
    {sep:true},
    {label:"Export marked-up PDF", run:()=>go("dlPdf")}
  ];
}
/* the two page actions this menu adds, written against the flags Organize pages already sets, so the
   two agree and either one reflects the other */
function sbDropPage(pi){
  try{
    const P=S.pages[pi]; if(!P)return;
    P.dropped=!P.dropped;
    reflectDropped(); updateRail&&updateRail(); autosave&&autosave();
  }catch(e){ toast("Use Organize pages for this"); }
}
function sbLockPage(pi){
  try{
    const P=S.pages[pi]; if(!P)return;
    P.locked=!P.locked;
    if(P.locked&&P.lockReason==null)P.lockReason="locked by hand";
    reflectLocked(); updateRail&&updateRail(); autosave&&autosave();
    setStatus(P.locked?("Page "+(pi+1)+" locked — no redlines can be placed on it.")
                      :("Page "+(pi+1)+" unlocked — you can redline it by hand."));
  }catch(e){ toast("Use Organize pages for this"); }
}

/* ---- the bar itself ------------------------------------------------------------------------------ */
function selbarEl(){
  let b=document.getElementById("selbar");
  if(!b){ b=sbEl("div","selbar"); b.id="selbar"; b.setAttribute("hidden",""); document.body.appendChild(b); }
  return b;
}
function sbBtn(icon,label,run,cls,title){
  const b=sbEl("button","sb-b"+(cls?" "+cls:"")); b.type="button";
  if(title||label){ b.title=title||label; b.setAttribute("aria-label",title||label); }
  /* 6jo — a glyph beginning with @ names one of Ced's drawings and is drawn rather than typed */
  if(typeof icon==="string"&&icon.charAt(0)==="@"&&typeof maIconSvg==="function"){
    const sp=sbEl("span","sb-i sb-svg"); sp.innerHTML=maIconSvg(icon.slice(1),15);
    b.appendChild(sp);
  }
  else b.appendChild(sbEl("span","sb-i",icon));
  if(label)b.appendChild(sbEl("span","sb-l",label));
  b.onclick=e=>{ e.preventDefault(); e.stopPropagation(); run(b); };
  return b;
}
function selbarSync(){
  const bar=selbarEl();
  const n=sbCount();
  if(!n||!S.doc){ bar.setAttribute("hidden",""); document.body.classList.remove("selbaron");
                  /* 6ja — a PAGE menu is not about the selection, so dropping the selection must not
                     take it away: right-clicking bare paper deselects on purpose, and the tick that
                     follows was closing the very menu that press opened. */
                  if(!(_sbMenu&&_sbMenu._keep))sbMenuClose();
                  return; }
  const sel=sbSel();
  const locked=sbLocked(sel);
  const flat=sel.annos.concat(sel.lines).some(o=>o.flat);
  const grouped=sel.annos.concat(sel.lines).some(o=>o.group!=null);
  bar.removeAttribute("hidden");
  document.body.classList.add("selbaron");   /* lifts the back-to-top mark clear of it */
  bar.innerHTML="";
  bar.appendChild(sbEl("span","sb-count",String(n)));

  /* 6fe — bound to the SELECTION: the panel shows what these marks carry and every change lands on
     them as it is made, leaving every tool's own remembered style alone. */
  /* 6li — every button on this bar carries its name under its glyph; see `.sb-b` in selbar.css for
     why hover was not a label. The words are Ced's own, in his order. */
  bar.appendChild(sbBtn("✎","Properties",b=>{
    try{ tpOpen(sbToolFor(sel),b,true); }catch(e){ toast("No properties for this"); }
  },null,"Edit properties"));
  bar.appendChild(sbBtn("@duplicate","Duplicate",()=>{
    if(locked){ toast("Unlock these first"); return; }
    if(!duplicateSelected())toast("Nothing to duplicate"); selbarSync();
  }));
  /* 6jc — the button says which layer the selection is on, the way Ced's picture does */
  const _lids=new Set(sel.annos.concat(sel.lines).map(o=>maLayerOf(o)));
  const _lname=(_lids.size===1)?maLayer([..._lids][0]).name:"Mixed";
  bar.appendChild(sbBtn("@layers",_lname,
    b=>sbMenu(b,sbLayerItems(sel).concat(sbStackItems())),"sb-lay","Layer — "+_lname));
  bar.appendChild(sbBtn("@group",grouped?"Ungroup":"Group",()=>{
    if(grouped)ungroupSelected(); else groupSelected(); selbarSync();
  }));
  bar.appendChild(sbBtn("@copy","Copy",()=>{ copySelectedAnnos(false); }));
  /* 6gf — a picture has one more thing you can do to it: erase parts of it, or wand a region and fill it */
  if(sel.annos.length===1&&!sel.lines.length&&sel.annos[0].kind==="img")
    bar.appendChild(sbBtn("@editpic","Edit picture",()=>{ try{ skEditor(sel.annos[0]); }catch(e){} }));
  /* 6jf — AND THE ONES THAT WERE TAKEN AWAY ARE BACK. v32 moved nine actions into the ⋯ to make the
     bar simpler; Ced: "the bottom toolbar became too simplified. bring back lock, flatten, add to
     markup, apply to pages, copy properties" — and "add flip on the mini tool bar that pops on the
     redlines". So the bar carries every action you actually do TO a mark, and the ⋯ keeps what is
     really about several marks at once: aligning, distributing, selecting by kind, the subject.
     They are icons with no words past the first five, which is what kept v32's bar narrow — the label
     is on hover and in what a screen reader reads. */
  /* =================================================================================================
     6kz — TWO FLIPS, TWO BUTTONS. Ced: "have a rotated version icon of this for flip vertical while
     this one retain for flip horizontal so no need for dropdown."
     Flip is two things, not a choice between two things: one menu meant two presses and a read for
     an action that is over in one. The same drawing does for both — turned a quarter, a mirror
     across the upright reads as a mirror across the level — so the second button is the first with
     `rotate(90deg)` on its glyph and nothing else to learn.
     ================================================================================================= */
  bar.appendChild(sbBtn("@flip","Flip (H)",()=>sbFlip("h"),"sb-ico","Flip left to right"));
  bar.appendChild(sbBtn("@flip","Flip (V)",()=>sbFlip("v"),"sb-ico sb-flipv","Flip top to bottom"));
  /* 6li — and this one goes red while it is on, which is the state worth reading at a glance */
  bar.appendChild(sbBtn(locked?"@unlock":"@lock",locked?"Unlock":"Lock",()=>sbSetLock(!locked),
                        "sb-ico"+(locked?" sb-locked":""),
                        locked?"Unlock these marks":"Lock these marks"));
  bar.appendChild(sbBtn("@flatten","Flatten",()=>flat?sbUnflatten():sbFlatten(),
                        "sb-ico"+(flat?" on":""), flat?"Unflatten":"Flatten"));
  bar.appendChild(sbBtn("@library","Add markup",()=>sbToLibrary(),"sb-ico","Add to markup library"));
  bar.appendChild(sbBtn("@applypages","Apply to pages",()=>sbApplyToPages(),"sb-ico","Apply to pages"));
  bar.appendChild(sbBtn("@props","Copy properties",()=>{ if(SB_PAINT)sbStopPaint(); else sbCopyProps(); },
                        "sb-ico"+(SB_PAINT?" on":""),
                        SB_PAINT?"Stop copying properties":"Copy properties"));
  /* 6g1 — Ced: "have center and middle alignment and other in the same realm." Left/centre/right and
     top/middle/bottom are the same operation on two axes, so they sit together, with centring on both
     axes at once and the two distributes under them. */
  bar.appendChild(sbBtn("⋯","",b=>sbMenu(b,[
    {label:"Edit subject…",        run:()=>sbSubject()},
    {label:"Select every mark of this kind on the page",run:()=>sbSelectKind()},
    {sep:true},
    {label:"Align left",           run:()=>sbAlign("left")},
    {label:"Align centres  (horizontal)", run:()=>sbAlign("cx")},
    {label:"Align right",          run:()=>sbAlign("right")},
    {label:"Align tops",           run:()=>sbAlign("top")},
    {label:"Align middles  (vertical)",   run:()=>sbAlign("cy")},
    {label:"Align bottoms",        run:()=>sbAlign("bottom")},
    {label:"Centre both ways",     run:()=>{ sbAlign("cx"); sbAlign("cy"); }},
    {sep:true},
    {label:"Distribute horizontally", run:()=>sbDistribute("x")},
    {label:"Distribute vertically",   run:()=>sbDistribute("y")}
  ]),"sb-more"));
  bar.appendChild(sbBtn("\u2715","",()=>sbDelete(),"sb-del","Delete"));
}

(function sbWire(){
  const start=()=>{
    selbarEl();
    document.addEventListener("pointerdown",e=>{
      if(_sbMenu&&!e.target.closest(".sb-menu")&&!e.target.closest(".sb-more"))sbMenuClose();
    },true);
    window.addEventListener("resize",()=>sbMenuClose());
    /* 6j7 — the right-click menu itself */
    document.addEventListener("contextmenu",e=>{
      if(!S.doc)return;                                   /* nothing open: the browser's menu stands */
      const t=e.target;
      if(!t.closest)return;
      /* the tool's own chrome, and any real field in it, keep the browser's menu */
      if(t.closest("#toolbar")||t.closest("#miniBar")||t.closest("#maPanel")||
         t.closest("#toolpop")||t.closest(".sk-edit")||t.closest("#dlg")||
         t.closest("#marksPanel")||t.closest("aside#rail")||t.closest(".selbar")||
         t.closest(".sb-menu")||t.closest(".sb-ask")||
         t.closest("input")||t.closest("textarea"))return;
      const markEl2=t.closest(".anno");
      /* 6jl — A MARK'S INSIDE IS STILL THE MARK. Ced: "right click of a redline/item/shape should
         toggle the tool's right click and not the browsers." Every shape, callout and text box holds
         its words in a `contenteditable` box — that is how you type into one — and the guard above
         skipped ANY contenteditable outright, so right-clicking the middle of a shape handed you
         Chrome's spell-check menu instead of the mark's. A contenteditable that belongs to a mark is
         not a text field the browser should answer for; only the fields in the tool's own chrome are,
         and those are already covered by the line above. What the browser's menu was carrying that the
         mark's did not — cut, copy, paste — is on the mark's menu now, so nothing is lost by taking it
         over. */
      if(!markEl2&&t.closest("[contenteditable=true]"))return;
      const strokeEl=t.closest&&t.closest("[data-lid]");
      const pgEl=t.closest&&t.closest(".page");
      if(!markEl2&&!strokeEl&&!pgEl)return;
      e.preventDefault(); e.stopPropagation();
      /* right-clicking something that is not in the selection selects it first, the way every
         application does — otherwise the menu acts on whatever happened to be selected before */
      if(markEl2){
        /* 6jl — and if the caret was in it, the typing is put away first, so Cut, Copy and Paste on
           this menu mean the MARK and cannot be mistaken for the words inside it */
        if(markEl2.classList.contains("editing")){
          const ed=markEl2.querySelector(".ed");
          try{ ed&&ed.blur(); }catch(e2){}
        }
        const id=+markEl2.dataset.id;
        if(!(S.sel===id||(S.selMulti&&S.selMulti.has(id)))){ clearMulti(); selectAnno(id); }
      }else if(strokeEl){
        const lid=+strokeEl.getAttribute("data-lid");
        if(!(S.selLine===lid||(S.selMultiL&&S.selMultiL.has(lid)))){ clearMulti(); selectLine(lid); }
      }
      /* 6ja — BARE PAGE MEANS THE PAGE'S MENU. Right-clicking the sheet itself, away from any mark, is
         asking about the PAGE — so whatever was selected steps aside first, rather than the menu
         quietly acting on a mark somewhere off-screen. */
      if(!markEl2&&!strokeEl&&pgEl&&sbCount()){
        try{ clearMulti&&clearMulti(); }catch(e2){}
        S.sel=null; S.selLine=null;
        try{ selectAnno(null); }catch(e2){}
        try{ paintSelUI&&paintSelUI(); }catch(e2){}
        try{ selbarSync(); }catch(e2){}
      }
      if(sbCount())sbMenuAt(e.clientX,e.clientY,sbCtxMark(sbSel()));
      else if(pgEl)sbMenuAt(e.clientX,e.clientY,sbCtxPage(+pgEl.dataset.idx||0),true);
    },true);
    document.addEventListener("keydown",e=>{
      if(e.key==="Escape"&&SB_PAINT){ sbStopPaint(); e.stopPropagation(); }
    },true);
    /* the selection can change without going through any one function — a drag that marquee-selects,
       an undo that drops a mark — so the bar checks on a slow tick as well as on the explicit calls.
       Cheap: it only rebuilds when the signature changes. */
    let last="";
    setInterval(()=>{
      const sig=[S.sel,S.selLine,[...(S.selMulti||[])].join(","),[...(S.selMultiL||[])].join(","),
                 S.annos.length,S.lines.length].join("|");
      if(sig!==last){ last=sig; try{ sbPaintOnto(); }catch(e){} selbarSync(); }
    },140);
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);
  else start();
})();
