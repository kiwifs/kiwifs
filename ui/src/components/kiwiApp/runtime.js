/*
 * The `kiwi` object inside a sandboxed kiwi-app. Plain ES5: it is injected as
 * text ahead of the author's code, so it must parse in whatever the author's
 * page expects and cannot rely on a bundler.
 *
 * Every message either way is { source: "kiwi-app", v: 1, type, ... }. The
 * host owns the step clock; the app only asks (next, prev, seek, reset) and is
 * told (steps:set), so shared clocks, deep links and blocked steps behave as
 * they do for every other widget.
 */
(function () {
  if (window.kiwi) return;
  var V = 1;
  var parentWin = window.parent;
  var standalone = parentWin === window;
  var themeListeners = [];
  var stepsCfg = null;
  var stepIndex = 0;

  function post(type, data) {
    if (standalone) return;
    var msg = { source: "kiwi-app", v: V, type: type };
    if (data) for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) msg[k] = data[k];
    parentWin.postMessage(msg, "*");
  }

  // The root's box, not its scrollHeight: the root's scrollHeight never drops
  // below the iframe's own height, so the frame could grow but never shrink.
  // The body's scrollHeight catches `html, body { height: 100% }`, where the
  // root box is pinned to the iframe and content overflows it. In quirks mode
  // body.scrollHeight is the viewport's, so it is left out there.
  function height() {
    var h = document.documentElement.getBoundingClientRect().height;
    var body = document.body;
    if (body && document.compatMode !== "BackCompat") {
      var cs = window.getComputedStyle(body);
      var content = body.scrollHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
      if (content > h) h = content;
    }
    return Math.ceil(h);
  }

  function isArray(x) {
    return Object.prototype.toString.call(x) === "[object Array]";
  }

  var lastHeight = -1;
  function resize() {
    var h = height();
    if (h === lastHeight) return;
    lastHeight = h;
    post("resize", { height: h });
  }

  // The variables go into the injected <style data-kiwi-theme>, not onto
  // <html style>: inline style would beat an author's own `:root` overrides.
  function applyTheme(vars, dark, quiet) {
    var css = ":root {\n";
    for (var name in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, name)) css += "  " + name + ": " + vars[name] + ";\n";
    }
    css += "  color-scheme: " + (dark ? "dark" : "light") + ";\n}";
    // At boot the runtime runs before the injected <style> is parsed, which
    // already carries the same values.
    if (!quiet) {
      var el = document.querySelector("style[data-kiwi-theme]");
      if (!el) {
        el = document.createElement("style");
        el.setAttribute("data-kiwi-theme", "");
        (document.head || document.documentElement).appendChild(el);
      }
      el.textContent = css;
    }
    var cls = document.documentElement.classList;
    if (dark) cls.add("dark");
    else cls.remove("dark");
    kiwi.theme = { vars: vars, dark: !!dark };
    if (quiet) return;
    for (var i = 0; i < themeListeners.length; i++) {
      try { themeListeners[i](kiwi.theme); } catch (e) { if (window.console) console.error(e); }
    }
  }

  function setStep(i) {
    if (!stepsCfg) return;
    var max = stepsCfg.count - 1;
    stepIndex = i < 0 ? 0 : i > max ? max : i;
    kiwi.step = stepIndex;
    if (typeof stepsCfg.onStep === "function") stepsCfg.onStep(stepIndex);
  }

  // With no host (the file opened on its own) the app still steps.
  function intent(action, index) {
    if (!stepsCfg) return;
    if (standalone) {
      if (action === "next") setStep(stepIndex + 1);
      else if (action === "prev") setStep(stepIndex - 1);
      else if (action === "seek") setStep(index);
      else if (action === "reset") setStep(0);
      return;
    }
    post("steps:" + action, action === "seek" ? { index: index } : null);
  }

  var kiwi = {
    v: V,
    theme: { vars: {}, dark: false },
    step: 0,
    resize: resize,
    onTheme: function (fn) {
      themeListeners.push(fn);
      return function () {
        var at = themeListeners.indexOf(fn);
        if (at >= 0) themeListeners.splice(at, 1);
      };
    },
    steps: function (cfg) {
      var count = Math.max(1, Math.floor(Number(cfg && cfg.count) || 1));
      stepsCfg = { count: count, onStep: cfg && cfg.onStep };
      post("steps:register", {
        count: count,
        labels: cfg && isArray(cfg.labels) ? cfg.labels.slice(0, count).map(String) : null,
        durations: cfg && isArray(cfg.durations) ? cfg.durations.slice(0, count) : null
      });
      // Under a host the first step comes back as steps:set; rendering step 0
      // here would flash it ahead of a deep-linked step.
      if (standalone) setStep(Math.min(stepIndex, count - 1));
      else kiwi.step = stepIndex = Math.min(stepIndex, count - 1);
    },
    next: function () { intent("next"); },
    prev: function () { intent("prev"); },
    seek: function (i) { intent("seek", Math.floor(Number(i) || 0)); },
    reset: function () { intent("reset"); },
    play: function () { intent("play"); },
    pause: function () { intent("pause"); },
    ready: function () { post("ready"); resize(); }
    // kiwi.query / kiwi.read are reserved for the read-only data bridge.
  };
  window.kiwi = kiwi;

  var boot = window.__kiwiBoot;
  try { delete window.__kiwiBoot; } catch (e) { window.__kiwiBoot = undefined; }
  if (boot && boot.vars) applyTheme(boot.vars, boot.dark, true);

  window.addEventListener("message", function (e) {
    if (e.source !== parentWin) return;
    var d = e.data;
    if (!d || d.source !== "kiwi-app" || d.v !== V) return;
    if (d.type === "theme") applyTheme(d.vars || {}, d.dark);
    else if (d.type === "steps:set" && typeof d.index === "number" && isFinite(d.index)) setStep(Math.floor(d.index));
  });

  // Keys pressed in here never reach the host page, so the playback keys are
  // forwarded — but only once there is something to step. Keep in step with
  // PLAYBACK_KEYS in widgets/usePlayback.ts.
  var KEYS = { " ": 1, ArrowRight: 1, ArrowLeft: 1, Home: 1, End: 1, r: 1 };
  document.addEventListener("keydown", function (e) {
    if (!stepsCfg || standalone || !KEYS[e.key] || e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    var tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
    if (e.key === " " && (tag === "BUTTON" || tag === "A" || tag === "SUMMARY")) return;
    e.preventDefault();
    post("key", { key: e.key });
  });

  function observe() {
    if (typeof ResizeObserver !== "undefined") {
      var ro = new ResizeObserver(resize);
      ro.observe(document.documentElement);
      if (document.body) ro.observe(document.body);
    }
    resize();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observe);
  else observe();
  window.addEventListener("load", resize);
})();
