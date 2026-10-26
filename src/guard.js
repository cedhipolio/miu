/* ==================================================================================================
   guard.js — v60. THE TOOL'S SAFETY NET, LOADED BEFORE ANYTHING ELSE.

   Ced: "make this build much more stable. think of it as an actual tool that will be used by users
   across the company."

   Up to v59 a runtime error went to the status strip as "⚠ <message>" — which on the side ribbon is
   hidden — and to the activity log, which nobody opens until something is already wrong. For one
   person who knows the tool that was enough. For a company it is not: a user who hits an error needs
   to know (1) whether their work is safe, (2) what to do next, and (3) how to send someone the
   details without having to describe them.

   This file is first in the app blob so it is listening before fonts.js or app.js run a line. It:

     · catches every uncaught error and rejected promise, drops the known-harmless ones, and shows one
       calm, dismissable notice per distinct problem — never a stack of them;
     · forces the pending autosave through the moment something goes wrong, so the notice's promise
       that "your redlines are saved" is true when it is read;
     · keeps the last 40 problems in memory, and puts a ready-to-paste report (version, browser,
       document size, the problems, the tail of the activity log — never the document's contents) on
       the clipboard from the notice's "Copy details";
     · warns before the tab is closed while a save is still in flight;
     · offers `MIU_GUARD.safe(fn,label)` for the handful of entry points (open, export) that must
       never fail silently.
   ================================================================================================== */
var MIU_VERSION = "70.0.0";
var MIU_GUARD = (function () {
  "use strict";
  var errs = [];               /* the last 40, newest last */
  var shownAt = {};            /* message -> when it was last shown, so a loop cannot flood the screen */
  var box = null, hideT = null;

  /* Not every error is the user's problem. These are the browser's or a library's housekeeping and are
     recorded but never shown. */
  var BENIGN = [
    /ResizeObserver loop/i,                 /* a layout notice, not a failure */
    /RenderingCancelled/i,                  /* pdf.js cancelling a render we superseded — by design */
    /AbortError/i, /The operation was aborted/i,
    /^Script error\.?$/i,                   /* cross-origin script (an extension) with no details */
    /Worker was destroyed/i,                /* closing a document mid-render */
    /Transport destroyed/i
  ];
  function benign(msg) { for (var i = 0; i < BENIGN.length; i++) if (BENIGN[i].test(msg)) return true; return false; }

  function text(x) {
    if (!x) return "unknown error";
    if (typeof x === "string") return x;
    return (x.message || x.name || String(x)).slice(0, 400);
  }

  function record(kind, msg, stack, where) {
    errs.push({ t: new Date().toISOString(), kind: kind, msg: msg, where: where || "",
                stack: String(stack || "").split("\n").slice(0, 6).join("\n") });
    if (errs.length > 40) errs.shift();
    try { if (typeof LOG === "function") LOG("! " + kind + ": " + msg); } catch (e) {}
  }

  /* push the debounced autosave through now — the notice below says the work is saved */
  function flush() {
    try {
      if (typeof S !== "undefined" && S && S.doc && typeof autosave === "function") autosave(true);
    } catch (e) {}
  }

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  function notice(title, detail, tone) {
    try {
      if (!document.body) return;
      if (!box) {
        box = el("div", "ds-notice"); box.id = "miuNotice";
        box.setAttribute("role", "alert"); box.setAttribute("aria-live", "assertive");
        document.body.appendChild(box);
      }
      box.innerHTML = "";
      box.dataset.tone = tone || "bad";
      var ic = el("span", "ds-notice-ic", tone === "warn" ? "!" : "×");
      var body = el("div", "ds-notice-body");
      body.appendChild(el("b", null, title));
      if (detail) body.appendChild(el("span", null, detail));
      var acts = el("div", "ds-notice-acts");
      var cp = el("button", "ds-btn ds-btn-sm", "Copy details");
      cp.type = "button";
      cp.onclick = function () {
        copy(report()).then(function (ok) { cp.textContent = ok ? "Copied" : "Copy failed"; });
      };
      var x = el("button", "ds-btn ds-btn-sm ds-btn-ghost", "Dismiss");
      x.type = "button"; x.onclick = hide;
      acts.appendChild(cp); acts.appendChild(x);
      box.appendChild(ic); box.appendChild(body); box.appendChild(acts);
      box.classList.add("show");
      clearTimeout(hideT); hideT = setTimeout(hide, 12000);
    } catch (e) {}
  }
  function hide() { if (box) box.classList.remove("show"); }

  function copy(s) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText)
        return navigator.clipboard.writeText(s).then(function () { return true; }, function () { return legacy(s); });
    } catch (e) {}
    return Promise.resolve(legacy(s));
  }
  function legacy(s) {
    try {
      var t = document.createElement("textarea"); t.value = s; t.style.cssText = "position:fixed;left:-9999px";
      document.body.appendChild(t); t.select(); var ok = document.execCommand("copy"); t.remove(); return ok;
    } catch (e) { return false; }
  }

  /* what a support message needs — and nothing from inside the document */
  function report() {
    var o = { tool: "Mark It Up", version: MIU_VERSION, when: new Date().toISOString(),
              browser: navigator.userAgent, screen: innerWidth + "x" + innerHeight + "@" + (devicePixelRatio || 1) };
    try {
      if (typeof S !== "undefined" && S) {
        o.document = S.doc ? { pages: (S.pages || []).length, marks: (S.annos || []).length,
                               strokes: (S.lines || []).length, mode: S.mode, zoom: S.scale } : null;
      }
    } catch (e) {}
    o.problems = errs.slice(-15);
    try {
      var lg = document.querySelectorAll("#logList li, .log-line, #log li");
      o.log = [].slice.call(lg, -25).map(function (n) { return n.textContent.slice(0, 200); });
    } catch (e) {}
    return JSON.stringify(o, null, 2);
  }

  function handle(kind, msg, stack, where) {
    if (benign(msg)) { record(kind + " (ignored)", msg, stack, where); return; }
    record(kind, msg, stack, where);
    flush();
    var now = Date.now();
    if (shownAt[msg] && now - shownAt[msg] < 20000) return;
    shownAt[msg] = now;
    var safe = (typeof S !== "undefined" && S && S.doc)
      ? "Your redlines are saved in this browser. You can keep working; if something looks wrong, reload and the work comes back."
      : "Nothing was lost. If it happens again, reload the page.";
    notice("Something went wrong" + (where ? " in " + where : ""), safe, "bad");
  }

  window.addEventListener("error", function (ev) {
    /* a failed <img>/<script> load fires here too, with no message — that is not a code error */
    if (!ev || (!ev.message && !ev.error)) return;
    handle("error", text(ev.error || ev.message), ev.error && ev.error.stack, "");
  });
  window.addEventListener("unhandledrejection", function (ev) {
    var r = ev && ev.reason;
    handle("promise", text(r), r && r.stack, "");
  });

  /* Closing the tab inside autosave's half-second debounce lost the last edit. Warn only then —
     a prompt on every close teaches people to click through it. */
  window.addEventListener("beforeunload", function (ev) {
    try {
      if (typeof S !== "undefined" && S && S.doc && S._savePending) {
        flush(); ev.preventDefault(); ev.returnValue = ""; return "";
      }
    } catch (e) {}
  });
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });

  /* run fn; if it throws or rejects, say so in words and keep the app alive */
  function safe(fn, where) {
    return function () {
      try {
        var r = fn.apply(this, arguments);
        if (r && typeof r.then === "function")
          return r.catch(function (e) { handle("error", text(e), e && e.stack, where); });
        return r;
      } catch (e) { handle("error", text(e), e && e.stack, where); }
    };
  }

  return { errors: errs, report: report, notice: notice, hide: hide, safe: safe, handle: handle, copy: copy };
})();
