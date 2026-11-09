/* v81 — the MiU|RFDS switch is driven by the workspace (pk-ws) from outside each tab. A Mark It Up
   running on its own (the workspace could not start here, or a suite asked for `__MIU_SINGLE`) has
   nothing to switch to, so the switch is taken out of the ribbon and the quick bar altogether — a
   button that does nothing is what tools.py's "every ribbon button is wired" audit exists to catch. */
(function(){ if(window.__MIU_CHILD)return;
  ["modeBtn","miniMode"].forEach(id=>{ const b=document.getElementById(id); if(b)b.remove(); }); })();
