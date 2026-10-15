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

  /* ---- 3. THE VERSION, WHERE SOMEONE ASKING FOR HELP CAN READ IT ------------------------------- */
  try{
    var h=document.querySelector("#helpModal .help-foot, #helpModal footer, #helpModal");
    if(h&&!h.querySelector(".miu-ver")){
      var v=document.createElement("div"); v.className="miu-ver";
      v.textContent="Mark It Up "+MIU_VERSION;
      h.appendChild(v);
    }
  }catch(e){}
})();
