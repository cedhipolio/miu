const out={};
maLoadPrefs(); MA_PREFS.org="ONTEL"; MA_PREFS.ta="CED"; MA_PREFS.date="09/15/2026"; maSavePrefs();
out.stamped=maStampAll("all");
/* the pages whose /Rotate is not zero show up as landscape once pdf.js has turned them */
out.sizes=S.pages.map((p,i)=>({i,w:Math.round(p.w1),h:Math.round(p.h1)})).filter(z=>z.w>z.h);
const rot=out.sizes.length?out.sizes[0].i:-1;
out.rotIdx=rot;
if(rot>=0){ MA_CALLOUT_TEXT="TEST CALLOUT"; maPlaceCallout(rot,0.30,0.40); }
await exportPdf();
return JSON.stringify(out);
