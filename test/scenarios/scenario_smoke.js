const out={tabs:{}};
maPanelOpen(true);
["notes","parts","markups","import"].forEach(t=>{
  try{ maSetTab(t); out.tabs[t]=document.querySelectorAll("#maBody *").length>0; }
  catch(e){ out.tabs[t]="ERR: "+e.message; }
});
try{ maOpenReport(); out.report=(document.getElementById("reportBody")||{}).textContent.slice(0,60); }catch(e){ out.report="ERR "+e.message; }
try{ maAnalyzeOpen(); out.analyze=!!MA_TABLE; maAnalyzeClose(); }catch(e){ out.analyze="ERR "+e.message; }
out.ribbon=[...document.querySelectorAll("#tools .tool")].map(b=>b.dataset.mode);
out.style=["c_text","c_sw","c_bg","c_fill","c_fop","c_font","c_pt"].map(id=>!!document.getElementById(id));
out.noStamp=!document.getElementById("stampBtn")&&typeof maStampAll==="undefined";
return JSON.stringify(out);
