# Changelog (rebuilt repo — v78 onward; earlier history lives in the project notes vNN-notes.md)

## 85.0.0
- RFDS tabs no longer pop "Saved — now add the stamp" after an export: stamping is done on the card before saving.

## 84.0.0
- RFDS stamp card drawn with Mark It Up's palette variables (copied per tab, only those the RFDS build lacks): on every theme other than Ontel the card had no background and the page showed through.
- No more self-scrolling: tabs re-align only on structural changes (document, ribbon side/fold, page list, theme, window size), and every tab's scroll position is restored after a re-align.
- Repository rebuilt from the v84 build.

## 83.0.0
- RFDS tabs use Mark It Up's COP stamp card and process (injected `rfds_stamp.js`, Mark It Up's own CSS rules).
- RFDS stamp red = Mark It Up red #fa3237 (embed_rfds.py PATCHES).
- Ribbon font: Mark It Up's --sans stack in RFDS tabs; page view and two-up mirrored across tabs.

## 82.0.0
- RFDS groups packed evenly (Redline tools centred, no empty seats); resize bug (tall ribbon) fixed; re-align when a tab changes.

## 81.0.0
- The workspace: any number of Mark It Up and RFDS tabs, each in its own frame; + menu; × close; Home resets only its own tab; falls back to a single Mark It Up if frames are unreachable.

## 80.0.0
- Nothing moves when switching tools (ribbon groups, tools, rail, log pill, drop zone, page aligned); file tabs beside the Log pill.

## 79.0.0
- Theme-inked switch icons; cross-fade; logo hover switch; shared theme and ribbon preferences.

## 78.0.0
- RFDS mode: the RFDS Redlining Tool embedded whole (pk-rfds), switch beside day/night; `embed_rfds.py`.
