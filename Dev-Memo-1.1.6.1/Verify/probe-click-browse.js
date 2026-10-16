/* Probe: click precision in the two cases the native hit test cannot cover -
   (a) the user is browsing (the view is displaced), (b) the click is outside the text column
   (paper margin / slot), where 1.1.5.1 only calls focus().
   Usage: NODE_PATH=/opt/homebrew/lib/node_modules node probe-click-browse.js */
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

  await page.evaluate(function () {
    var ta = document.querySelector("#editor");
    var line = "ABCDEFGHIJ".repeat(7);
    var out = [];
    for (var i = 0; i < 200; i++) out.push(line);
    ta.value = out.join("\n");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.waitForTimeout(100);

  /* browse 30 rows up with the wheel: the caret stays at the end */
  await page.evaluate(function () {
    for (var i = 0; i < 30; i++) {
      document.body.dispatchEvent(new WheelEvent("wheel", { deltaY: -16, deltaMode: 0, bubbles: true, cancelable: true }));
    }
  });
  await page.waitForTimeout(80);

  var before = await page.evaluate(function () {
    var flow = document.querySelector(".editor-flow");
    var ta = document.querySelector("#editor");
    return { flowTop: parseFloat(getComputedStyle(flow).top) || 0, caret: ta.selectionStart, len: ta.value.length };
  });
  console.log("after browsing:", JSON.stringify(before));
  var viewRow = -Math.round(before.flowTop / 16);

  /* (a) click the character at document row R, column C - it is on screen at row R-viewRow */
  var cases = [[viewRow + 5, 3], [viewRow + 12, 40], [viewRow + 40, 69]];
  for (var i = 0; i < cases.length; i++) {
    var row = cases[i][0], col = cases[i][1];
    var pt = await page.evaluate(function (a) {
      var paper = document.querySelector("#paper");
      var r = paper.getBoundingClientRect();
      var z = r.width / 816;
      return {
        x: r.left + (96 + a.col * 8 + 4) * z,
        y: r.top + (96 + (a.row * 16) + 8) * z,      /* a.row is the ON-SCREEN row */
        z: z
      };
    }, { row: row - viewRow, col: col });
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(60);
    var got = await page.evaluate(function () { return document.querySelector("#editor").selectionStart; });
    var want = row * 71 + col;
    console.log("(a) browse-click doc row " + row + " col " + col + " -> caret " + got +
                " expected " + want + (got === want ? "   OK" : "   OFF by " + (got - want)));
  }

  /* (b) click inside the paper but left of the text column, on the line of on-screen row 8 */
  var marginClick = await page.evaluate(function (a) {
    var paper = document.querySelector("#paper");
    var r = paper.getBoundingClientRect();
    var z = r.width / 816;
    return { x: r.left + 40 * z, y: r.top + (96 + a.row * 16 + 8) * z, z: z };
  }, { row: 8 });
  var caretBefore = await page.evaluate(function () { return document.querySelector("#editor").selectionStart; });
  await page.mouse.click(marginClick.x, marginClick.y);
  await page.waitForTimeout(60);
  var caretAfter = await page.evaluate(function () {
    var ta = document.querySelector("#editor");
    return { caret: ta.selectionStart, len: ta.value.length, focused: document.activeElement === ta };
  });
  console.log("(b) margin click: caret before " + caretBefore + " after " + JSON.stringify(caretAfter) +
              "   (would be row " + (viewRow + 8) + " start = " + ((viewRow + 8) * 71) + ")");

  await browser.close();
})().catch(function (e) { console.error(e); process.exit(2); });
