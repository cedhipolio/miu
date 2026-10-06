const out={annos:S.annos.length,lines:S.lines.length,site:S.siteCode,pages:S.pages.length};
maLoadPrefs(); MA_PREFS.org="ONTEL"; MA_PREFS.ta="CED"; maSavePrefs();
out.stamped=maStampAll("range","1-3");
await exportPdf();
return JSON.stringify(out);
