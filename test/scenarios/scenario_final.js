maLoadPrefs(); MA_PREFS.org="TSC CONSTRUCTION, LLC"; MA_PREFS.ta="EDEN TA"; maSavePrefs();
maStampAll("all");
MA_CALLOUT_TEXT="New Sector Frame\nMFR: Sabre\nPart# C10841002C\n(1) per sector";
maPlaceCallout(2,0.55,0.45);
maNoteOnPages("ACTUAL INSTALL: TRIAD MOUNT WITH STEALTH SHROUD",[2],0.10,0.88);
maPanelOpen(true); maSetTab("parts");
gotoPageInstant(2);
return "ok";
