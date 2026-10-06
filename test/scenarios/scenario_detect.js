maLoadPrefs(); MA_PREFS.org="ONTEL"; MA_PREFS.ta="CED"; maSavePrefs();
const out={site:S.siteCode,why:S.siteWhy,pages:S.pages.length,file:outputFilename()};
out.stamped=maStampAll("all");
out.loading=maLoadingPages().map(p=>p+1);
return JSON.stringify(out);
