/* Probe: the page-counter face (VIC delivery 2026-10-16, "7 Segment.ttf" -> KalliopeCounter).

   Read-only measurement, no source change. It answers four questions with numbers instead of
   assumptions, and leaves both a JSON report and a screenshot behind:
     1. does the stylesheet face really resolve over file:// (a local parse, no network)?
     2. is the 7-Segment face actually the one drawing the digits (advance 0.46875em) while
        KalliopeLatin draws the "/" the face does not contain (advance 0.5em)?
     3. does the five-cell "AA/BB" ink stay inside the declared r1 window (97.63596809282089 x
        26.627991298042062 document px)?
     4. what does the window look like once the UI-integration build sets data-ui-art="ready"?

   Usage: NODE_PATH=/opt/homebrew/lib/node_modules node probe-counter-font.js
   Chromium is a harness; Safari stays the acceptance browser. */
"use strict";
var path = require("path");
var fs = require("fs");
var chromium = require("playwright").chromium;

var ROOT = path.resolve(__dirname, "..", "..");
var URL = "file://" + path.join(ROOT, "index.html");
var EVIDENCE_DIR = path.join(ROOT, "Dev-Memo-1.1.6.1", "Evidence");
var SAMPLES = ["01/01", "04/04", "88/88", "99/99", "E1/E1", "AA/BB"];

(async function () {
  var browser = null;
  try { browser = await chromium.launch({ channel: "chrome" }); }
  catch (e) { browser = await chromium.launch(); }
  var page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  var pageErrors = [];
  page.on("pageerror", function (e) { pageErrors.push(String(e)); });
  page.on("console", function (m) {
    if (m.type() === "error" && !/assets\/audio|ERR_FAILED|Cross origin requests/.test(m.text())) {
      pageErrors.push("console: " + m.text());
    }
  });

  await page.goto(URL);
  await page.waitForFunction(function () { return !!document.querySelector("#editor"); });
  await page.waitForTimeout(1500);

  var report = await page.evaluate(async function (samples) {
    /* --- 0. the contract, read from the live stylesheet -------------------------------- */
    var rootCS = getComputedStyle(document.documentElement);
    var counter = document.querySelector("#page-counter");
    var cs = getComputedStyle(counter);
    var contract = {
      counterFont: rootCS.getPropertyValue("--counter-font").trim(),
      counterFontSize: rootCS.getPropertyValue("--counter-font-size").trim(),
      counterW: parseFloat(rootCS.getPropertyValue("--counter-w")),
      counterH: parseFloat(rootCS.getPropertyValue("--counter-h")),
      fontStack: rootCS.getPropertyValue("--font-stack").trim(),
      computedFamily: cs.fontFamily,
      computedSize: parseFloat(cs.fontSize),
      letterSpacing: cs.letterSpacing,
      display: cs.display
    };

    /* --- 1. does the delivered file resolve and parse in this browser? ----------------- */
    /* explicit, observable proof: a FontFace built from the URL the stylesheet names. A WOFF1
       file over file:// that the engine could not parse would reject here. */
    var direct = { url: "assets/fonts/font-counter.ttf", loaded: false, error: null };
    try {
      var ff = new FontFace("ProbeDeliveredCounter", 'url("assets/fonts/font-counter.ttf")');
      var face = await ff.load();
      document.fonts.add(face);
      direct.loaded = true;
      direct.family = face.family;
      direct.status = face.status;
    } catch (e) { direct.error = String(e && e.message || e); }

    /* the same file, reached through the @font-face rule the stylesheet declares */
    var viaCss = { requested: false, resolved: false, faces: 0, error: null };
    try {
      viaCss.requested = true;
      var loaded = await document.fonts.load(contract.computedSize + 'px "KalliopeCounter"', "0123456789ABE/");
      viaCss.faces = loaded.length;
      viaCss.resolved = document.fonts.check(contract.computedSize + 'px "KalliopeCounter"');
    } catch (e) { viaCss.error = String(e && e.message || e); }

    /* --- 2. advances: who draws what ------------------------------------------------ */
    var cv = document.createElement("canvas").getContext("2d");
    function adv(font, text) { cv.font = font; return cv.measureText(text).width; }
    function ink(font, text) {
      cv.font = font;
      var m = cv.measureText(text);
      return {
        width: m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
        height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
        advance: m.width,
        ascent: m.actualBoundingBoxAscent,
        descent: m.actualBoundingBoxDescent
      };
    }
    var SIZE = contract.computedSize;
    var stack = SIZE + 'px "KalliopeCounter", "KalliopeLatin", ui-monospace, monospace';
    var latin = SIZE + 'px "KalliopeLatin"';
    var delivered = SIZE + 'px "ProbeDeliveredCounter"';
    var metrics = {
      zero: { stack: adv(stack, "0"), latin: adv(latin, "0"), delivered: adv(delivered, "0") },
      one: { stack: adv(stack, "1"), latin: adv(latin, "1"), delivered: adv(delivered, "1") },
      slash: { stack: adv(stack, "/"), latin: adv(latin, "/"), delivered: adv(delivered, "/") },
      em: SIZE,
      expected: { digitEm: 1028 / 2048, oneEm: 376 / 2048, slashEm: 1110 / 2048 }
    };

    /* every code point the counter can ever print, with the face in front */
    var perChar = {};
    "0123456789ABCE/".split("").forEach(function (ch) {
      perChar[ch] = { stack: adv(stack, ch), latin: adv(latin, ch), delivered: adv(delivered, ch) };
    });

    /* --- 3. the ink box of the real element, with the artwork switch ON --------------- */
    /* data-ui-art="ready" is what the UI-integration build sets; without it the counter is
       display:none and has no layout box at all. The switch is turned back off before the
       probe ends so no evidence run leaves the app painted. */
    document.documentElement.setAttribute("data-ui-art", "ready");
    function frame() { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); }
    await frame();

    var geometry = [];
    for (var i = 0; i < samples.length; i++) {
      var text = samples[i];
      counter.textContent = text;
      await frame();
      document.documentElement.setAttribute("data-page", text);
      var box = counter.getBoundingClientRect();
      /* offsetWidth/Height are LAYOUT px, i.e. document px, before the zoom transform */
      geometry.push({
        text: text,
        layoutW: counter.offsetWidth,
        layoutH: counter.offsetHeight,
        screenW: box.width,
        screenH: box.height,
        rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
        ink: ink(stack, text),
        advance: adv(stack, text),
        digitInk: ink(stack, "0")
      });
    }

    /* --- 4. what the run looks like ------------------------------------------------- */
    counter.textContent = "04/04";
    await frame();
    var shot = counter.getBoundingClientRect();
    var painted = getComputedStyle(counter).display;

    var state = {
      dataUiArt: document.documentElement.getAttribute("data-ui-art"),
      dataPage: document.documentElement.getAttribute("data-page"),
      counterDisplayPainted: painted,
      scrollY: window.scrollY,
      docScrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight
    };
    document.documentElement.removeAttribute("data-ui-art");
    counter.textContent = "01/01";
    await frame();
    state.displayAfterProbe = getComputedStyle(counter).display;

    return {
      contract: contract, direct: direct, viaCss: viaCss, metrics: metrics,
      perChar: perChar, geometry: geometry, state: state,
      shot: { x: shot.left, y: shot.top, width: shot.width, height: shot.height }
    };
  }, SAMPLES);

  /* --- the picture: the machine window at FIT zoom, padded ------------------------- */
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  var pad = 26;
  var clip = {
    x: Math.max(0, report.shot.x - pad),
    y: Math.max(0, report.shot.y - pad),
    width: report.shot.width + pad * 2,
    height: report.shot.height + pad * 2
  };
  /* the switch is off again by now, so the picture needs it back on for one frame */
  await page.evaluate(function () {
    var c = document.querySelector("#page-counter");
    c.textContent = "04/04";
    document.documentElement.setAttribute("data-ui-art", "ready");
  });
  await page.waitForTimeout(120);
  var png = path.join(EVIDENCE_DIR, "1.1.6.1-counter-font.png");
  await page.screenshot({ path: png, clip: clip });
  await page.evaluate(function () {
    document.documentElement.removeAttribute("data-ui-art");
    document.querySelector("#page-counter").textContent = "01/01";
  });

  var out = {
    probe: "probe-counter-font.js",
    iteration: "1.1.6.1",
    scope: "the page-counter face delivered by VIC 2026-10-16 (7 Segment.ttf -> KalliopeCounter)",
    browser: "Chromium (harness only; Safari is the acceptance browser)",
    url: URL,
    screenshot: path.relative(ROOT, png),
    clip: clip,
    report: report,
    pageErrors: pageErrors
  };
  var json = path.join(EVIDENCE_DIR, "1.1.6.1-counter-font-" +
    new Date().toISOString().replace(/[:.]/g, "-") + ".json");
  fs.writeFileSync(json, JSON.stringify(out, null, 2));

  console.log("contract      :", report.contract.computedFamily, report.contract.computedSize + "px");
  console.log("--font-stack  :", report.contract.fontStack);
  console.log("direct load   :", JSON.stringify(report.direct));
  console.log("via @font-face:", JSON.stringify(report.viaCss));
  console.log("advance zero  : stack=" + report.metrics.zero.stack.toFixed(3) +
              "  latin=" + report.metrics.zero.latin.toFixed(3) +
              "  delivered=" + report.metrics.zero.delivered.toFixed(3));
  console.log("advance one   : stack=" + report.metrics.one.stack.toFixed(3) +
              "  latin=" + report.metrics.one.latin.toFixed(3) +
              "  delivered=" + report.metrics.one.delivered.toFixed(3) + "   (proportional face)");
  console.log("advance slash : stack=" + report.metrics.slash.stack.toFixed(3) +
              "  latin=" + report.metrics.slash.latin.toFixed(3) +
              "  delivered=" + report.metrics.slash.delivered.toFixed(3) +
              (report.metrics.slash.stack > report.metrics.slash.latin
                 ? "  (the face carries its own separator)" : ""));
  report.geometry.forEach(function (g) {
    console.log("  " + g.text + " : layout " + g.layoutW + "x" + g.layoutH +
                "  ink " + g.ink.width.toFixed(2) + "x" + g.ink.height.toFixed(2) +
                "  fits=" + ((g.ink.width <= g.layoutW && g.ink.height <= g.layoutH) ? "yes" : "NO"));
  });
  console.log("state         :", JSON.stringify(report.state));
  console.log("page errors   :", JSON.stringify(pageErrors));
  console.log("evidence      : " + json + "\n                " + png);

  await browser.close();
})().catch(function (e) { console.error("probe error:", (e && e.stack) || e); process.exit(2); });
