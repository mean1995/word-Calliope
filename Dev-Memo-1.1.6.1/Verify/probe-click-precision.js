/* Probe (read-only measurement, no source change): does a real click on the paper land the
   caret on the character that was clicked?  D-4 says it does not, measured on Safari in the
   Gate 1 PoC. This measures the same thing in Chromium so the fix can be designed against
   evidence instead of an assumption.
   Usage: NODE_PATH=/opt/homebrew/lib/node_modules node probe-click-precision.js */
"use strict";
var path = require("path");
var chromium = require("playwright").chromium;
var ROOT = path.resolve(__dirname, "..", "..");
var URL = "file://" + path.join(ROOT, "index.html");

(async function () {
  var browser = await chromium.launch({ channel: "chrome" });
  var page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(URL);
  await page.waitForFunction(function () { return !!document.querySelector("#editor"); });

  /* 120 rows of 70 Latin units, caret at the start */
  await page.evaluate(function () {
    var ta = document.querySelector("#editor");
    var line = "ABCDEFGHIJ".repeat(7);
    var out = [];
    for (var i = 0; i < 120; i++) out.push(line);
    ta.value = out.join("\n");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
    ta.setSelectionRange(0, 0);
    ta.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.waitForTimeout(100);

  var geometry = await page.evaluate(function () {
    var paper = document.querySelector("#paper");
    var r = paper.getBoundingClientRect();
    var vv = window.visualViewport;
    /* the computed transform is a matrix, and getBoundingClientRect already includes the
       zoom, so the scale is simply the rect width over the paper's document width */
    var z = r.width / 816;
    return { left: r.left, top: r.top, z: z, vw: vv ? vv.width : 0, vh: vv ? vv.height : 0 };
  });
  console.log("paper rect:", JSON.stringify(geometry));

  /* Click targets: (document row, column in units). Expected offset in document characters =
     row * 71 + col (70 characters plus the newline per row). */
  var targets = [[0, 0], [3, 10], [3, 69], [20, 35], [53, 5], [100, 60]];
  for (var t = 0; t < targets.length; t++) {
    var row = targets[t][0], col = targets[t][1];
    var pt = await page.evaluate(function (a) {
      var paper = document.querySelector("#paper");
      var r = paper.getBoundingClientRect();
      var z = r.width / 816;
      var flow = document.querySelector(".editor-flow");
      var top = parseFloat(getComputedStyle(flow).top) || 0;   /* negative: rows scrolled away */
      var x = r.left + (96 + a.col * 8 + 4) * z;
      var y = r.top + (96 + (a.row * 16 + top / 1) + 8) * z;   /* flow top is already in doc px */
      return { x: x, y: y, z: z, flowTop: top };
    }, { row: row, col: col });
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(60);
    var got = await page.evaluate(function () { return document.querySelector("#editor").selectionStart; });
    var want = row * 71 + col;
    console.log("click row " + row + " col " + col + "  ->  caret " + got + "   expected " + want +
                (got === want ? "   OK" : "   OFF by " + (got - want)));
  }
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(2); });
