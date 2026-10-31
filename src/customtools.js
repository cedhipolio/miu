/* ==================================================================================================
   customtools.js — v61. YOUR OWN COPIES OF A TOOL.

   Ced: "add a feature of adding a tool on the ribbon where the user will be able to add a copy of the
   existing tools so the settings can be different each tool."

   Every tool already keeps its own look (MA_TOOL_STYLES[tool]) — colour, weight, font, endings — so a
   second Box that draws in blue next to the red one is a second KEY in that table, a button that picks
   the Box tool up with that key in force, and nothing else. Concretely:

     · "My tools" is a ribbon group after Redline tools: the copies, then a + that adds one.
     · + opens a menu of the tools that draw. Picking one makes "Box 2" (renamable), whose style
       starts as a copy of Box's current style and from then on is its own.
     · A copy's button draws with the original's gesture and the copy's style. Its ▾ (or a right-
       click) opens the same properties panel the original has, editing the copy. Right-click also
       offers Rename and Remove.
     · Copies and their styles live in this browser, like the tools' own styles do.

   The mechanism is three small hooks, all here, so the rest of the tool does not know copies exist:
   MA_TOOL_DEFAULTS / TP_SPEC / MODE_NAMES learn each copy's id; `maToolOf` answers the copy's id while
   it is in the hand; and `setMode` puts the copy down whenever any other tool is picked up.
   ================================================================================================== */
(function(){
  "use strict";
  if(typeof MA_TOOL_DEFAULTS==="undefined"||typeof TP_SPEC==="undefined"||typeof setMode!=="function")return;
  var KEY="ma.customtools.v1";
  var LIST=[];            /* [{id, base, name}] */
  var ACTIVE=null;        /* the copy in the hand, or null */
  var _activating=false;

  function load(){
    try{ LIST=JSON.parse(localStorage.getItem(KEY)||"[]")||[]; }catch(e){ LIST=[]; }
    if(!Array.isArray(LIST))LIST=[];
    LIST=LIST.filter(function(t){ return t&&t.id&&t.base&&MA_TOOL_DEFAULTS[t.base]&&TP_SPEC[t.base]; });
  }
  function save(){ try{ localStorage.setItem(KEY,JSON.stringify(LIST)); }catch(e){} }
  function find(id){ for(var i=0;i<LIST.length;i++)if(LIST[i].id===id)return LIST[i]; return null; }

  function register(t){
    MA_TOOL_DEFAULTS[t.id]=Object.assign({},MA_TOOL_DEFAULTS[t.base]);
    TP_SPEC[t.id]=Object.assign({},TP_SPEC[t.base],{title:t.name});
    try{ MODE_NAMES[t.id]=t.name; }catch(e){}
    if(!MA_TOOL_STYLES[t.id]){
      /* maLoadToolStyles ran before this file, when it did not know the copy's key — read it back */
      var stored=null;
      try{ var raw=localStorage.getItem(MA_STYLE_KEY); if(raw)stored=(JSON.parse(raw)||{})[t.id]; }catch(e){}
      MA_TOOL_STYLES[t.id]=Object.assign({},MA_TOOL_STYLES[t.base]||MA_TOOL_DEFAULTS[t.base],stored||{});
    }
  }

  /* ---- the hooks ---------------------------------------------------------------------------- */
  var _toolOf=maToolOf;
  window.maToolOf=function(mode){
    if(ACTIVE&&!(typeof MA_TOOL_OVERRIDE!=="undefined"&&MA_TOOL_OVERRIDE)){
      var t=find(ACTIVE);
      /* v62 — only the CURRENT tool ("which style do I draw with?", asked with no mode) is the copy.
         A question that names the base — Box's own ▾, Box's own panel — is about Box. v61 answered
         the copy for both, so Box's panel opened while "Box 2" was in the hand edited Box 2, and the
         two seemed to share one set of properties (Ced: "my tools and regular tools should not share
         the same properties at once"). */
      if(t&&!mode&&S.mode===t.base)return t.id;
    }
    return _toolOf(mode);
  };
  var _setMode=setMode;
  window.setMode=function(m){
    if(!_activating&&ACTIVE){ ACTIVE=null; }
    var r=_setMode.apply(this,arguments);
    paint();
    return r;
  };

  /* Opening a REGULAR tool's panel while a copy is in the hand puts the copy down and picks that tool
     up — the ▾ has always meant "this tool" (6fd) — so the panel, the ribbon fields and the next mark
     all agree on which tool's properties are in play. */
  if(typeof tpOpen==="function"){
    var _tpOpen=tpOpen;
    window.tpOpen=function(tool,anchor,forSelection){
      if(ACTIVE&&!forSelection&&tool&&tool!=="defaults"&&!find(tool)){ try{ setMode(tool); }catch(e){} }
      return _tpOpen.apply(this,arguments);
    };
  }

  function pick(id){
    var t=find(id); if(!t)return;
    _activating=true;
    try{ setMode(t.base); }finally{ _activating=false; }
    ACTIVE=t.id;
    try{ maShowToolStyle(t.id); }catch(e){}
    try{ selectAnno(null); selectLine(null); }catch(e){}
    document.querySelectorAll("#tools .tool.active").forEach(function(b){ b.classList.remove("active"); });
    try{ var mp=document.getElementById("modePill"); if(mp)mp.textContent=t.name; }catch(e){}
    paint();
    try{ setStatus(t.name+" — draws like "+(MODE_NAMES[t.base]||t.base)+", with its own settings."); }catch(e){}
  }

  /* ---- the ribbon group ---------------------------------------------------------------------- */
  var grp=null, row=null, addBtn=null;
  function ensureGroup(){
    if(grp&&document.body.contains(grp))return;
    var tools=document.getElementById("tools"); if(!tools)return;
    grp=document.createElement("div");
    grp.className="grp ct-grp"; grp.id="ctools"; grp.setAttribute("data-lbl","My tools");
    row=document.createElement("div"); row.className="grow";
    grp.appendChild(row);
    tools.parentNode.insertBefore(grp,tools.nextSibling);
    var sep=tools.nextElementSibling&&tools.nextElementSibling!==grp?null:null;
    addBtn=document.createElement("button");
    addBtn.type="button"; addBtn.className="btn ct-add";
    addBtn.title="Add a copy of a tool with its own settings — a second Box in blue, a thick Line, a Text in another font";
    addBtn.setAttribute("aria-label","Add a tool");
    addBtn.textContent="+";
    addBtn.onclick=function(e){ e.stopPropagation(); menu(addBtn, baseItems()); };
    row.appendChild(addBtn);
    /* v74 — Ced: "a default settings configuration for ALL properties in all tools, in one tab".
       The ⚙ beside + opens it; nothing changes until its Apply is pressed. */
    var defBtn=document.createElement("button");
    defBtn.type="button"; defBtn.className="btn ct-def";
    defBtn.title="Default properties — set colour, width, fill and text once and apply them to every tool that has them";
    defBtn.setAttribute("aria-label","Default properties");
    defBtn.textContent="\u2699";
    defBtn.onclick=function(e){ e.stopPropagation(); try{ var pp=document.getElementById("toolpop");
      if(pp&&!pp.hasAttribute("hidden")&&TP_TOOL==="defaults")tpClose(); else tpOpenDefaults(defBtn); }catch(_){} };
    row.appendChild(defBtn);
  }

  function shapeOf(base){
    try{ if(MODE_SHAPES[base])return "var("+MODE_SHAPES[base]+")"; }catch(e){}
    return null;
  }

  function paint(){
    ensureGroup(); if(!row)return;
    [].slice.call(row.querySelectorAll(".ct-tool")).forEach(function(b){ b.remove(); });
    LIST.forEach(function(t,i){
      var b=document.createElement("button");
      b.type="button"; b.className="tool ct-tool hascaret"; b.dataset.ct=t.id;
      b.title=t.name+" — a copy of "+(MODE_NAMES[t.base]||t.base)+" with its own settings · ▾ or right-click for its properties, rename, remove";
      b.setAttribute("aria-label",t.name);
      var shp=shapeOf(t.base);
      if(shp){ b.classList.add("ico","icoimg"); b.style.setProperty("--gi",shp); }
      else { b.classList.add("ico"); try{ b.style.setProperty("--g",'"'+(MODE_ICONS[t.base]||"•")+'"'); }catch(e){} }
      b.appendChild(document.createTextNode(t.name));
      /* v62 — no number badge: Ced, "remove the numbering, it is unnecessary" */
      /* the swatch: what this copy draws in */
      var st=MA_TOOL_STYLES[t.id]||{};
      b.style.setProperty("--ct-col",st.col||"#fa3237");
      var c=document.createElement("span"); c.className="tcaret"; c.textContent="▾"; c.setAttribute("role","button");
      c.title=t.name+" properties";
      c.addEventListener("pointerdown",function(e){ e.preventDefault(); e.stopPropagation(); });
      c.addEventListener("click",function(e){ e.preventDefault(); e.stopPropagation(); pick(t.id); try{ tpToggle(t.id,b); }catch(_){} });
      b.appendChild(c);
      /* v62 — Ced: "have the option to remove tools in my tools." A small red ✕ in the button's
         corner on hover (the same red disc a selected mark wears), as well as the right-click menu
         and the + menu's Remove list. */
      var x=document.createElement("span"); x.className="ct-x"; x.textContent="\u2715"; x.setAttribute("role","button");
      x.title="Remove "+t.name; x.setAttribute("aria-label","Remove "+t.name);
      x.addEventListener("pointerdown",function(e){ e.preventDefault(); e.stopPropagation(); });
      x.addEventListener("click",function(e){ e.preventDefault(); e.stopPropagation(); confirmRemove(t); });
      b.appendChild(x);
      b.onclick=function(){ pick(t.id); };
      b.addEventListener("contextmenu",function(e){ e.preventDefault();
        menu(b,[
          {label:"Properties…", run:function(){ pick(t.id); try{ tpOpen(t.id,b); }catch(_){} }},
          {label:"Rename…", run:function(){ rename(t); }},
          {label:"Remove", danger:true, run:function(){ confirmRemove(t); }}
        ]); });
      b.classList.toggle("active",ACTIVE===t.id);
      row.insertBefore(b,addBtn);
    });
  }

  function baseItems(){
    var names={redline:1,text:1,fix:1,callout:1,strikerow:1,cross:1,line:1,arrow:1,dim:1,poly:1,box:1,circle:1,crossout:1};
    var out=[{head:"Add a copy of…"}];
    document.querySelectorAll("#tools .tool[data-mode]").forEach(function(b){
      var m=b.dataset.mode; if(!names[m]||!TP_SPEC[m])return;
      out.push({label:(MODE_NAMES[m]||TP_SPEC[m].title||m), run:function(){ add(m); }});
    });
    if(LIST.length){
      out.push({head:"Remove"});
      LIST.forEach(function(t){ out.push({label:"Remove "+t.name, danger:true, run:function(){ confirmRemove(t); }}); });
    }
    return out;
  }

  async function confirmRemove(t){
    var ok=true;
    try{ if(typeof uiConfirm==="function")ok=(await uiConfirm({title:"Remove \u201c"+t.name+"\u201d?",
      message:"It leaves My tools and its settings go with it. Marks already drawn with it stay as they are.",
      buttons:[{id:"no",label:"Keep it"},{id:"yes",label:"Remove",danger:true,primary:true}]}))==="yes"; }catch(e){ ok=true; }
    if(ok)remove(t);
  }

  function add(base){
    var n=1+LIST.filter(function(t){ return t.base===base; }).length;
    var t={id:"ct-"+base+"-"+Date.now().toString(36), base:base, name:(MODE_NAMES[base]||base)+" "+(n+1)};
    LIST.push(t); register(t);
    MA_TOOL_STYLES[t.id]=Object.assign({},MA_TOOL_STYLES[base]||MA_TOOL_DEFAULTS[base]);
    try{ maSaveToolStyles(); }catch(e){}
    save(); paint(); pick(t.id);
    try{ tpOpen(t.id,row.querySelector('.ct-tool[data-ct="'+t.id+'"]')); }catch(e){}
    try{ setStatus(t.name+" added — set its colours and sizes in the panel; they stay with this copy."); }catch(e){}
  }

  async function rename(t){
    var v=null;
    try{ v=(typeof sbAsk==="function")?await sbAsk({title:"Rename tool", value:t.name, placeholder:"Blue box", ok:"Rename"}):null; }catch(e){}
    if(!v)return;
    t.name=String(v).trim().slice(0,32)||t.name;
    TP_SPEC[t.id].title=t.name; try{ MODE_NAMES[t.id]=t.name; }catch(e){}
    save(); paint();
  }
  function remove(t){
    if(ACTIVE===t.id){ ACTIVE=null; try{ setMode(t.base); }catch(e){} }
    LIST=LIST.filter(function(x){ return x.id!==t.id; });
    try{ delete MA_TOOL_STYLES[t.id]; maSaveToolStyles(); }catch(e){}
    save(); paint();
    try{ setStatus(t.name+" removed."); }catch(e){}
  }

  /* one small menu in the app's own menu style */
  function menu(anchor,items){
    document.querySelectorAll(".ct-menu").forEach(function(n){ n.remove(); });
    var m=document.createElement("div"); m.className="sb-menu ct-menu";
    items.forEach(function(it){
      if(it.head){ var h=document.createElement("div"); h.className="sb-mh"; h.textContent=it.head; m.appendChild(h); return; }
      var b=document.createElement("button"); b.type="button"; b.className="sb-mi"+(it.danger?" ct-danger":"");
      b.textContent=it.label; b.onclick=function(e){ e.stopPropagation(); m.remove(); it.run(); };
      m.appendChild(b);
    });
    document.body.appendChild(m);
    var r=anchor.getBoundingClientRect();
    m.style.position="fixed"; m.style.zIndex="5000";
    m.style.left=Math.max(8,Math.min(innerWidth-m.offsetWidth-8,r.left))+"px";
    m.style.top=Math.max(8,Math.min(innerHeight-m.offsetHeight-8,r.bottom+6))+"px";
    var away=function(e){ if(!m.contains(e.target)){ m.remove(); document.removeEventListener("pointerdown",away,true); } };
    setTimeout(function(){ document.addEventListener("pointerdown",away,true); },0);
  }

  load(); LIST.forEach(register);
  var start=function(){ try{ paint(); }catch(e){ try{ LOG("custom tools: "+(e&&e.message||e)); }catch(_){} } };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start); else setTimeout(start,0);
  /* the swatch follows the copy's colour as its panel changes it */
  document.addEventListener("input",function(e){ if(ACTIVE&&e.target&&/^c_/.test(e.target.id||""))setTimeout(paint,0); },true);

  window.MIU_CUSTOM_TOOLS={ list:function(){ return LIST.slice(); }, active:function(){ return ACTIVE; }, add:add, pick:pick, remove:function(id){ var t=find(id); if(t)remove(t); }, confirmRemove:function(id){ var t=find(id); if(t)return confirmRemove(t); } };
})();
