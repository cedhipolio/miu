/* =====================================================================================================
   v81 — THE WORKSPACE: TABS, ANY NUMBER OF EACH TOOL. Ced: "can you make it possible to add more than 2
   tabs open? currently the tool only allows two (1 miu 1 rfds). make it possible to open multiple each
   tool".

   HOW IT IS BUILT
   Each tool holds one document — that is how both apps are written (one `S`, one page column) and it is
   not something to unpick. So every TAB is its own copy of a tool, in its own frame, and this page —
   the one the browser opened — becomes the WORKSPACE that holds them. It runs this script and nothing
   else: no stylesheet, no app.
     • A Mark It Up tab is this very document again (captured by the boot loader before anything ran,
       with the workspace and the RFDS blob taken out, and `__MIU_CHILD` set so it boots as the app).
     • An RFDS tab is the RFDS build carried in pk-rfds, exactly as v78.
   Both are same-origin frames, so this script reaches into them and does everything from outside — the
   MiU|RFDS switch, the logo switch, Shift+M, the tab strip, matching the look, lining the ribbons up.
   Neither app needs to know it is in a tab, so the RFDS build still drops in unchanged (embed_rfds.py).

   If the frames cannot be reached (a host that sandboxes without same-origin) the workspace stands
   down before showing anything and the page boots as a plain, single Mark It Up — never a blank page.
   ===================================================================================================== */
(function(){
"use strict";
const MODE_KEY="miu.appMode";
const ICO={
  miu:"data:image/png;base64,@@MIU_ICO@@",
  rfds:"data:image/png;base64,@@RFDS_ICO@@",
  swap:"data:image/png;base64,@@SWAP_ICO@@"
};
const PRE={miu:"ma",rfds:"rfds"}, THEME_K={miu:"ma_theme",rfds:"rfds_theme"};
const NAME={miu:"Mark It Up",rfds:"RFDS"};
const log=(...a)=>{ try{ console.info("[workspace]",...a); }catch(e){} };

/* ---- what goes into every tab --------------------------------------------------------------------- */
const CHILD_CSS=`@@CSS_PART@@
/* ---- tabs: the strip sits right of the log pill, each tab wearing the pill's own look -------------- */
#modeTabs{position:fixed;z-index:58;display:flex;gap:8px;align-items:center;overflow-x:auto;overflow-y:hidden;
  scrollbar-width:none}
#modeTabs::-webkit-scrollbar{display:none}
#modeTabs .mtab{display:inline-flex;align-items:center;gap:7px;cursor:pointer;white-space:nowrap;min-width:0;
  flex:0 1 auto;transition:color .15s,opacity .15s;position:relative}
#modeTabs .mtab i{flex:none;width:12px;height:12px;background:currentColor;-webkit-mask:center/contain no-repeat;mask:center/contain no-repeat}
#modeTabs .mtab[data-tool="miu"] i{-webkit-mask-image:url("${ICO.miu}");mask-image:url("${ICO.miu}")}
#modeTabs .mtab[data-tool="rfds"] i{-webkit-mask-image:url("${ICO.rfds}");mask-image:url("${ICO.rfds}")}
#modeTabs .mtab b{font:inherit;overflow:hidden;text-overflow:ellipsis;max-width:180px;min-width:0}
#modeTabs .mtab .mx{flex:none;width:16px;height:16px;margin-right:-5px;border-radius:999px;display:inline-grid;
  place-items:center;font:700 13px/1 system-ui,sans-serif;opacity:.55;text-transform:none}
#modeTabs .mtab .mx:hover{opacity:1;background:color-mix(in srgb,currentColor 16%,transparent)}
#modeTabs .mtab:not(.on){opacity:.72}
#modeTabs .mtab:not(.on):hover{opacity:1}
#modeTabs .mtab.on{outline:1.5px solid var(--accent);outline-offset:-1.5px;color:var(--ink)!important}
#modeTabs .mtab.mplus{justify-content:center;flex:none}
#modeTabs .mtab.mplus b{font-size:15px;line-height:1;max-width:none}
#modeMenu{position:fixed;z-index:4000;display:flex;flex-direction:column;gap:2px;padding:5px;border-radius:12px;
  background:var(--panel,#18191b);color:var(--ink,#e8e9ec);border:1px solid var(--line,#35373b);
  box-shadow:0 14px 40px rgba(0,0,0,.35);font:600 12.5px/1.2 var(--sans,system-ui,sans-serif);min-width:190px}
#modeMenu button{appearance:none;border:0;background:transparent;color:inherit;font:inherit;text-align:left;
  display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:8px;cursor:pointer}
#modeMenu button:hover,#modeMenu button:focus-visible{background:var(--panel2,#232427);outline:none}
#modeMenu button i{width:14px;height:14px;background:currentColor;-webkit-mask:center/contain no-repeat;mask:center/contain no-repeat}
#modeMenu button[data-tool="miu"] i{-webkit-mask-image:url("${ICO.miu}");mask-image:url("${ICO.miu}")}
#modeMenu button[data-tool="rfds"] i{-webkit-mask-image:url("${ICO.rfds}");mask-image:url("${ICO.rfds}")}
#modeMenu small{display:block;font-weight:500;opacity:.6;margin-top:2px}
`;
const PARITY_CSS=`body.railon #logBtn, html.nodoc #logBtn{left:84px}
body.railon #logPanel, html.nodoc #logPanel{left:84px}
/* v83 — Ced: "make the fonts on the ribbon similar as well." Mark It Up's face, everywhere in the tab: its
   --sans stack (Helvetica Neue first), and controls that inherit it as Mark It Up's do (6e — the RFDS
   build left buttons on the browser's own face). */
:root,:root.light{--sans:"Helvetica Neue",Helvetica,Arial,"Aptos Display","Aptos","Segoe UI Variable Display","Segoe UI",Roboto,sans-serif!important}
html,body{font-family:var(--sans)!important}
button,input,select,textarea,optgroup{font-family:inherit}
/* v83 — the RFDS build's own stamp popover is retired: Mark It Up's COP stamp card stands in for it */
#stampPanel{display:none!important}`;
/* Mark It Up's stamp card (#maPanel) — the RULES for it, lifted from Mark It Up's own stylesheet so the
   card in an RFDS tab is drawn by the very same CSS, filled in at start (see miuPanelCss) */
let MIU_PANEL_CSS="";
const RFDS_STAMP_JS=@@RFDS_STAMP_JS@@;
/* the workspace page itself: only the frames (and, until the first tab is up, the boot screen) */
const SHELL_CSS=`
html,body{overflow:hidden!important}
body>*:not(#wsHost):not(#boot){display:none!important}
#wsHost{position:fixed;inset:0;z-index:1;background:inherit}
#wsHost iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block;opacity:0;visibility:hidden;
  transition:opacity .34s ease}
#wsHost iframe.on{opacity:1;visibility:visible}
#wsHost iframe.leaving{visibility:visible}
#wsHost iframe.instant{transition:none}
@media (prefers-reduced-motion:reduce){#wsHost iframe{transition:none}}
`;
