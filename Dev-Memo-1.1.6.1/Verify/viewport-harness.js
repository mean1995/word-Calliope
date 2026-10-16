/* ============================================================================
   Word Καλλιόπη 1.1.6.1 — viewport / paper-feed harness (S01–S04, VIC feed ruling)

   Black box on purpose: the app is an IIFE with no window export (R4 §8.2), so every assertion
   reads only what a browser can see. Two observable quantities:
     * .editor-flow top  -> which sheet's text the window holds  (page-aligned: -page * 864)
     * .paper transform  -> how far that sheet has come out of the machine
                            (FEED_ANCHOR_ROW - feed rows) * 16 = (53 - intra) * 16
   From those, viewRow = page * 54 + intra = the document row standing at the print line.

   Usage:  NODE_PATH=/opt/homebrew/lib/node_modules node viewport-harness.js
   Chromium is a HARNESS here; Safari stays the acceptance browser (1.1.5 §4.1).
   ============================================================================ */
"use strict";

var path = require("path");
var fs = require("fs");
var chromium = require("playwright").chromium;

var ROOT = path.resolve(__dirname, "..", "..");
var URL = "file://" + path.join(ROOT, "index.html");
var EVIDENCE_DIR = path.join(ROOT, "Dev-Memo-1.1.6.1", "Evidence");

var ROWS = 200;            /* 200 rows = 3 full sheets + 38 rows */
var SHEET_ROWS = 54;
var ROW_PX = 16;
var ANCHOR = 53;           /* printLineY 956 -> row 53 of 54 (r1 candidate contract) */

var results = [], problems = [];

function check(name, actual, expected) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name: name, ok: ok, actual: actual, expected: expected });
  if (!ok) problems.push(name + ": actual=" + JSON.stringify(actual) + " expected=" + JSON.stringify(expected));
  return ok;
}
function checkTrue(name, cond, detail) {
  results.push({ name: name, ok: !!cond, actual: detail, expected: "true" });
  if (!cond) problems.push(name + ": " + detail);
  return !!cond;
}

/* [1.1.6.1 UI integration] Machine geometry, in screen px, straight from the live tree: the frame
   box, the layer boxes, and - the point of the reading guard - whether any front slice paints
   inside the visible sheet. The slices are clipped with inset(); those insets are element-local
   CSS px, so they are scaled by the frame's own zoom before they are compared, and the sheet is
   pulled in by 2px so anti-aliasing on its own edge does not count as a hit. */
async function machineGeometry(page) {
  return page.evaluate(function () {
    var frame = document.getElementById("machine-frame");
    var sheet = document.getElementById("paper-clip");
    if (!frame || !sheet) return { missing: true };
    var fr = frame.getBoundingClientRect(), sr = sheet.getBoundingClientRect();
    var z = fr.width / 1230.2131979695432;
    var arts = [].slice.call(frame.querySelectorAll(".machine-art"));
    var hits = [];
    [].slice.call(frame.querySelectorAll(".machine-front .machine-art")).forEach(function (el, i) {
      var r = el.getBoundingClientRect();
      var nums = ((getComputedStyle(el).clipPath || "none").match(/-?[0-9.]+/g) || []).map(Number);
      if (nums.length !== 4) return;
      var top = r.top + nums[0] * z, right = r.right - nums[1] * z;
      var bottom = r.bottom - nums[2] * z, left = r.left + nums[3] * z;
      var sx0 = sr.left + 2, sy0 = sr.top + 2, sx1 = sr.right - 2, sy1 = sr.bottom - 2;
      if (left < sx1 && right > sx0 && top < sy1 && bottom > sy0) {
        hits.push({ slice: i, box: [Math.round(left), Math.round(top), Math.round(right), Math.round(bottom)] });
      }
    });
    return {
      frame: { left: fr.left, top: fr.top, width: fr.width, height: fr.height },
      sheet: { left: sr.left, top: sr.top, right: sr.right, bottom: sr.bottom },
      backDisplay: getComputedStyle(frame.querySelector(".machine-back")).display,
      frontDisplay: getComputedStyle(frame.querySelector(".machine-front")).display,
      layersLoaded: arts.filter(function (i) { return i.complete && i.naturalWidth > 0; }).length,
      sheetHits: hits,
      oldChrome: document.querySelectorAll(".rail-mark,.type-line,.machine-slot,.caret-mask").length,
      scrollY: window.scrollY,
      scrollH: document.documentElement.scrollHeight,
      innerH: window.innerHeight
    };
  });
}


function snapshot(page) {
  return page.evaluate(function (a) {
    function cs(sel) { var e = document.querySelector(sel); return e ? getComputedStyle(e) : null; }
    var flow = cs(".editor-flow");
    var paper = document.querySelector("#paper");
    var clip = document.querySelector("#paper-clip");
    var ta = document.querySelector("#editor");
    var rail = cs("#rail-left");
    var typeLine = cs("#type-line");
    var win = document.querySelector("#sheet-window");
    var flowTop = flow ? (parseFloat(flow.top) || 0) : 0;
    var feed = 0;
    var m = /translateY\(([-0-9.]+)px\)/.exec(paper ? (paper.style.transform || "") : "");
    if (m) feed = parseFloat(m[1]);
    var pageSheet = Math.round(-flowTop / (a.sheet * a.row));
    var intra = Math.round((a.anchor * a.row - feed) / a.row);
    return {
      build: document.documentElement.getAttribute("data-build"),
      flowTop: flowTop,
      feedPx: feed,
      pageSheet: pageSheet,
      intra: intra,
      viewRow: pageSheet * a.sheet + intra,
      clipTransform: clip ? (clip.style.transform || "") : "",
      paperTransform: paper ? (paper.style.transform || "") : "",
      caret: ta ? ta.selectionStart : -1,
      len: ta ? ta.value.length : -1,
      taScrollTop: ta ? ta.scrollTop : -1,
      winScrollTop: win ? win.scrollTop : -1,
      paperScrollTop: paper ? paper.scrollTop : -1,
      windowScrollY: window.scrollY,
      railDisplay: rail ? rail.display : "?",
      typeLineDisplay: typeLine ? typeLine.display : "?",
      printRootChildren: (document.getElementById("print-root") || { childNodes: [] }).childNodes.length
    };
  }, { sheet: SHEET_ROWS, row: ROW_PX, anchor: ANCHOR });
}

async function seed(page, rows) {
  await page.evaluate(function (n) {
    var ta = document.querySelector("#editor");
    /* a real user reaches the text through a click or a key, and both end a browse window (D-1).
       The synthetic seed does neither, so it does the same thing explicitly - otherwise the
       caret-follow assertions below would measure the wheel's suppression instead of the rule. */
    document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    var line = "ABCDEFGHIJ".repeat(7);           /* 70 units: one visual row */
    var text = [];
    for (var i = 0; i < n; i++) text.push(line);
    text = text.join("\n");
    ta.value = text;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
    ta.setSelectionRange(text.length, text.length);
    ta.dispatchEvent(new Event("select", { bubbles: true }));
    ta.dispatchEvent(new Event("keyup", { bubbles: true }));
  }, rows);
}

function wheel(page, dy) {
  return page.evaluate(function (d) {
    var ev = new WheelEvent("wheel", { deltaY: d, deltaMode: 0, bubbles: true, cancelable: true });
    var target = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2) || document.body;
    target.dispatchEvent(ev);
  }, dy);
}

(async function main() {
  var browser = null;
  try { browser = await chromium.launch({ channel: "chrome" }); }
  catch (launchErr) { browser = await chromium.launch(); }
  var page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  var pageErrors = [], knownNoise = [];
  page.on("pageerror", function (e) { pageErrors.push(String(e)); });
  page.on("console", function (m) {
    if (m.type() !== "error") return;
    var text = m.text();
    /* Known and harmless under file:// in Chromium: the WebAudio route cannot fetch the sound
       files, the app falls back to the element route and stays silent (§25). Not a regression. */
    if (/assets\/audio|ERR_FAILED|Cross origin requests/.test(text)) { knownNoise.push(text); return; }
    pageErrors.push("console: " + text);
  });

  await page.goto(URL);
  await page.waitForFunction(function () {
    return !!document.querySelector("#editor") &&
           document.documentElement.getAttribute("data-build") !== null;
  });

  /* ---- T1 boot: a fresh sheet, only the top margin out ---------------------- */
  var s = await snapshot(page);
  check("T1 build marker is 1.1.6.1", s.build, "1.1.6.1");
  check("T1 an empty document holds sheet 1 at its first row", s.viewRow, 0);
  check("T1 the sheet is 53 rows inside the machine (only the top margin is out)",
        s.feedPx, ANCHOR * ROW_PX);
  check("T1 no native scroll anywhere (editor)", s.taScrollTop, 0);
  check("T1 no native scroll anywhere (page)", s.windowScrollY, 0);

  /* ---- T1b the feed rule on a short document ------------------------------- */
  await seed(page, 10);
  s = await snapshot(page);
  check("T1b a 10-row document has fed its 10th row to the print line", s.viewRow, 9);
  check("T1b its sheet stands (53-9) rows inside the machine", s.feedPx, (ANCHOR - 9) * ROW_PX);
  await seed(page, 60);
  s = await snapshot(page);
  check("T1b a 60-row document is on sheet 2", s.pageSheet, 1);
  check("T1b with its 6th row at the print line", s.viewRow, 59);

  /* ---- T2 a long document: the view follows the caret ----------------------- */
  await seed(page, ROWS);
  s = await snapshot(page);
  check("T2 the caret's row stands at the print line", s.viewRow, ROWS - 1);
  check("T2 the caret is untouched by seeding", s.caret, s.len);

  /* ---- T3 the wheel browses without moving the caret ------------------------ */
  var before = await snapshot(page);
  await wheel(page, -5 * ROW_PX);
  var after = await snapshot(page);
  check("T3 the wheel feeds the sheet back 5 rows", after.viewRow, before.viewRow - 5);
  check("T3 the wheel does not move the caret", after.caret, before.caret);
  check("T3 the wheel does not scroll the page", after.windowScrollY, 0);
  check("T3 the wheel does not scroll the editor", after.taScrollTop, 0);

  /* ---- T4 browse immunity (D-1) --------------------------------------------- */
  await page.evaluate(function () {
    var ta = document.querySelector("#editor");
    ta.dispatchEvent(new Event("keyup", { bubbles: true }));
    ta.dispatchEvent(new Event("select", { bubbles: true }));
  });
  var afterFollow = await snapshot(page);
  check("T4 keyup/select after a wheel do not pull the sheet back", afterFollow.viewRow, after.viewRow);

  /* ---- T5 clamping and sheet crossing --------------------------------------- */
  var sheetBefore = afterFollow.pageSheet;
  await wheel(page, -1000 * ROW_PX);
  s = await snapshot(page);
  check("T5 the view stops at the first row of the document", s.viewRow, 0);
  await wheel(page, 1000 * ROW_PX);
  s = await snapshot(page);
  check("T5 the view stops at the last row of the document", s.viewRow, ROWS - 1);
  await wheel(page, -60 * ROW_PX);
  s = await snapshot(page);
  checkTrue("T5 browsing across a boundary shows another sheet", s.pageSheet !== sheetBefore,
            "sheet " + sheetBefore + " -> " + s.pageSheet);

  /* ---- T6 page boundary: a new sheet, not a sliding window ------------------ */
  await seed(page, ROWS);
  await page.evaluate(function () {                       /* row 53 = the last row of sheet 1 */
    var ta = document.querySelector("#editor");
    var at = 53 * 71;                                     /* 71 chars per row incl. newline */
    ta.setSelectionRange(at, at);
    ta.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.waitForTimeout(60);
  var atBoundary = await snapshot(page);
  check("T6 at the last row of a sheet the whole writing area is out", atBoundary.feedPx, 0);
  await page.keyboard.press("ArrowDown");                 /* -> row 54: sheet 2, first row */
  await page.waitForTimeout(60);
  var overBoundary = await snapshot(page);
  check("T6 crossing into sheet 2 shows sheet 2's text", overBoundary.pageSheet, 1);
  check("T6 the new sheet starts with its first row at the print line", overBoundary.viewRow, 54);
  check("T6 the new sheet is 53 rows inside the machine again",
        overBoundary.feedPx, ANCHOR * ROW_PX);

  /* ---- T7 line granularity and remainder carry ------------------------------ */
  await seed(page, ROWS);
  await wheel(page, -10 * ROW_PX);
  before = await snapshot(page);
  await wheel(page, ROW_PX / 2);
  var half = await snapshot(page);
  check("T7 half a row does not move the sheet", half.viewRow, before.viewRow);
  await wheel(page, ROW_PX / 2);
  var whole = await snapshot(page);
  check("T7 the carried remainder completes exactly one row", whole.viewRow, before.viewRow + 1);

  /* ---- T8 the input moment returns the caret's row to the print line --------- */
  await wheel(page, -40 * ROW_PX);
  var browsed = await snapshot(page);
  checkTrue("T8 pre-condition: browsing moved the sheet off the caret",
            browsed.viewRow !== ROWS - 1, "viewRow=" + browsed.viewRow);
  var lenBefore = browsed.len;
  await page.keyboard.type("X");
  var typed = await snapshot(page);
  check("T8 the first input returns the caret's row to the print line", typed.viewRow, ROWS - 1);
  check("T8 the character landed at the caret", typed.caret, lenBefore + 1);
  check("T8 the document grew by exactly one character", typed.len, lenBefore + 1);

  /* ---- T9 the machine stays on the machine (V25: the old rail/badge chrome is retired) ----
     The delivered machine layers ride the machine FRAME, not the sheet: they must not move when the
     paper feeds or when the reader browses, and none of them may sit on the visible sheet. */
  await seed(page, 20);
  var machineA = await machineGeometry(page);
  await wheel(page, -10 * ROW_PX);                        /* browse away from the caret */
  var machineB = await machineGeometry(page);
  check("T9 the old rail / type-line / badge chrome is gone (V25)", machineA.oldChrome, 0);
  checkTrue("T9 the machine layers are painted with the delivered art",
            machineA.backDisplay === "block" && machineA.frontDisplay === "block" && machineA.layersLoaded === 5,
            JSON.stringify(machineA));
  checkTrue("T9 the machine stays put while the reader browses",
            Math.abs(machineA.frame.left - machineB.frame.left) < 0.5 &&
            Math.abs(machineA.frame.top - machineB.frame.top) < 0.5,
            JSON.stringify({ a: machineA.frame, b: machineB.frame }));
  checkTrue("T9 no machine layer is drawn on the visible sheet",
            machineA.sheetHits.length === 0, JSON.stringify(machineA.sheetHits));

  /* ---- T10 output isolation -------------------------------------------------- */
  await seed(page, ROWS);
  s = await snapshot(page);
  check("T10 the print DOM is untouched", s.printRootChildren, 0);
  check("T10 editor scrollTop stayed 0", s.taScrollTop, 0);
  check("T10 sheet-window scrollTop stayed 0", s.winScrollTop, 0);
  check("T10 paper scrollTop stayed 0", s.paperScrollTop, 0);
  check("T10 window scrollY stayed 0", s.windowScrollY, 0);
  checkTrue("T10 no page errors", pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();

  var stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  var out = path.join(EVIDENCE_DIR, "1.1.6.1-viewport-" + stamp + ".json");
  fs.writeFileSync(out, JSON.stringify({
    harness: "viewport-harness.js",
    iteration: "1.1.6.1",
    scope: "S01 viewport model / S02 wheel / S03 browse immunity / S04 input moment / paper feed (VIC ruling)",
    feedModel: "paper moves, machine fixed: flow = the sheet's own text (page aligned), .paper = feed translate (53 - intra) * 16, throat clip at --paper-throat 960",
    browser: "Chromium (harness only - Safari is the acceptance browser)",
    url: URL,
    documentRows: ROWS,
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
