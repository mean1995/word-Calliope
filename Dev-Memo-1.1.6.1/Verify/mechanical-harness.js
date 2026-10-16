/* ============================================================================
   Word Καλλιόπη 1.1.6.1 — mechanical harness (S05–S11)

   What it checks, black box:
     * the print-head state machine (R4 §1) as the <html data-print-head> attribute
     * the page-counter window (R4 §5) as the #page-counter text and <html data-page>, and its
       face (§5.9, VIC delivery 2026-10-16: Seven Segment / KalliopeCounter) as measured
       advances and ink boxes, canvas-measured in the browser, never read off the stylesheet
     * the sound policy (S01/S02/S04 + the §4.2 event table) by instrumenting the PLATFORM
       (HTMLMediaElement.prototype.play), not the app: the recorded file names say which of
       the four slots was asked for
     * the three feed paths (P01/P02/P12/D2) by watching .editor-flow's transform

   Usage:  NODE_PATH=/opt/homebrew/lib/node_modules node mechanical-harness.js
   Chromium is a harness; Safari stays the acceptance browser.
   ============================================================================ */
"use strict";

var path = require("path");
var fs = require("fs");
var chromium = require("playwright").chromium;

var ROOT = path.resolve(__dirname, "..", "..");
var URL = "file://" + path.join(ROOT, "index.html");
var EVIDENCE_DIR = path.join(ROOT, "Dev-Memo-1.1.6.1", "Evidence");

var ROW_PX = 16, SHEET_ROWS = 54;
var SLOT_FILE = { 0: "sound1.mp3", 1: "sound2.mp3", 2: "sound3.mp3", 3: "sound4.mp3" };

var results = [], problems = [];
function check(name, actual, expected) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name: name, ok: ok, actual: actual, expected: expected });
  if (!ok) problems.push(name + ": actual=" + JSON.stringify(actual) + " expected=" + JSON.stringify(expected));
}
function checkTrue(name, cond, detail) {
  results.push({ name: name, ok: !!cond, actual: detail, expected: "true" });
  if (!cond) problems.push(name + ": " + detail);
}

function state(page) {
  return page.evaluate(function () {
    var ta = document.querySelector("#editor");
    /* [feed ruling] the machine does not move - the SHEET does: the feed animation and the
       page-switch instant path are both observed on .paper's transform, not on the flow. */
    var paper = document.querySelector("#paper");
    var counter = document.querySelector("#page-counter");
    return {
      head: document.documentElement.getAttribute("data-print-head"),
      page: document.documentElement.getAttribute("data-page"),
      counter: counter ? counter.textContent : null,
      flowTransform: paper ? (paper.style.transform || "") : "",
      paperTransition: paper ? (paper.style.transition || "") : "",
      flowTop: paper ? (parseFloat(paper.style.transform ? paper.style.transform.replace(/[^-0-9.]/g, "") : 0) || 0) : 0,
      caret: ta ? ta.selectionStart : -1,
      len: ta ? ta.value.length : -1
    };
  });
}

function played(page) { return page.evaluate(function () { return window.__played.slice(); }); }
function clearPlayed(page) { return page.evaluate(function () { window.__played.length = 0; }); }

/* a document of n rows of 70 units, caret at a chosen end/position */
async function seed(page, rows, caretAtEnd) {
  await page.evaluate(function (a) {
    var ta = document.querySelector("#editor");
    var line = "ABCDEFGHIJ".repeat(7);
    var out = [];
    for (var i = 0; i < a.rows; i++) out.push(line);
    ta.value = out.join("\n");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
    var at = a.end ? ta.value.length : 0;
    ta.setSelectionRange(at, at);
    ta.dispatchEvent(new Event("select", { bubbles: true }));
    ta.dispatchEvent(new Event("keyup", { bubbles: true }));
  }, { rows: rows, end: caretAtEnd !== false });
}

/* a synthetic-but-honest edit event pair, used where a real gesture is not available
   (paste, undo): the app classifies an edit by e.inputType, which is exactly what is set here */
async function syntheticEdit(page, inputType, data, mutate) {
  await page.evaluate(function (a) {
    var ta = document.querySelector("#editor");
    ta.focus();
    var be = new InputEvent("beforeinput", {
      inputType: a.type, data: a.data, bubbles: true, cancelable: true
    });
    ta.dispatchEvent(be);
    if (!be.defaultPrevented) {
      if (a.type === "insertFromPaste" || a.type === "insertText") {
        ta.setRangeText(a.data, ta.selectionStart, ta.selectionEnd, "end");
      } else if (a.type === "historyUndo" || a.type === "historyRedo") {
        /* the real engine would restore its own snapshot; for classification purposes the
           value only has to change the way an undo does - by an unknown amount */
        ta.value = ta.value.slice(0, Math.max(0, ta.value.length - 1));
      }
      ta.dispatchEvent(new InputEvent("input", { inputType: a.type, data: a.data, bubbles: true }));
    }
  }, { type: inputType, data: data });
}

(async function main() {
  var browser = null;
  try { browser = await chromium.launch({ channel: "chrome" }); }
  catch (e) { browser = await chromium.launch(); }
  var page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

  /* instrument the platform, before the app runs: every play() records which file it was */
  await page.addInitScript(function () {
    window.__played = [];
    var proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
    if (!proto) return;
    var orig = proto.play;
    proto.play = function () {
      try {
        var src = this.currentSrc || this.src || "";
        window.__played.push(src.split("/").pop());
      } catch (e) { /* recording must never break the app */ }
      return orig.apply(this, arguments);
    };
  });

  var pageErrors = [];
  var knownNoise = [];
  page.on("pageerror", function (e) { pageErrors.push(String(e)); });
  page.on("console", function (m) {
    if (m.type() !== "error") return;
    if (/assets\/audio|ERR_FAILED|Cross origin requests/.test(m.text())) { knownNoise.push(m.text()); return; }
    pageErrors.push("console: " + m.text());
  });

  await page.goto(URL);
  await page.waitForFunction(function () { return !!document.querySelector("#editor"); });

  /* the element audio route probes up to 2.5s per slot before it is usable */
  await page.waitForTimeout(3000);

  /* ---- M1 positive control: the sound route is alive ------------------------
     focus(), not click(): under the print-line anchor the textarea's box extends far below the
     clipped window, so an element-centre click lands outside the visible sheet. The typing
     below is a real, trusted keyboard gesture either way. */
  await page.focus("#editor");
  await page.keyboard.type("a");
  await page.waitForTimeout(120);
  var p = await played(page);
  check("M1 positive control: one character at the end plays sound1", p, [SLOT_FILE[0]]);

  /* ---- M2 space and return -------------------------------------------------- */
  await clearPlayed(page);
  await page.keyboard.type(" ");
  await page.waitForTimeout(120);
  check("M2 space plays sound2", await played(page), [SLOT_FILE[1]]);
  await clearPlayed(page);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(160);
  check("M2 Enter plays sound3 (same sheet)", await played(page), [SLOT_FILE[2]]);

  /* ---- M3 S02: navigation is silent ---------------------------------------- */
  await clearPlayed(page);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Home");
  await page.keyboard.press("End");
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageUp");
  await page.waitForTimeout(160);
  check("M3 arrows / Home / End / paging are silent", await played(page), []);

  /* ---- M4 the print head follows the LOCKED formula ------------------------- */
  /* "End" is the end of the current VISUAL LINE in a textarea, not of the document, so the
     caret is placed explicitly - the whole point of the formula is the document offset. */
  await page.evaluate(function () {
    var ta = document.querySelector("#editor");
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.waitForTimeout(60);
  check("M4 head is Active at the true document end", (await state(page)).head, "active");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(60);
  check("M4 head is Hidden one character back", (await state(page)).head, "hidden");
  await page.evaluate(function () {
    var ta = document.querySelector("#editor");
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.waitForTimeout(60);
  check("M4 head returns to Active at the end", (await state(page)).head, "active");

  /* a document ending in a newline: the caret before that \n is NOT the end (R4 §1.1) */
  await page.evaluate(function () {
    var ta = document.querySelector("#editor");
    ta.value = "one line\n";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
    ta.setSelectionRange(8, 8);                    /* before the trailing newline */
    ta.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.waitForTimeout(60);
  check("M4 caret before a trailing newline is Hidden", (await state(page)).head, "hidden");

  /* ---- M5 the counter window ------------------------------------------------ */
  await page.evaluate(function () {
    var ta = document.querySelector("#editor");
    ta.value = "";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
    ta.setSelectionRange(0, 0);
    ta.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.waitForTimeout(60);
  check("M5 blank document shows 01/01", (await state(page)).counter, "01/01");

  await seed(page, 200, true);
  await page.waitForTimeout(60);
  check("M5 200 rows is 4 sheets -> 04/04 at the end", (await state(page)).counter, "04/04");

  /* browsing shows the page of the top visible row (Y-5 provisional). 200 rows put the view
     at its clamp (row 146); 60 rows up is row 86, which is on sheet 2 of 4. */
  await page.evaluate(function () {
    for (var i = 0; i < 60; i++) {
      var ev = new WheelEvent("wheel", { deltaY: -16, deltaMode: 0, bubbles: true, cancelable: true });
      document.body.dispatchEvent(ev);
    }
  });
  await page.waitForTimeout(80);
  var browsedState = await state(page);
  /* With the paper model the sheet shown after 60 rows of browse is sheet 3 of 4 (viewRow 139),
     so AA follows the window: 03/04. */
  check("M5 browsing moves AA to the shown sheet", browsedState.counter, "03/04");
  check("M5 browsing does not move the caret", browsedState.caret, browsedState.len);

  /* HELP freezes both numbers (R4 §5.4) */
  await page.click("#btn-help");
  await page.waitForTimeout(80);
  check("M5 HELP keeps the frozen 03/04", (await state(page)).counter, "03/04");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
  check("M5 leaving HELP re-syncs the counter", (await state(page)).counter, "04/04");

  /* ---- M6 paste / undo are silent (S01/S02) -------------------------------- */
  await seed(page, 20, true);
  await page.waitForTimeout(60);
  await clearPlayed(page);
  await syntheticEdit(page, "insertFromPaste", "PASTED");
  await page.waitForTimeout(80);
  check("M6 paste is silent", await played(page), []);
  await clearPlayed(page);
  await syntheticEdit(page, "historyUndo", "");
  await page.waitForTimeout(80);
  check("M6 undo is silent", await played(page), []);

  /* ---- M7 typing back at the end is mechanical again ------------------------ */
  await clearPlayed(page);
  await page.keyboard.press("End");
  await page.keyboard.type("z");
  await page.waitForTimeout(120);
  check("M7 typing at the end sounds again after paste/undo", await played(page), [SLOT_FILE[0]]);

  /* ---- M8 history editing is silent ---------------------------------------- */
  await clearPlayed(page);
  await page.keyboard.press("Home");
  await page.keyboard.type("q");                    /* caret in the middle: history editing */
  await page.waitForTimeout(120);
  check("M8 typing away from the end is silent", await played(page), []);

  /* ---- M9 a real cross-page write plays sound4 ONLY (S04) ------------------- */
  /* 54 rows exactly, caret at the very end of the last row of sheet 1 */
  await seed(page, SHEET_ROWS, true);
  await page.waitForTimeout(60);
  check("M9 pre-condition: the document is exactly one sheet", (await state(page)).counter, "01/01");
  await clearPlayed(page);
  await page.keyboard.press("Enter");               /* row 53 -> row 54: into sheet 2 */
  await page.waitForTimeout(200);
  check("M9 crossing a sheet plays sound4 only", await played(page), [SLOT_FILE[3]]);
  check("M9 the counter follows into sheet 2", (await state(page)).counter, "02/02");
  /* the sheet always carries a feed offset now, so "no animation" is a transition state, not an
     empty transform (P02: instant, no paper-change animation) */
  check("M9 the page switch runs no animation (instant, P02)", (await state(page)).paperTransition, "none");

  /* ---- M10 the line feed animates only for a real forward break ------------- */
  await seed(page, 20, true);
  await page.waitForTimeout(60);
  await page.keyboard.press("Enter");
  var duringFeed = await page.evaluate(function () {
    var paper = document.querySelector("#paper");
    return { transform: paper.style.transform || "", transition: paper.style.transition || "" };
  });
  checkTrue("M10 a real forward break starts the feed animation",
            duringFeed.transform.indexOf("translateY") === 0 && duringFeed.transition.indexOf("transform") === 0,
            JSON.stringify(duringFeed));
  await page.waitForTimeout(200);
  check("M10 the feed settles: no transition left", (await state(page)).paperTransition, "none");

  await clearPlayed(page);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Backspace");           /* history edit: no feed, no sound */
  await page.waitForTimeout(150);
  var afterBackspace = await state(page);
  check("M10 Backspace away from the end is silent", await played(page), []);
  check("M10 Backspace away from the end does not feed", afterBackspace.paperTransition, "none");

  /* P01: a backspace at the end that crosses a line steps back instantly, silently */
  await page.keyboard.press("End");
  await clearPlayed(page);
  await page.keyboard.press("Backspace");           /* removes the newline: row back one */
  await page.waitForTimeout(150);
  var reverse = await state(page);
  checkTrue("M10 P01: the reverse step is silent", (await played(page)).length === 0, JSON.stringify(await played(page)));
  check("M10 P01: the reverse step leaves no animation", reverse.paperTransition, "none");

  /* ---- M11 output isolation ------------------------------------------------- */
  var isolation = await page.evaluate(function () {
    var root = document.getElementById("print-root");
    var ta = document.querySelector("#editor");
    return {
      printChildren: root.childNodes.length,
      textHasCounter: ta.value.indexOf("01/01") !== -1,
      counterInsideStage: !!document.querySelector(".stage #page-counter"),
      counterInsideWindow: !!document.querySelector("#sheet-window #page-counter"),
      headPointerEvents: getComputedStyle(document.getElementById("print-head")).pointerEvents,
      counterDisplay: getComputedStyle(document.getElementById("page-counter")).display,
      machineLayers: document.querySelectorAll(".machine-frame .machine-layer, .machine-frame .machine-front").length,
      machinePainted: getComputedStyle(document.querySelector(".machine-back")).display,
      layerPointerEvents: getComputedStyle(document.querySelector(".machine-front")).pointerEvents
    };
  });
  check("M11 the print DOM is still empty", isolation.printChildren, 0);
  check("M11 the counter text is not in the document", isolation.textHasCounter, false);
  check("M11 the counter lives inside .stage (print-isolated)", isolation.counterInsideStage, true);
  check("M11 the counter is NOT inside the editing window", isolation.counterInsideWindow, false);
  check("M11 the print head cannot receive pointer events", isolation.headPointerEvents, "none");
  /* 1.1.6.1 UI integration: the delivered artwork IS wired now (data-ui-art="ready"), so the
     counter and the machine layers must be painted - and must still be invisible to the document
     and to every output path. */
  check("M11 the counter is painted in the integrated build", isolation.counterDisplay, "block");
  checkTrue("M11 the machine layers are wired and painted",
            isolation.machineLayers === 2 && isolation.machinePainted === "block",
            JSON.stringify({ layers: isolation.machineLayers, painted: isolation.machinePainted }));
  check("M11 the machine art cannot receive pointer events", isolation.layerPointerEvents, "none");

  checkTrue("M11 no page errors", pageErrors.length === 0, JSON.stringify(pageErrors));

  /* ---- M12 the page-counter face (VIC delivery 2026-10-16) -----------------------------
     The delivered "7 Segment.ttf" (Seven Segment, Krafti Lab) is wired as @font-face
     "KalliopeCounter" and used by #page-counter alone. Everything below is measured from the
     browser, not read off the stylesheet. This face is PROPORTIONAL: "0" is 1028/2048 em but "1"
     is only 376/2048 em, against the fallback's uniform 0.5em - so the narrow "1" is the proof
     that the face and not the fallback is drawing, and the "/" must come from this face too
     (1110/2048 em, wider than the fallback's 0.5em) because it carries its own separator.
     --font-stack is asserted clean (§11.8). */
  var fontProbe = await page.evaluate(async function () {
    var rootCS = getComputedStyle(document.documentElement);
    var counter = document.querySelector("#page-counter");
    var cs = getComputedStyle(counter);
    var size = parseFloat(cs.fontSize);
    var out = {
      family: cs.fontFamily,
      size: size,
      stack: rootCS.getPropertyValue("--font-stack"),
      counterFont: rootCS.getPropertyValue("--counter-font"),
      boxW: parseFloat(rootCS.getPropertyValue("--counter-w")),
      boxH: parseFloat(rootCS.getPropertyValue("--counter-h")),
      loaded: false, check: false, error: null
    };
    try {
      var faces = await document.fonts.load(size + 'px "KalliopeCounter"', "0123456789ABE/");
      out.loaded = faces.length > 0;
      out.check = document.fonts.check(size + 'px "KalliopeCounter"');
    } catch (e) { out.error = String((e && e.message) || e); }

    var cv = document.createElement("canvas").getContext("2d");
    function adv(font, text) { cv.font = font; return cv.measureText(text).width; }
    function inkOf(font, text) {
      cv.font = font;
      var m = cv.measureText(text);
      return { w: m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
               h: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent };
    }
    var stack = size + 'px "KalliopeCounter", "KalliopeLatin", ui-monospace, monospace';
    var latin = size + 'px "KalliopeLatin"';
    out.digitStack = adv(stack, "0");
    out.digitLatin = adv(latin, "0");
    out.oneStack = adv(stack, "1");
    out.oneLatin = adv(latin, "1");
    out.slashStack = adv(stack, "/");
    out.slashLatin = adv(latin, "/");

    /* the ink of every value the counter can print, inside the declared r1 window. The artwork
       switch is what the UI-integration build sets; this probe turns it off again. */
    document.documentElement.setAttribute("data-ui-art", "ready");
    out.values = [];
    var samples = ["01/01", "04/04", "88/88", "99/99", "E1/E1"];
    for (var i = 0; i < samples.length; i++) {
      counter.textContent = samples[i];
      out.values.push({
        text: samples[i],
        boxW: counter.offsetWidth, boxH: counter.offsetHeight,
        inkW: inkOf(stack, samples[i]).w, inkH: inkOf(stack, samples[i]).h
      });
    }
    counter.textContent = document.documentElement.getAttribute("data-page") || "01/01";
    document.documentElement.removeAttribute("data-ui-art");
    out.displayAfter = getComputedStyle(counter).display;
    out.scrollY = window.scrollY;
    out.docScrollH = document.documentElement.scrollHeight;
    out.innerH = window.innerHeight;
    return out;
  });
  checkTrue("M12 the counter's face is the delivered KalliopeCounter",
            /^"?KalliopeCounter"?/.test(fontProbe.family.trim()), fontProbe.family);
  checkTrue("M12 the delivered face resolves locally over file:// (no network)",
            fontProbe.loaded && fontProbe.check,
            JSON.stringify({ loaded: fontProbe.loaded, check: fontProbe.check, error: fontProbe.error }));
  checkTrue("M12 the panel face is NOT in --font-stack (§11.8)",
            fontProbe.stack.indexOf("KalliopeCounter") === -1, fontProbe.stack);
  checkTrue("M12 the digits are drawn by Seven Segment (0 at 0.501953em, 1 at 0.183594em)",
            Math.abs(fontProbe.digitStack - 0.501953125 * fontProbe.size) < 0.05 &&
            Math.abs(fontProbe.oneStack - 0.18359375 * fontProbe.size) < 0.05 &&
            Math.abs(fontProbe.digitLatin - 0.5 * fontProbe.size) < 0.05 &&
            (fontProbe.oneLatin - fontProbe.oneStack) > 0.5,
            JSON.stringify({ zero: fontProbe.digitStack, one: fontProbe.oneStack,
                             latinZero: fontProbe.digitLatin, latinOne: fontProbe.oneLatin,
                             size: fontProbe.size }));
  checkTrue("M12 the '/' comes from the face itself (0.541992em, no fallback)",
            Math.abs(fontProbe.slashStack - 0.5419921875 * fontProbe.size) < 0.05 &&
            fontProbe.slashStack > fontProbe.slashLatin,
            JSON.stringify({ stack: fontProbe.slashStack, latin: fontProbe.slashLatin }));
  checkTrue("M12 every printable value's ink stays inside the r1 window",
            fontProbe.values.every(function (v) { return v.inkW <= v.boxW && v.inkH <= v.boxH; }),
            JSON.stringify(fontProbe.values));
  checkTrue("M12 the face's em box fits the declared window height at the declared size",
            fontProbe.size * 1.03857421875 <= fontProbe.boxH,
            JSON.stringify({ size: fontProbe.size, em: fontProbe.size * 1.03857421875,
                             boxH: fontProbe.boxH }));
  check("M12 the face probe leaves nothing painted", fontProbe.displayAfter, "none");
  check("M12 the face probe leaves the page unscrolled", fontProbe.scrollY, 0);
  check("M12 the face probe does not make the document scrollable", fontProbe.docScrollH, fontProbe.innerH);
  checkTrue("M12 no page errors during the face probe", pageErrors.length === 0, JSON.stringify(pageErrors));

  /* ---- M14 the delivered front layer vs the reading guard -------------------------------
     The front layer's OWN pixels are read back here (the PNG goes in as a data: URL so the canvas
     stays untainted on file://), mapped through the r1 contract, and compared with the sheet. It
     documents the delivered defect as a number and, more usefully, it says when the guard can go:
     while the raw art still paints on the sheet the guard MUST be on; once UI re-exports the front
     layer without the bail, the art paints 0 pixels on the sheet and this check demands that
     <html> carry data-machine-front="whole" instead of the three slices. */
  var frontArt = await page.evaluate(async function (dataUrl) {
    function load(src) {
      return new Promise(function (res, rej) {
        var i = new Image();
        i.onload = function () { res(i); };
        i.onerror = function () { rej(new Error("front layer did not load")); };
        i.src = src;
      });
    }
    var img = await load(dataUrl);
    var cv = document.createElement("canvas");
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    var cx = cv.getContext("2d");
    cx.drawImage(img, 0, 0);
    var d = cx.getImageData(0, 0, cv.width, cv.height).data;
    var S = 1230.2131979695432 / 2079, Y0 = 812.8005801305294, THROAT = 960;
    var L = 207.10659898477158, R = 1023.10659898477158;
    var out = { size: [cv.width, cv.height], overSheet: 0, firstRow: null, lastRow: null, band: {} };
    for (var y = 0; y < cv.height; y++) {
      var docY = Y0 + y * S;
      if (docY >= THROAT) continue;
      var c = 0;
      for (var x = 0; x < cv.width; x++) {
        var docX = x * S;
        if (docX < L || docX > R) continue;
        if (d[(y * cv.width + x) * 4 + 3] > 64) c++;
      }
      if (c) {
        var row = Math.floor((docY - 96) / 16);
        out.overSheet += c;
        out.band[row] = (out.band[row] || 0) + c;
        if (out.firstRow === null) out.firstRow = row;
        out.lastRow = row;
      }
    }
    var front = document.querySelector(".machine-front");
    var whole = front.querySelector(".guard-whole");
    out.mode = document.documentElement.getAttribute("data-machine-front");
    out.wholeDisplay = getComputedStyle(whole).display;
    out.slicesShown = [].slice.call(front.querySelectorAll(".machine-art")).filter(function (i) {
      return !i.classList.contains("guard-whole") && getComputedStyle(i).display !== "none";
    }).length;
    return out;
  }, "data:image/png;base64," + fs.readFileSync(path.join(ROOT, "assets", "machine", "machine-front.png")).toString("base64"));

  /* over the whole SHEET width the delivered art reaches rows 48..53 (the tower edges add a few
     pixels at 48/52/53); the bail itself is by far the biggest band and sits on row 50 */
  checkTrue("M14 the delivered front layer's own pixels still cover text (bail across row 50)",
            frontArt.overSheet > 0 && frontArt.firstRow <= 49 && frontArt.lastRow >= 51 &&
            (frontArt.band["50"] || 0) > 0.5 * frontArt.overSheet,
            JSON.stringify(frontArt));
  checkTrue("M14 the reading guard matches the art (on while the bail is there, off once UI moves it)",
            frontArt.overSheet > 0
              ? (frontArt.mode !== "whole" && frontArt.wholeDisplay === "none" && frontArt.slicesShown === 3)
              : (frontArt.mode === "whole" && frontArt.wholeDisplay === "block" && frontArt.slicesShown === 0),
            JSON.stringify({ overSheet: frontArt.overSheet, mode: frontArt.mode,
                             whole: frontArt.wholeDisplay, slices: frontArt.slicesShown }));

  await browser.close();

  var stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  var out = path.join(EVIDENCE_DIR, "1.1.6.1-mechanical-" + stamp + ".json");
  fs.writeFileSync(out, JSON.stringify({
    harness: "mechanical-harness.js",
    iteration: "1.1.6.1",
    scope: "S05 print head / S06 eligibility / S07 sound policy / S08 three feed paths / S09 P01 / S10 P02 / S11 counter / S11b counter face (Seven Segment)",
    browser: "Chromium (harness only)",
    url: URL,
    provisional: {
      "Y-1 Active needs the view on the caret page": true,
      "Y-2 Page Up/Down move the caret": true,
      "Y-4 overflow shows E1/E1": true,
      "Y-5 AA is the top visible row's page": true,
      "Y-6 selection-replace is not mechanical": false
    },
    passed: results.filter(function (r) { return r.ok; }).length,
    failed: problems.length,
    results: results,
    pageErrors: pageErrors,
    knownEnvironmentNoise: knownNoise
  }, null, 2));

  results.forEach(function (r) {
    console.log((r.ok ? "  PASS  " : "  FAIL  ") + r.name +
                (r.ok ? "" : "   actual=" + JSON.stringify(r.actual) + " expected=" + JSON.stringify(r.expected)));
  });
  console.log("\n" + (results.length - problems.length) + "/" + results.length + " passed");
  console.log("evidence: " + out);
  process.exit(problems.length ? 1 : 0);
})().catch(function (e) {
  console.error("harness error:", (e && e.stack) || e);
  process.exit(2);
});
