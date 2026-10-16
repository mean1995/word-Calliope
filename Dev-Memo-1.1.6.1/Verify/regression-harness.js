/* ============================================================================
   Word Καλλιόπη 1.1.6.1 — regression harness

   The 1.1.6.1 changes touch the caret, the view and the input path, so the achievements of
   1.1.5 / 1.1.5.1 / 1.1.5.2 have to be re-checked, not assumed. These are the R4 §7 matrix
   rows that can be checked without a real Safari, plus the protections the PM replies list as
   "must survive" (NR-28/29/30).

   Usage:  NODE_PATH=/opt/homebrew/lib/node_modules node regression-harness.js
   ============================================================================ */
"use strict";

var path = require("path");
var fs = require("fs");
var chromium = require("playwright").chromium;

var ROOT = path.resolve(__dirname, "..", "..");
var URL = "file://" + path.join(ROOT, "index.html");
var EVIDENCE_DIR = path.join(ROOT, "Dev-Memo-1.1.6.1", "Evidence");

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

(async function main() {
  var browser = null;
  try { browser = await chromium.launch({ channel: "chrome" }); }
  catch (e) { browser = await chromium.launch(); }
  var page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  var pageErrors = [], requests = [];
  page.on("pageerror", function (e) { pageErrors.push(String(e)); });
  page.on("request", function (r) { requests.push(r.url()); });
  page.on("console", function (m) {
    if (m.type() === "error" && !/assets\/audio|ERR_FAILED|Cross origin requests/.test(m.text())) {
      pageErrors.push("console: " + m.text());
    }
  });

  await page.goto(URL);
  await page.waitForFunction(function () { return !!document.querySelector("#editor"); });
  await page.waitForTimeout(3000);

  /* ---- R1 native caret visible (R4 §7 #1) ---------------------------------- */
  var caretStyle = await page.evaluate(function () {
    var ta = document.querySelector("#editor");
    var cs = getComputedStyle(ta);
    var mask = document.getElementById("caret-mask");
    return { caretColor: cs.caretColor, maskDisplay: mask ? getComputedStyle(mask).display : "gone" };
  });
  checkTrue("R1 the native caret has a visible colour",
            caretStyle.caretColor !== "transparent" && caretStyle.caretColor !== "rgba(0, 0, 0, 0)",
            caretStyle.caretColor);
  /* [1.1.6.1 UI integration / V25] The paper-coloured caret mask was part of the retired abstract
     chrome; the node is gone entirely, and the native caret is the visible one (V24). */
  check("R1 the retired caret mask is not in the tree", caretStyle.maskDisplay, "gone");

  /* ---- R2 the 1.1.5 P0 fix: PAPER / RIBBON must not move the caret or the view (matrix #2) */
  await page.evaluate(function () {
    var ta = document.querySelector("#editor");
    var line = "ABCDEFGHIJ".repeat(7);
    var out = [];
    for (var i = 0; i < 120; i++) out.push(line);
    ta.value = out.join("\n");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
    var at = 60 * 71 + 30;
    ta.setSelectionRange(at, at);
    ta.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.waitForTimeout(80);
  var beforeSwitch = await page.evaluate(function () {
    var ta = document.querySelector("#editor");
    var flow = document.querySelector(".editor-flow");
    return { caret: ta.selectionStart, flowTop: getComputedStyle(flow).top };
  });
  await page.click("#btn-paper");
  await page.click("#btn-ribbon");
  await page.waitForTimeout(80);
  var afterSwitch = await page.evaluate(function () {
    var ta = document.querySelector("#editor");
    var flow = document.querySelector(".editor-flow");
    return { caret: ta.selectionStart, flowTop: getComputedStyle(flow).top };
  });
  check("R2 PAPER/RIBBON keep the caret (P0)", afterSwitch.caret, beforeSwitch.caret);
  check("R2 PAPER/RIBBON keep the visible page (P0)", afterSwitch.flowTop, beforeSwitch.flowTop);

  /* ---- R3 HELP returns to the position and keeps the draft (matrix #3) ------- */
  var draftBefore = await page.evaluate(function () {
    return window.localStorage.getItem("kalliope.draft");
  });
  await page.click("#btn-help");
  await page.waitForTimeout(80);
  var helpState = await page.evaluate(function () {
    return {
      editorDisabled: document.querySelector("#editor").disabled,
      helpOpen: !!document.querySelector(".help-sheet.is-open")
    };
  });
  check("R3 the help sheet is open and the editor is closed", helpState,
        { editorDisabled: true, helpOpen: true });
  /* [2026-10-16 bug fix] The help sheet must be readable IN FULL: it is 865.39 document px of
     static copy pinned to the top of the editing window, and the feed model keeps a fresh sheet
     down at the print line, so before the fix only the first line was inside the throat and
     849px were cut off. Guard: the sheet's box sits inside the throat. */
  var helpBox = await page.evaluate(function () {
    var s = document.querySelector(".help-sheet").getBoundingClientRect();
    var c = document.getElementById("paper-clip").getBoundingClientRect();
    var z = c.width / 816;
    return { sheet: [Math.round(s.top), Math.round(s.bottom)],
             clip: [Math.round(c.top), Math.round(c.bottom)],
             docTop: Math.round((s.top - c.top) / z), docBottom: Math.round((s.bottom - c.top) / z),
             docHeight: Math.round((s.bottom - s.top) / z),
             docThroat: Math.round((c.bottom - c.top) / z) };
  });
  /* [2026-10-16, VIC] HELP is locked to FIT: the sheet is fixed 865.39px of copy, so the reader
     may not scale it; the ZOOM control is disabled with the other document controls and the
     reader's own zoom is parked and restored on close. */
  var helpZoom = await page.evaluate(function () {
    return { label: document.querySelector("#btn-zoom").textContent.trim(),
             disabled: document.querySelector("#btn-zoom").disabled };
  });
  checkTrue("R3 HELP locks ZOOM to FIT and disables the control",
            helpZoom.label === "ZOOM FIT" && helpZoom.disabled === true, JSON.stringify(helpZoom));
  var helpLastRow = await page.evaluate(function () {
    var t = document.querySelector(".help-body").textContent.split("\n");
    return t[t.length - 1];
  });
  check("R3 the help sheet ends with the compatibility row",
        helpLastRow, "兼容：1080P、MacBook 13 inch、ipad 13 inch，Safari 全屏");
  checkTrue("R3 the whole HELP sheet fits inside the throat (no line is cut off)",
            helpBox.docTop >= -1 && helpBox.docBottom <= helpBox.docThroat + 2 &&
            helpBox.docHeight > 800,
            JSON.stringify(helpBox));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
  var afterHelp = await page.evaluate(function () {
    var ta = document.querySelector("#editor");
    return { caret: ta.selectionStart, disabled: ta.disabled, draft: window.localStorage.getItem("kalliope.draft") };
  });
  check("R3 leaving HELP restores the editing position", afterHelp.caret, beforeSwitch.caret);
  check("R3 the editor is editable again", afterHelp.disabled, false);
  var zoomBack = await page.evaluate(function () {
    return { label: document.querySelector("#btn-zoom").textContent.trim(),
             disabled: document.querySelector("#btn-zoom").disabled };
  });
  checkTrue("R3 closing HELP gives the reader's own zoom back",
            zoomBack.disabled === false, JSON.stringify(zoomBack));
  check("R3 HELP did not overwrite the recovery draft", afterHelp.draft, draftBefore === null ? null : draftBefore);

  /* ---- R4 AUTO RETURN OFF still stops ordinary characters at 78 units (§16) -- */
  await page.evaluate(function () {
    var ta = document.querySelector("#editor");
    ta.value = "ABCDEFGHIJ".repeat(7) + "ABCDEFG";     /* 77 units on one row */
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.click("#btn-return");                      /* AUTO RETURN OFF */
  await page.waitForTimeout(60);
  var beforeOff = await page.evaluate(function () { return document.querySelector("#editor").value.length; });
  await page.keyboard.type("XYZ");                      /* 77 -> 78 is allowed, the rest is not */
  await page.waitForTimeout(80);
  var afterOff = await page.evaluate(function () { return document.querySelector("#editor").value.length; });
  check("R4 AUTO RETURN OFF stops at the 78-unit edge", afterOff - beforeOff, 1);

  /* ---- R5 Tab still inserts four units (§22) -------------------------------- */
  var beforeTab = await page.evaluate(function () {
    var ta = document.querySelector("#editor");
    ta.setSelectionRange(0, 0);
    return ta.value.length;
  });
  await page.keyboard.press("Tab");
  await page.waitForTimeout(80);
  var afterTab = await page.evaluate(function () { return document.querySelector("#editor").value; });
  check("R5 Tab inserts exactly four cells of text", afterTab.slice(0, 4), "    ");
  checkTrue("R5 Tab keeps the document length in step", afterTab.length === beforeTab + 4, afterTab.length + " vs " + beforeTab);

  /* ---- R6 grid capability guard still reports (matrix #11 / §04) ------------ */
  var grid = await page.evaluate(function () { return document.documentElement.getAttribute("data-grid"); });
  checkTrue("R6 the grid guard reports exact or degraded", grid === "exact" || grid === "degraded", "data-grid=" + grid);

  /* ---- R7 file:// stays offline: nothing was fetched over the network ------- */
  var remote = requests.filter(function (u) { return !/^file:/.test(u) && !/^data:/.test(u) && !/^blob:/.test(u); });
  check("R7 no network request at all", remote, []);

  /* ---- R8 output isolation (matrix #10) ------------------------------------ */
  var isolation = await page.evaluate(function () {
    var stage = document.querySelector(".stage");
    return {
      printRootEmpty: document.getElementById("print-root").childNodes.length === 0,
      machineInsideStage: !!stage.querySelector("#print-head") && !!stage.querySelector("#page-counter"),
      textareaHasNoMachineText: document.querySelector("#editor").value.indexOf("01/") === -1
    };
  });
  check("R8 the print DOM is empty until EXPORT PDF", isolation.printRootEmpty, true);
  check("R8 both machine hooks live inside .stage", isolation.machineInsideStage, true);
  check("R8 no machine text leaked into the document", isolation.textareaHasNoMachineText, true);

  /* ---- R9 the page counter is a function of the layout, not of a guess ----- */
  await page.evaluate(function () {
    var ta = document.querySelector("#editor");
    var line = "ABCDEFGHIJ".repeat(7);
    var out = [];
    for (var i = 0; i < 110; i++) out.push(line);       /* 110 rows -> 3 sheets */
    ta.value = out.join("\n");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.waitForTimeout(80);
  var counter = await page.evaluate(function () { return document.getElementById("page-counter").textContent; });
  check("R9 110 rows report three sheets", counter.slice(-2), "03");

  /* ---- R10 the page itself must never scroll ---------------------------------
     A scrollable document hands Home / End to the PAGE instead of the focused textarea, which
     stops the caret keys working. That is exactly what a stray 118px of overflow did on
     2026-10-15, so the invariant is asserted, not assumed. */
  var pageBox = await page.evaluate(function () {
    return { scrollH: document.documentElement.scrollHeight, winH: window.innerHeight,
             scrollY: window.scrollY };
  });
  checkTrue("R10 the document is not taller than the viewport",
            pageBox.scrollH <= pageBox.winH, pageBox.scrollH + " > " + pageBox.winH);
  check("R10 the page is not scrolled", pageBox.scrollY, 0);

  /* ---- R11 the native caret keys still move the caret ------------------------ */
  await page.evaluate(function () {
    var ta = document.querySelector("#editor");
    ta.value = "ABCDEFGHIJ".repeat(7) + "\n" + "ABCDEFGHIJ".repeat(7);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
    ta.setSelectionRange(30, 30);
    ta.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.waitForTimeout(80);
  await page.keyboard.press("End");
  await page.waitForTimeout(80);
  var afterEndKey = await page.evaluate(function () { return document.querySelector("#editor").selectionStart; });
  check("R11 End moves the caret to the end of the line", afterEndKey, 70);
  await page.keyboard.press("Home");
  await page.waitForTimeout(80);
  var afterHomeKey = await page.evaluate(function () { return document.querySelector("#editor").selectionStart; });
  check("R11 Home moves the caret to the start of the line", afterHomeKey, 0);

  checkTrue("R9 no page errors", pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();

  var stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  var out = path.join(EVIDENCE_DIR, "1.1.6.1-regression-" + stamp + ".json");
  fs.writeFileSync(out, JSON.stringify({
    harness: "regression-harness.js",
    iteration: "1.1.6.1",
    scope: "1.1.5/1.1.5.1/1.1.5.2 achievements + R4 §7 matrix rows 1,2,3,10,11",
    browser: "Chromium (harness only)",
    url: URL,
    passed: results.filter(function (r) { return r.ok; }).length,
    failed: problems.length,
    results: results,
    pageErrors: pageErrors
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
