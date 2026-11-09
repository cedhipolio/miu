
/* v81 — the MiU|RFDS switch is driven by the workspace (pk-ws) from outside each tab. A Mark It Up
   running on its own (the workspace could not start here) has nothing to switch to: hide it. */
(function(){ if(window.__MIU_CHILD)return;
  ["modeBtn","miniMode"].forEach(id=>{ const b=document.getElementById(id); if(b)b.style.display="none"; }); })();
