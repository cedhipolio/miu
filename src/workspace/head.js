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
#modeTabs{position:fixed;z-index:62;box-sizing:border-box;pointer-events:none;display:flex;gap:8px;align-items:center;overflow-x:auto;overflow-y:hidden;
  scrollbar-width:none}
#modeTabs::-webkit-scrollbar{display:none}
#modeTabs>*{pointer-events:auto}
/* v87 — the bars that dock at the foot of the window rise clear of the tab strip instead of covering it:
   the selection bar (selbar), the page pager, toasts and the notices */
html.ws-tabs .selbar{bottom:calc(var(--ws-lift,0px) + 2px)!important}
html.ws-tabs #pagerBar{bottom:var(--ws-lift,12px)!important}
html.ws-tabs .toast{bottom:calc(var(--ws-lift,0px) + 8px)!important}
html.ws-tabs #miuNotice,html.ws-tabs #miuPrevNote,html.ws-tabs #miuEditNote{bottom:calc(var(--ws-lift,0px) + 12px)!important}
#modeTabs .mtab{display:inline-flex;align-items:center;gap:7px;cursor:pointer;white-space:nowrap;min-width:0;
  flex:0 1 auto;transition:color .15s,opacity .15s;position:relative}
#modeTabs .mtab i{flex:none;width:12px;height:12px;background:currentColor;-webkit-mask:center/contain no-repeat;mask:center/contain no-repeat}
#modeTabs .mtab[data-tool="miu"] i{-webkit-mask-image:url("${ICO.miu}");mask-image:url("${ICO.miu}")}
#modeTabs .mtab[data-tool="rfds"] i{-webkit-mask-image:url("${ICO.rfds}");mask-image:url("${ICO.rfds}")}
#modeTabs .mtab b{font:inherit;overflow:hidden;text-overflow:ellipsis;max-width:240px;min-width:0}
#modeTabs .mtab .mx{flex:none;width:16px;height:16px;margin-right:-5px;border-radius:999px;display:inline-grid;
  place-items:center;font:700 13px/1 system-ui,sans-serif;opacity:.55;text-transform:none}
#modeTabs .mtab .mx:hover{opacity:1;background:color-mix(in srgb,currentColor 16%,transparent)}
#modeTabs .mtab:not(.on){opacity:.72}
#modeTabs .mtab:not(.on):hover{opacity:1}
/* v86 — Ced: "change the tone of the colors of tabs to make miu and rfds distinguishable on files".
   Each tool has its own tone: Mark It Up's red (the Redline red, #fa3237) and the RFDS blue (the blue
   of the RFDS mark). A tab is washed with its tone over the log pill's own surface (set in stripInto,
   so it holds on every theme), its mark is drawn in it, and the tab you are in is ringed in it. */
/* v87 — Ced: "match the colors of tabs to the theme. make them different shades but still the same
   color scheme." Both tones now come from the theme's own accent: Mark It Up wears the accent itself,
   RFDS a shade of it drawn toward the theme's ink (lighter on night, deeper on day) — one family on every
   palette and in day and night, still two clearly different tabs. */
/* Ced, after: "the miu is a darker shade and rfds is lighter in tabs" — so, on every palette and in both
   modes, Mark It Up is the accent taken DOWN and RFDS the accent taken UP. */
#modeTabs .mtab[data-tool="miu"],#modeMenu button[data-tool="miu"]{--tone:color-mix(in srgb, var(--accent) 72%, #000)}
#modeTabs .mtab[data-tool="rfds"],#modeMenu button[data-tool="rfds"]{--tone:color-mix(in srgb, var(--accent) 58%, #fff)}
#modeTabs .mtab[data-tool] i{background:var(--tone)}
@keyframes wsTabIn{from{opacity:0;transform:translateY(8px) scale(.9)}to{opacity:1;transform:none}}
@keyframes wsTabOut{to{opacity:0;transform:translateY(6px) scale(.9);max-width:0;padding-left:0;padding-right:0;margin-right:-8px}}
#modeTabs .mtab.enter{animation:wsTabIn .24s cubic-bezier(.2,.9,.3,1.2) both}
#modeTabs .mtab.leave{animation:wsTabOut .17s ease-in both;pointer-events:none}
@media (prefers-reduced-motion:reduce){#modeTabs .mtab.enter,#modeTabs .mtab.leave{animation:none}}
#modeTabs .mtab.on{outline:1.5px solid var(--tone,var(--accent));outline-offset:-1.5px;color:var(--ink)!important}
#modeMenu button[data-tool] i{background:var(--tone)}
#modeTabs .mtab.mplus{justify-content:center;flex:none}
#modeTabs .mtab.mplus b{font-size:15px;line-height:1;max-width:none}
#modeMenu{position:fixed;z-index:4450;display:flex;flex-direction:column;gap:2px;padding:5px;border-radius:12px;
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
const PARITY_CSS=`/* v99 — a selected RFDS mark wears Mark It Up's furniture; these keep it to the selected mark and
   draw the delete badge once (the RFDS build adds its own glyph as well as the button's text) */
.anno:not(.sel) > .mov,.anno:not(.sel) > .rot,.anno:not(.sel) > .lup,.anno:not(.sel) > .ldn,.anno:not(.sel) > .rz{display:none!important}
.anno:not(.sel) > .x{opacity:0!important;pointer-events:none!important}
.anno > .x::before{content:none!important}
.anno > .x{display:flex!important;align-items:center;justify-content:center;font-size:11px!important;line-height:1!important}
.annolayer,.annolayer-under{isolation:isolate}
/* v1.01 — the selected mark's handles, lifted over every redline (rfds-patches/layer-steps.js) */
.anno.miu-selmirror{position:absolute!important;z-index:100000!important;pointer-events:none!important;background:none!important;
  border:0!important;padding:0!important;margin:0!important;box-sizing:border-box!important;min-width:0!important;min-height:0!important}
.anno.miu-selmirror > *{pointer-events:auto}
.miu-selhost{position:absolute;z-index:100000;pointer-events:none;overflow:visible}
.anno.sel[data-mirrored]{box-shadow:none}
/* v95 — the layer icons, as in Mark It Up: round chevron = one step, double = all the way */
:root{--i-mb-boxlayer2:url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cdefs%3E%3Cmask id='m'%3E%3Crect width='24' height='24' fill='%23fff'/%3E%3Cpath d='M7.6 11.4L12 7L16.4 11.4M7.6 16.6L12 12.2L16.4 16.6' fill='none' stroke='%23000' stroke-width='2.3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/mask%3E%3C/defs%3E%3Ccircle cx='12' cy='12' r='11.2' mask='url(%23m)'/%3E%3C/svg%3E")}
#annobar [data-lay="up"],#annobar [data-lay="down"]{--mb-i:var(--i-mb-boxlayer)}
#annobar [data-lay="front"],#annobar [data-lay="back"]{--mb-i:var(--i-mb-boxlayer2)}
#annobar [data-lay="up"]::before,#annobar [data-lay="down"]::before,#annobar [data-lay="front"]::before,#annobar [data-lay="back"]::before{width:17px;height:17px}
#annobar [data-lay="down"]::before,#annobar [data-lay="back"]::before{transform:rotate(180deg)}
body.railon #logBtn, html.nodoc #logBtn{left:84px}
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
let MIU_PANEL_CSS="", MIU_ALL_CSS="";
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
