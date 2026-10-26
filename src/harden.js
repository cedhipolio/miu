/* ==================================================================================================
   harden.js — v60. LAST IN THE APP BLOB: fixes that need every other file to have run first.

   guard.js is first and catches what goes wrong. This file is last and closes the gaps between the
   pieces — the places where two parts of the tool, each correct alone, met badly. Each one below was
   found by test/chaos.py or by the v60 visual tour, not by reading the code.
   ================================================================================================== */
(function(){
  "use strict";

  /* ---- 1. A MENU NEVER OUTLIVES THE THING THAT REPLACED IT -------------------------------------
     The context menu had no Escape at all, and opening a dialog from somewhere else (a shortcut, a
     ribbon button) left it standing — above the dialog's scrim, because the menu's z-index is higher.
     Measured in the v60 tour: right-click, Escape, Clear → a 700px menu over the confirm dialog, with
     the dialog's buttons underneath it. Escape now closes an open menu before anything else hears it,
     and every modal closes menus as it opens. */
  function closeMenus(){
    try{ if(typeof sbMenuClose==="function")sbMenuClose(); }catch(e){}
    try{ document.querySelectorAll(".sb-menu").forEach(function(m){ m.remove(); }); }catch(e){}
  }
  document.addEventListener("keydown",function(e){
    if(e.key!=="Escape")return;
    if(!document.querySelector(".sb-menu"))return;
    closeMenus(); e.preventDefault(); e.stopImmediatePropagation();
  },true);

  function closingMenusFirst(name){
    var f=window[name];
    if(typeof f!=="function"||f.__miuWrapped)return;
    var w=function(){ closeMenus(); return f.apply(this,arguments); };
    w.__miuWrapped=true;
    try{ window[name]=w; }catch(e){}
  }
  ["uiConfirm","sbAsk","skEditor","openHelp","openPageOrg","maAnalyzeOpen"].forEach(closingMenusFirst);

  /* ---- 2. A NUMBER THAT IS NOT A NUMBER NEVER REACHES A MARK -------------------------------------
     Every geometry write goes through layoutAnnos()/drawAllLines(). If anything upstream produced a
     NaN — a zero-size page, a division by a zero-width drag — the mark became unselectable and
     invisible, and the NEXT autosave wrote the NaN into storage, so a reload brought it back. Before
     each layout the model is checked; a non-finite coordinate is put back to its last finite value
     (or the page centre) and the event is recorded, so it is fixed and still visible in a report. */
  var last=new WeakMap();
  function heal(){
    try{
      if(typeof S==="undefined"||!S)return;
      var fixed=0;
      (S.annos||[]).forEach(function(a){
        var p=last.get(a)||{nx:0.45,ny:0.45,nw:0.1,nh:0.05};
        ["nx","ny","nw","nh"].forEach(function(k){
          if(a[k]==null)return;
          if(!Number.isFinite(a[k])){ a[k]=p[k]; fixed++; }
        });
        last.set(a,{nx:a.nx,ny:a.ny,nw:a.nw!=null?a.nw:p.nw,nh:a.nh!=null?a.nh:p.nh});
      });
      (S.lines||[]).forEach(function(l){
        ["x1","y1","x2","y2"].forEach(function(k){ if(!Number.isFinite(l[k])){ l[k]=0.5; fixed++; } });
        if(l.pts&&l.pts.some(function(q){ return !Number.isFinite(q[0])||!Number.isFinite(q[1]); })){
          l.pts=l.pts.filter(function(q){ return Number.isFinite(q[0])&&Number.isFinite(q[1]); }); fixed++;
        }
      });
      if(fixed)try{ MIU_GUARD.handle("model","repaired "+fixed+" non-numeric coordinate(s)",null,"layout"); }catch(e){}
    }catch(e){}
  }
  ["layoutAnnos","drawAllLines"].forEach(function(name){
    var f=window[name];
    if(typeof f!=="function")return;
    var w=function(){ heal(); return f.apply(this,arguments); };
    try{ window[name]=w; }catch(e){}
  });


  /* ---- 4. v63 — THE KEYBOARD BELONGS TO THE DOCUMENT UNLESS SOMETHING IS BEING TYPED ------------
     Ced: "please reinforce the shortcuts and make sure they work 100% all the time. this is
     frustrating for the end user if they cannot use the tool as intended."
     6js made a press on anything that is not a field hand the keyboard back. What was still losing it,
     each measured in test/keys.py:
       a. A slider, a colour well or a checkbox counted as "being typed in" — `_typingTarget` asked
          only whether the focus was an INPUT. Drag the weight slider in a tool's panel, press B: the
          B was swallowed with "the caret is in a field". Only fields that take TEXT hold the keys now.
       b. A focused field that is no longer on screen — the panel it was in closed, or it was hidden —
          kept holding them, with nothing visible to click out of. Focus on something invisible is let go.
       c. A ribbon BUTTON kept the focus after a click, so Space (hold to pan) or Enter pressed it again:
          pick Box, hold Space to pan, and Box was clicked a second time. Buttons, selects, sliders and
          the rest give the focus back once they have done their job.
       d. Opened inside claude.ai the tool is in a frame, and a frame hears no keys until it has the
          focus — the first shortcut after opening did nothing. It takes the focus once it is ready. */
  var TEXTY=/^(text|search|number|email|url|tel|password|date|time|datetime-local|month|week)$/i;
  function isTextField(el){
    if(!el||el===document.body)return false;
    if(el.isContentEditable)return true;
    if(el.tagName==="TEXTAREA")return !el.readOnly;
    if(el.tagName==="INPUT")return TEXTY.test(el.type||"text")&&!el.readOnly&&!el.disabled;
    return false;
  }
  function onScreen(el){
    try{ if(!el.isConnected)return false;
         var r=el.getClientRects(); if(!r||!r.length)return false;
         var cs=getComputedStyle(el); return cs.visibility!=="hidden"; }catch(e){ return true; }
  }
  /* the one answer every shortcut asks: is a person typing right now? */
  function typing(){
    var ae=document.activeElement;
    if(!ae||ae===document.body||ae===document.documentElement)return false;
    if(!isTextField(ae))return false;
    if(!onScreen(ae)){ try{ ae.blur(); }catch(e){} return false; }   /* b */
    return true;
  }
  try{
    window._typingTarget=function(){ return typing(); };
    var _edit0=window._editTarget;
    window._editTarget=function(){
      var ae=document.activeElement;
      if(ae&&ae.classList&&ae.classList.contains("ed"))return true;
      if(!typing()&&!(ae&&ae.tagName==="SELECT"&&onScreen(ae)))return false;
      return typeof _edit0==="function"?_edit0():false;
    };
  }catch(e){}
  /* c — give the focus back once a control has done its job; the keyboard user who TABBED to it is
     left alone, because only a pointer press or a finished change triggers this */
  function settle(el){
    if(!el||isTextField(el))return;
    if(el.closest&&el.closest("#dlg,.sb-ask,.uiask,.sk-edit"))return;    /* dialogs keep their keys */
    setTimeout(function(){ if(document.activeElement===el&&!isTextField(el)){ try{ el.blur(); }catch(e){} } },0);
  }
  document.addEventListener("click",function(e){
    if(e.detail===0)return;                                  /* a keyboard "click" — leave it */
    var t=e.target&&e.target.closest&&e.target.closest("button,[role=button],a");
    if(t)settle(t);           /* a <select> is settled on `change`, or its list would shut as it opens */
  },true);
  document.addEventListener("change",function(e){
    var t=e.target; if(t&&(t.tagName==="SELECT"||(t.tagName==="INPUT"&&!TEXTY.test(t.type||"text"))))settle(t);
  },true);
  document.addEventListener("pointerup",function(e){
    var t=e.target; if(t&&t.tagName==="INPUT"&&/^(range|color|checkbox|radio)$/i.test(t.type))settle(t);
  },true);
  /* and a key pressed while a button still has the focus: Space and Enter belong to the document's
     shortcuts (pan, finishing a run), not to re-pressing whatever was last clicked */
  document.addEventListener("keydown",function(e){
    var ae=document.activeElement;
    if(!ae||ae===document.body)return;
    if((e.key===" "||e.key==="Enter")&&(ae.tagName==="BUTTON"||(ae.getAttribute&&ae.getAttribute("role")==="button"))
       &&!(ae.closest&&ae.closest("#dlg,.sb-ask,.uiask,.sk-edit,#helpModal"))&&!e.repeat&&e._miuKb!==1){
      if(ae.matches&&ae.matches(":focus-visible"))return;      /* a keyboard user tabbed there on purpose */
      try{ ae.blur(); }catch(_){}
    }
  },true);
  /* d — inside a frame, take the keyboard once the tool is up (and again whenever the pointer comes
     back into it after the host page had it) */
  function grab(){ try{ if(window.top!==window&&!document.hasFocus())window.focus(); }catch(e){} }
  if(document.readyState==="complete")setTimeout(grab,300); else window.addEventListener("load",function(){ setTimeout(grab,300); });
  document.addEventListener("pointerdown",function(){ if(!document.hasFocus())grab(); },true);

  /* ---- 3. THE VERSION, WHERE SOMEONE ASKING FOR HELP CAN READ IT ------------------------------- */
  try{
    var h=document.querySelector("#helpModal .help-foot, #helpModal footer, #helpModal");
    if(h&&!h.querySelector(".miu-ver")){
      var v=document.createElement("div"); v.className="miu-ver";
      v.textContent="Mark It Up "+MIU_VERSION;
      h.appendChild(v);
    }
    /* v66 — and which way the PDF engine is running, because that decides how the tool feels: in its
       own worker the hand never waits on a page render; on the page's thread it can. Read when Help
       is opened, since the worker is started after this runs. */
    var say=function(){
      try{ var vv=document.querySelector("#helpModal .miu-ver");
           if(vv)vv.textContent="Mark It Up "+MIU_VERSION+" · PDF engine: "+
             (window.__miuRealWorker?"its own worker":"the page's thread (this host does not allow a worker)"); }catch(e){}
    };
    document.addEventListener("click",function(e){ if(e.target&&e.target.closest&&e.target.closest("#helpBtn"))say(); },true);
    document.addEventListener("keydown",function(e){ if(e.key==="?")say(); },true);
  }catch(e){}
})();
