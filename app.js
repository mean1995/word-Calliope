/* ==========================================================================
   Word Καλλιόπη — app.js
   Offline, zero-dependency, classic script (file:// has no module CORS).
   Baseline: Development Draft-1.3 — clause numbers below refer to it.

   Architecture (see the handover note for the measurement behind it):
     * One continuous editing context for the whole document   (§12, §21)
     * The sheet is a window over it; the caret chooses the window (§13)
     * The window is 9in tall, extended downward by the glyph ink the font paints
       below the last baseline, so no glyph of the current sheet is ever clipped
       (§10.1). The window - not the 6.5 x 9in box - is the clip boundary.
     * The 78-unit grid is produced by the font assets themselves: Latin advance is
       exactly 8px and CJK exactly 16px, so the browser's soft wrap inside a 624px
       column IS the 78-unit AUTO RETURN. No runtime measurement, no compensation.
   ========================================================================== */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ constants */
  var UNITS_PER_ROW = 78;                 /* 6.5in x 12 CPI                §10 */
  var ROWS_PER_SHEET = 54;                /* 9in x 6 LPI                   §10 */
  var ROW_PX = 16;                        /* 1/6in @96dpi                  §10 */
  var UNITS_PER_TAB = 4;                  /* §22 */
  /* §15's MARGIN_UNITS (the 70-unit end-of-line warning) was retired in 1.1.6.1: P09 is
     REMOVED, so there is no warning state, no attribute and no bell. The 78-unit width and
     both AUTO RETURN behaviours are untouched - only the warning mechanism is gone. */
  var RECOVERY_MS = 3 * 60 * 1000;        /* §38 */
  var SHEET_PX = ROWS_PER_SHEET * ROW_PX; /* 864 */
  var PAPER_W = 8.5 * 96, PAPER_H = 11 * 96;
  /* [1.1.6.1 UI integration] The machine frame the sheet lives in, from the r1 contract
     (UI-Delivery-1.1.6-r1/coordinates.json). The frame is the scaled box and the thing fitZoom()
     fits, so the whole machine stays on screen; the sheet sits at MACHINE_PAPER_X inside it. */
  var MACHINE_W = 1230.2131979695432, MACHINE_H = 1092.0980420594634;
  var MACHINE_PAPER_X = 207.10659898477158;
  var PAPER_COLORS = [
    /* §08, colours re-ruled by the product side on 2026-10-06 (Notes §13). This array is what
       paints the screen and the print sheets, so it must stay in step with --paper-white /
       --paper-canary in style.css. Only the two literals changed - no behaviour. */
    { name: "WHITE",  value: "#F8F8F6" },
    { name: "CANARY", value: "#F5EDC5" }
  ];
  var RIBBON_COLORS = [
    { name: "BLACK",      value: "#262522" }, /* §09 */
    { name: "BLUE-BLACK", value: "#085BB4" }  /* §09 LOCKED by PM decision: ladder R10 */
  ];
  var ZOOM_STEPS = [
    { label: "FIT",  value: null },
    { label: "75%",  value: 0.75 },
    { label: "100%", value: 1 },
    { label: "125%", value: 1.25 },
    { label: "150%", value: 1.5 }
  ];
  var DEFAULT_NAME = "Untitled.txt";
  /* reported as <html data-build> so a stale cached script can be told apart from a bug.
     Keep in step with --build in style.css (<html data-css>). */
  var APP_BUILD = "1.1.6.1";

  /* ------------------------------------------- 1.1.6.1 provisional rulings (Y-items)
     Each open Y-item from Technical-Reply-1.1.6-R4.md §8.3 is ONE constant here, so a product
     ruling changes one line and nothing else. They are marked 暂定 (provisional) in
     Dev-Memo-1.1.6.1/Inventory-and-Scope-1.1.6.1.md and must be revisited when the product
     side rules; until then the technical recommendation is implemented. */
  var Y1_ACTIVE_NEEDS_VIEW_ON_CARET = true;   /* Y-1: Active also requires the view to show the
                                                 caret's page, or the head would sit on another
                                                 sheet's paper while matching the end column */
  /* [2026-10-16, VIC] Y-2 is SETTLED by the full-page browse pair: Page Up / Page Down no longer
     move the caret by a sheet, they look at the document one whole page at a time (pageFlip()).
     These two switches are the only product choices left inside it. */
  var PAGEVIEW_LOCKS_FIT = true;              /* a whole page is 960 document px and the machine
                                                 adds 132.10 below it, so above FIT the frame cannot
                                                 fit the viewport: entering the page view parks the
                                                 reader's zoom and locks FIT; leaving restores it */
  var PAGEDOWN_RETURNS_ON_CARET_PAGE = true;  /* VIC's rule: a PAGE DOWN whose target page IS the
                                                 page being edited, with the caret not at that
                                                 page's end, leaves the page view and returns to
                                                 the editing position instead of showing it */
  var Y4_COUNTER_OVERFLOW_ALL = true;         /* Y-4: E1/E1 for the whole window (the
                                                 VIC-meeting ruling) instead of AA/E1 */
  var Y5_AA_IS_TOP_VISIBLE_ROW = true;        /* Y-5: AA = the page of the top visible row */
  var Y6_SELECTION_REPLACE_IS_MECHANICAL = false; /* Y-6: no - a replace is not mechanical */

  /* ---------------------------------------- 1.1.6.1 paper feed model (VIC 2026-10-15)
     THE PAPER MOVES, THE MACHINE DOES NOT (P04). The sheet is a physical object that comes out of
     the machine one line at a time; the machine's throat (.paper-clip) shows only the part that
     has come out. That is why the whole sheet is NOT visible: at the first line of a sheet you
     see the one-inch top margin and the line being written, and by the last line the whole writing
     area has come out - after which a new sheet starts.

     Geometry, all from the r1 candidate contract:
       * print line printLineY 956, writing area starts at 96 with a 16px pitch ->
         FEED_ANCHOR_ROW = (956 - 96) / 16 = 53.75 -> the row the print line sits in, row 53;
       * that row's top edge is at 96 + 53 * 16 = 944 in the throat, so the row at the print line
         always lands at PRINT_LINE_TOP_PX;
       * the sheet's own translate is (FEED_ANCHOR_ROW - feed rows) * ROW_PX: 848px at the first
         row of a sheet, 0 at the last.

     FEED_ANCHOR_ROW and --paper-throat are the two numbers the Gate 2 registration will replace;
     they must move together. */
  var FEED_ANCHOR_ROW = 53;                                   /* printLineY 956 -> row 53 of 54 */
  var PRINT_LINE_TOP_PX = 96 + FEED_ANCHOR_ROW * 16;          /* 944: the print-line row's top */

  /* R4 §4.2: the input types that count as typewriter-class input. Everything else
     (insertFromPaste, insertFromDrop, historyUndo, historyRedo, delete*, ...) is modern
     editing and may never sound or feed, whatever the caret ends up doing. */
  var TYPING_INPUT_TYPES = {
    insertText: 1, insertParagraph: 1, insertLineBreak: 1, insertCompositionText: 1
  };

  /* ------------------------------------------------------------------- elements */
  var el = {};

  function cacheElements() {
    el.bar = document.getElementById("bar");
    el.stage = document.getElementById("stage");
    el.stageInner = document.getElementById("stage-inner");
    el.paperClip = document.getElementById("paper-clip");
    el.machineFrame = document.getElementById("machine-frame");
    el.machineFixed = document.getElementById("machine-fixed");
    el.paper = document.getElementById("paper");
    el.window = document.getElementById("sheet-window");
    /* 1.1.1 rail marks: read-only presentation markers flanking the caret's visual line */
    el.railLeft = document.getElementById("rail-left");
    el.railRight = document.getElementById("rail-right");
    el.typeLine = document.getElementById("type-line");
    el.typeTickLong = document.getElementById("type-tick-long");
    el.typeTickShort = document.getElementById("type-tick-short");
    el.typeLineRight = document.getElementById("type-line-right");
    el.typeLineUp2 = document.getElementById("type-line-up2");
    el.typeLineRightUp2 = document.getElementById("type-line-right-up2");
    el.caretMask = document.getElementById("caret-mask");
    el.paperMark = document.getElementById("paper-mark");
    /* 1.1.6.1 hooks: no artwork in this build, but the state and the geometry are live */
    el.printHead = document.getElementById("print-head");
    el.pageCounter = document.getElementById("page-counter");
    el.printRoot = document.getElementById("print-root");
    el.fileInput = document.getElementById("file-input");
    el.btnNew = document.getElementById("btn-new");
    el.btnOpen = document.getElementById("btn-open");
    el.btnSave = document.getElementById("btn-save");
    el.btnPdf = document.getElementById("btn-pdf");
    el.btnZoom = document.getElementById("btn-zoom");
    el.btnReturn = document.getElementById("btn-return");
    el.btnSound = document.getElementById("btn-sound");
    el.btnPaper = document.getElementById("btn-paper");
    el.btnRibbon = document.getElementById("btn-ribbon");
    el.btnPageUp = document.getElementById("btn-pageup");
    el.btnPageDown = document.getElementById("btn-pagedown");
    el.btnWps = document.getElementById("btn-wps");
    el.btnHelp = document.getElementById("btn-help");
  }

  /* ---------------------------------------------------------------------- state */
  var state = {
    name: DEFAULT_NAME,
    handle: null,          /* FileSystemFileHandle when the platform grants one  §30 */
    safeOverwrite: true,   /* false once U+FFFD was seen on OPEN                 §29 */
    savedText: "",         /* value at the last SAVE / OPEN / NEW                   */
    sheet: 0,              /* the CARET's page. Not the same quantity as the view    */
    /* 1.1.6.1 viewport (R4 §2.1): the page the window is actually showing, as
       viewSheet * 54 + viewIntraRows rows from the top of the text. It is normally equal to
       the caret's page, and the wheel may move it while the caret stays put. */
    viewSheet: 0,
    viewIntraRows: 0,
    viewBrowsing: false,   /* true only while a browse action owns the view (R4 §5.3 AA rule) */
    /* 1.1.6.1 mechanical state: the pre-edit snapshot the eligibility formula is judged
       against (R4 §4.2 samples it BEFORE the edit), plus the browser's own classification of
       the edit that just happened. */
    editSnap: null,
    lastInputType: "",
    lastInputData: "",
    helpCounter: null,          /* §5.4 the page numbers shown when HELP opened (frozen while up) */
    helpZoomIndex: null,        /* the reader's zoom, parked while HELP is locked to FIT */
    pageView: false,            /* the full-page browse view owns the viewport (2026-10-16) */
    pageViewZoomIndex: null,    /* the reader's zoom, parked while it is locked to FIT */
    wps: false,                 /* WPS = the 1.1.5.2 page view; DEFAULT OFF (VIC 2026-10-16) */
    layout: null,
    autoReturn: true,      /* §16 */
    zoomIndex: 0,
    paperIndex: 0,
    ribbonIndex: 0,
    pendingCaret: null,    /* §P0 selection held while a control owns focus; memory only */
    browseUntil: 0,        /* 1.1.6.1: viewport owns itself until this timestamp (D-1) */
    help: false            /* §H HELP sheet is showing: the document is closed for editing */
  };

  function document_text() { return el.editor ? el.editor.value : ""; }
  function isDirty() { return document_text() !== state.savedText; }

  /* =========================================================== 1. unit model §11 */

  function isLatinSlot(cp) {
    return (cp >= 0x0020 && cp <= 0x007E) ||
           (cp >= 0x00A0 && cp <= 0x00FF) ||
           (cp >= 0x0100 && cp <= 0x017F);
  }

  /* §11: Latin / digits / half-width punctuation / space = 1 unit,
     CJK and full-width punctuation = 2 units,
     U+201C and U+201D are the documented exception: they live in the CJK slot but
     count and advance as 1 unit (Scheme C, 104-item normalization). */
  function unitsOfCodePoint(cp) {
    if (cp === 0x201C || cp === 0x201D) return 1;
    if (cp === 0x0009) return 1;          /* pasted TAB renders as one cell (tab-size:1) */
    if (cp < 0x0020) return 0;            /* control characters */
    return isLatinSlot(cp) ? 1 : 2;
  }

  function unitsOfText(s) {
    var u = 0;
    for (var i = 0; i < s.length; ) {
      var cp = s.codePointAt(i);
      u += unitsOfCodePoint(cp);
      i += cp > 0xFFFF ? 2 : 1;
    }
    return u;
  }

  /* ==================================================== 2. layout / pagination */

  var ASCII_RE = /^[\x20-\x7E]*$/;

  /* Break one semantic line into visual rows of at most 78 units.
     A 2-unit character never straddles a row boundary, exactly like the browser's
     line breaking with word-break:break-all + line-break:anywhere. */
  function layoutLine(line) {
    var rows = [], n = line.length, i;
    if (n === 0) return [{ text: "", start: 0, end: 0, units: 0 }];

    if (ASCII_RE.test(line)) {                       /* fast path: 1 unit per character */
      for (i = 0; i < n; i += UNITS_PER_ROW) {
        var e = Math.min(i + UNITS_PER_ROW, n);
        rows.push({ text: line.slice(i, e), start: i, end: e, units: e - i });
      }
      return rows;
    }

    var start = 0, units = 0, cur = "";
    for (i = 0; i < n; ) {
      var cp = line.codePointAt(i);
      var ch = line.slice(i, i + (cp > 0xFFFF ? 2 : 1));
      var w = unitsOfCodePoint(cp);
      if (units + w > UNITS_PER_ROW && cur.length > 0) {
        rows.push({ text: cur, start: start, end: i, units: units });
        start = i; units = 0; cur = "";
      }
      cur += ch; units += w; i += ch.length;
    }
    rows.push({ text: cur, start: start, end: n, units: units });
    return rows;
  }

  function computeLayout(text) {
    var lines = text.split("\n");
    var n = lines.length;
    var lineStartChar = new Array(n);
    var lineStartRow = new Array(n);
    var rowsPerLine = new Array(n);
    var ch = 0, row = 0;
    for (var i = 0; i < n; i++) {
      lineStartChar[i] = ch;
      lineStartRow[i] = row;
      var rows = layoutLine(lines[i]);
      rowsPerLine[i] = rows;
      row += rows.length;
      ch += lines[i].length + 1;
    }
    return {
      lines: lines, lineStartChar: lineStartChar, lineStartRow: lineStartRow,
      rowsPerLine: rowsPerLine, totalRows: row
    };
  }

  /* Where is a character offset? -> line, visual row, units from the row start. */
  function locate(layout, offset) {
    var n = layout.lines.length;
    if (offset < 0) offset = 0;
    var lo = 0, hi = n - 1, li = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (layout.lineStartChar[mid] <= offset) { li = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    var line = layout.lines[li];
    var inLine = offset - layout.lineStartChar[li];
    if (inLine < 0) inLine = 0;
    if (inLine > line.length) inLine = line.length;

    var rows = layout.rowsPerLine[li];
    var k = 0;
    for (var i = 0; i < rows.length; i++) {
      if (inLine >= rows[i].start && inLine <= rows[i].end) { k = i; break; }
      k = i;
    }
    var r = rows[k];
    var row = layout.lineStartRow[li] + k;
    return {
      offset: offset,
      line: li,
      lineText: line,
      inLine: inLine,
      row: row,
      colUnits: unitsOfText(line.slice(r.start, inLine)),
      rowUnits: r.units,
      atLineEnd: inLine >= line.length,
      sheet: Math.floor(row / ROWS_PER_SHEET)
    };
  }

  /* Visual rows in document order. Each row carries its document offset range so that print
     can split it into ribbon runs (§48). Offsets do not affect the grid geometry. */
  function flattenRows(layout) {
    var out = [], i, k, rs, base;
    for (i = 0; i < layout.lines.length; i++) {
      rs = layout.rowsPerLine[i];
      base = layout.lineStartChar[i];
      for (k = 0; k < rs.length; k++) {
        out.push({ text: rs[k].text, from: base + rs[k].start, to: base + rs[k].end });
      }
    }
    return out;
  }

  /* Split a row into [{text, colour}] at the ribbon boundaries that fall inside it. */
  function rowSegments(row) {
    var runs = state.runs, segs = [], i, from = row.from, to = row.to;
    if (!runs.length) return [{ text: row.text, colour: state.ribbonIndex }];
    for (i = 0; i < runs.length; i++) {
      var runFrom = runs[i].start;
      var runTo = (i + 1 < runs.length) ? runs[i + 1].start : Number.MAX_SAFE_INTEGER;
      var a = Math.max(from, runFrom), b = Math.min(to, runTo);
      if (b <= a) continue;
      segs.push({ text: row.text.slice(a - from, b - from), colour: runs[i].colour });
    }
    if (!segs.length) segs.push({ text: row.text, colour: state.runs[state.runs.length - 1].colour });
    return segs;
  }

  /* ============================================== 3. the editing surface (§12) */

  /* Whole-document replacement rebuilds the editing node so that the old document's
     native undo history can never leak into the new one (§21). */
  function buildEditor(text) {
    var ta = document.createElement("textarea");
    ta.className = "editor";
    ta.id = "editor";
    ta.setAttribute("wrap", "soft");
    ta.setAttribute("spellcheck", "false");
    ta.setAttribute("autocorrect", "off");
    ta.setAttribute("autocapitalize", "off");
    ta.setAttribute("autocomplete", "off");
    ta.setAttribute("aria-label", "Sheet");
    ta.value = text;

    /* Mirror layer: the textarea keeps caret / IME / undo / selection and stays the single
       source of truth for the text, while these glyphs are painted per ribbon run (§48).
       The whole document is replaced as one subtree, which also clears the old undo context (§21). */
    var ink = document.createElement("div");
    ink.className = "editor-ink";
    ink.setAttribute("aria-hidden", "true");
    var flow = document.createElement("div");
    flow.className = "editor-flow";
    flow.appendChild(ink);
    flow.appendChild(ta);

    var old = el.flow || el.editor;
    if (old && old.parentNode) old.parentNode.replaceChild(flow, old);
    else el.window.appendChild(flow);
    el.flow = flow;
    el.ink = ink;
    el.editor = ta;

    /* a fresh document is one single ribbon run (§48, colour is rendering state only) */
    state.runs = [{ start: 0, colour: state.ribbonIndex }];
    state.inkLen = text.length;
    state.composing = false;
    state.preedata = "";
    state.inkSig = "";

    bindEditor(ta);
    relayout();
    setCaret(0);
    state.sheet = 0;
    state.viewSheet = 0;         /* 1.1.6.1 a rebuilt editor starts on the first sheet, row 0 */
    state.viewIntraRows = 0;
    state.viewBrowsing = false;
    /* [2026-10-16] a rebuilt document leaves the full-page view and gives the zoom back */
    if (state.pageView) leavePageView();
    state.pageViewZoomIndex = null;
    wheelAcc = 0;
    browseClear();
    state.pendingCaret = null;   /* §P0 a rebuilt editor has no earlier selection to put back */
    positionEditor();
    syncInk(true);
    try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
  }

  /* ================================================================ H. HELP sheet
     A read-only sheet of paper inside the same .sheet-window: the machine shows its own
     introduction. Three deliberate separations:
       - it is STATIC DOM, not the editor: no textarea, so it cannot be typed into at all;
       - user-select:none, so it cannot be selected or copied;
       - it lives inside .stage, which print hides, so it can never reach Print / EXPORT PDF.
     The text is broken to the 78-unit grid at build time and rendered with white-space:pre,
     so the sheet never re-flows: Chromium and Safari wrap at exactly the same places and the
     48-row measure is a property of the copy, not of the engine.
     Colour comes from the editor's own palette (§09): the title and the Pessoa lines take the
     BLUE-BLACK ribbon value, everything else the BLACK ribbon value. No new colour is invented. */
  var HELP_SHEET_HTML = "";

  function buildHelpSheet() {
    if (!el.window || el.helpSheet) return;
    var sheet = document.createElement("div");
    sheet.className = "help-sheet";
    sheet.setAttribute("aria-hidden", "true");     /* chrome, not document content */
    var pre = document.createElement("pre");
    pre.className = "help-body";
    pre.innerHTML = HELP_SHEET_HTML;
    sheet.appendChild(pre);
    el.window.appendChild(sheet);
    el.helpSheet = sheet;
  }

  /* HELPSHEET:BEGIN */
  /* The HELP copy, exactly as VIC supplied it (revised 2026-10-08 22:45). The "（蓝色）"
     notes in the manuscript are LAYOUT INSTRUCTIONS and are deliberately NOT part of the
     text. Each entry is ONE ROW of the 78-unit grid: the breaks below are GRID breaks, not
     paragraph breaks (an empty entry is a paragraph gap), and white-space:pre keeps them
     exactly as written. 47 rows of the 54 a sheet holds (45 as supplied + a blank row and the
     compatibility row added on 2026-10-16 by VIC's instruction).
     A row carrying a marked word is a single entry built from several <span>s - never two
     entries, or the grid would spend two rows on one line of text. */
  HELP_SHEET_HTML = [
    "<span class=\"h-blue\">Word Καλλιόπη</span>",
    "<span class=\"h-blue\">一台来自过去的未来写作机器</span>",
    "<span></span>",
    "<span>我始终喜欢打字机，它是如此纯粹的写作工具：纸张、字键、色带，除此之外，几乎没有</span>",
    "<span>什么值得分心。</span>",
    "<span></span>",
    "<span>文字一旦落在纸上，就很难像在屏幕上那样随意修改。</span>",
    "<span>于是，人必须更加认真地思考，斟酌每一个字、每一句话，在敲下字键之前，想清楚自己</span>",
    "<span>究竟要写些什么。</span>",
    "<span></span>",
    "<span>写作因此回到最简单的模样：一个人，一张纸，和自己的思考。</span>",
    "<span></span>",
    "<span>另一个灵感来自 IBM</span>",
    "<span>从 Selectric 精巧的球形打印头，到 1980 年代的 IBM Electronic Typewriters，IBM </span>",
    "<span>曾经将机械工程与电子技术结合得如此精妙。1980 年代，个人电脑与文字处理软件正在</span>",
    "<span>改变人们的写作方式，而传统打字机也逐渐走向历史的黄昏。</span>",
    "<span></span>",
    "<span>那或许是一个时代最后的辉煌，也是它最美的告别。</span>",
    "<span></span>",
    "<span>我想让那些早已退场的字键在赛博格的世界，再次敲响，让那个时代专注而郑重的书写仪</span>",
    "<span>式，继续留在今天。</span>",
    "<span></span>",
    "<span>这就是 </span><span class=\"h-blue\">Word Καλλιόπη</span>",
    "<span></span>",
    "<span class=\"h-blue\">Word</span><span>，因为这里只需要写字，</span>",
    "<span class=\"h-blue\">Καλλιόπη</span><span>（Calliope），来自希腊神话，文字创作的缪斯。</span>",
    "<span></span>",
    "<span>Word Καλλιόπη，让任何需要安静专注的思考与写作发生。它保留现代电脑的便利：中文</span>",
    "<span>输入、复制、粘贴、撤销，以及 TXT 文件的打开与保存、PDF 输出。</span>",
    "<span></span>",
    "<span>与此同时，它又让文字重新回到纸张：US Letter、固定页边距、12 CPI、6 LPI。你可以</span>",
    "<span>选择纸张与色带的颜色，调整缩放比例，打开或关闭 AUTO RETURN，也可以让键盘、回车</span>",
    "<span>与换纸重新发出声音。</span>",
    "<span></span>",
    "<span>那些精确的尺寸、字距与行距，只是为了忠实还原那个时代的书写经验：Modern input. </span>",
    "<span>Typewriter output. 但 Καλλιόπη 并不真的怀旧，它更接近一种 Retro-Futurism：不是</span>",
    "<span>把今天伪装成过去，而是假设四十年前的人曾经想象过这样一台未来写作机器。</span>",
    "<span></span>",
    "<span>Fernando Pessoa 写过：</span>",
    "<span></span>",
    "<span class=\"h-blue\">「我的心略大于整个宇宙」</span>",
    "<span class=\"h-blue\">“And my heart is a little larger than the entire universe.”</span>",
    "<span></span>",
    "<span>这大概也是 Καλλιόπη 想保留的东西：纸张有边界，文字有行数，机器极其有限；而坐在</span>",
    "<span>它前面的人，“一颗心”也可以略大于整个宇宙。</span>",
    "<span></span>",
    /* 2026-10-16, by VIC's instruction: one BLACK compatibility line, appended as the sheet's
       last row (55 of the 78 grid units, so it stays ONE row with white-space:pre). */
    "<span>兼容：1080P、MacBook 13 inch、ipad 13 inch，Safari 全屏</span>"
  ].join("\n");
  /* HELPSHEET:END */

  function applyHelpMode(on) {
    if (!el.editor) return;
    if (on) {
      /* [2026-10-16] FIRST, before anything is captured: leaving the full-page view puts the view,
         the zoom and the page counter back on the document's own position, so HELP freezes the
         counter at the DOCUMENT's page (R4 §5.4) and parks the READER's zoom, not the page view's
         FIT. (The view holds a parked zoom of its own; nesting them the other way round would
         hand the reader the wrong zoom back.) */
      if (state.pageView) exitPageView();
      /* remember the real editing position before the control is taken away (§P0 gives the
         capture; here we only make sure it happens before the selection can be lost) */
      captureCaret();
      /* [1.1.6.1 R4 §5.4] Freeze the page-counter window at the values the DOCUMENT had when
         HELP opened. The sheet now shows help copy, whose rows are not the document's
         pagination, so the counter must not be recomputed from it; it comes back in step when
         the sheet closes. */
      state.helpCounter = counterValues();
      updateCounter();
      /* [2026-10-16, VIC] ZOOM is LOCKED TO FIT for as long as the help sheet is up: the sheet is
         a fixed 865.39px of copy and must be read whole, so the reader may not scale it away (or
         in) from under the layout. The reader's own zoom comes back untouched when HELP closes. */
      state.helpZoomIndex = state.zoomIndex;
      state.zoomIndex = 0;
      applyZoom();
      landFeed();                                  /* no paper motion may outlive the sheet */
      el.editor.disabled = true;                   /* no typing, no selection, no IME, no drop */
      el.editor.setAttribute("tabindex", "-1");
      setDocumentControlsEnabled(false);           /* the document controls read as unavailable */
      setRailsHidden(true);                        /* no editing position to mark on this sheet */
      el.flow.style.visibility = "hidden";         /* the ink layer is chrome: hide it with the text */
      if (el.helpSheet) el.helpSheet.classList.add("is-open");
      el.btnHelp.textContent = "HELP ON";
      /* nothing may be recorded while the editor is closed, and no sound may be triggered
         by the click that hid it (§25: audio is feedback, never logic) */
      if (recoveryTimer) { window.clearInterval(recoveryTimer); recoveryTimer = null; }
    } else {
      if (el.helpSheet) el.helpSheet.classList.remove("is-open");
      el.flow.style.visibility = "";
      el.editor.disabled = false;
      el.editor.removeAttribute("tabindex");
      setDocumentControlsEnabled(true);
      setRailsHidden(false);                       /* the editing marks come back with the text */
      el.btnHelp.textContent = "HELP";
      /* [1.1.6.1 R4 §5.4] the document's own page numbers come back with the document */
      state.helpCounter = null;
      /* [2026-10-16] the sheet came out at offset 0 and the zoom was pinned to FIT while HELP
         was up; put the reader's own zoom and the editing position (flow page offset + paper
         feed) back exactly as they were */
      if (state.helpZoomIndex !== null && state.helpZoomIndex !== undefined) {
        state.zoomIndex = state.helpZoomIndex;
      }
      state.helpZoomIndex = null;
      applyZoom();
      positionEditor();
      try { el.editor.focus({ preventScroll: true }); } catch (e) { el.editor.focus(); }
      scheduleRecoveryCheck();
    }
  }

  /* The document controls, as a set. AUTO RETURN has to stay disabled afterwards: it is
     disabled for good by syncControls() because OFF is not offered, so restoring it blindly
     would change product behaviour. Remembering that one flag is cheaper than re-deriving it.
     §H ZOOM used to stay live while HELP was up; VIC ruled on 2026-10-16 that HELP is locked to
     FIT instead, so ZOOM is disabled with the other controls and the zoom index is put back on
     close. */
  var returnDisabledByDesign = false;

  function setDocumentControlsEnabled(yes) {
    if (!yes) returnDisabledByDesign = el.btnReturn ? el.btnReturn.disabled === true : false;
    [el.btnNew, el.btnOpen, el.btnSave, el.btnPdf,
     el.btnReturn, el.btnSound, el.btnPaper, el.btnRibbon,
     el.btnPageUp, el.btnPageDown, el.btnWps].forEach(function (b) {
      if (!b) return;
      if (yes) b.disabled = (b === el.btnReturn) ? returnDisabledByDesign : false;
      else b.disabled = true;
    });
    /* [2026-10-16, VIC] ZOOM no longer stays live while HELP is up: the help sheet is locked to
       FIT, so its control is disabled with the rest and comes back enabled with them. It is NOT
       in the list above, so it is set from the same flag here - both directions. */
    if (el.btnZoom) el.btnZoom.disabled = !yes;
  }

  /* ---- 2026-10-16 (VIC): WPS = Word Processing System ---------------------------------------
     A state switch (like PAPER / RIBBON, with its own stripe) between the 1.1.5.2 page-editing
     view and the current skeuomorphic interaction. DEFAULT IS THE SKEUOMORPHIC ONE: nothing turns
     WPS on by itself, it is not persisted, and a reload starts skeuomorphic again.
       ON  -> no machine art, no print head, no page counter; the sheet is whole and page-aligned
              (one page at a time, the way 1.1.5.2 showed it); the 1.1.5.2 chrome (badge, rail
              marks, carriage rails, caret mask) is shown; FIT fits the PAPER again.
       OFF -> exactly the interaction this build had.
     The document engine is untouched either way: pagination, caret, IME, AUTO RETURN, PAPER /
     RIBBON, sound, HELP, the full-page pair and every output path behave identically.
     "Word Processing System" is documented here and in the memo only - not on the control, and
     not as a tooltip (VIC 2026-10-16). */
  function applyWps(on) {
    state.wps = on === true;
    if (state.wps && state.pageView) exitPageView();   /* the two whole-page ideas do not stack */
    document.documentElement.setAttribute("data-wps", state.wps ? "on" : "off");
    applyColors();                                      /* the caret colour is mode-specific */
    applyZoom();                                        /* FIT follows the mode */
    positionEditor();
    viewToCaret();
    refreshViewportChrome();
  }

  /* §H the two rail triangles belong to the editing position; while the HELP sheet is up there
     is no editing position to mark, so they are cleared. applyZoom() would put them straight
     back (it redraws them for the new scale), so it is told to leave that alone in this state. */
  var helpHidesRails = false;

  function setRailsHidden(hidden) {
    helpHidesRails = hidden;
    /* [2026-10-16] both halves of the WPS chrome are restored here: updateRailMarks() alone left
       the carriage rail and the caret mask out until the next keystroke */
    if (!hidden) { updateRailMarks(); updateTypeLine(); return; }
    if (el.railLeft) el.railLeft.style.display = "none";
    if (el.railRight) el.railRight.style.display = "none";
    if (el.typeLine) el.typeLine.style.display = "none";
    [el.typeLineRight, el.typeLineUp2, el.typeLineRightUp2].forEach(function (b) {
      if (b) b.style.display = "none";
    });
    if (el.caretMask) el.caretMask.style.display = "none";
  }

  function toggleHelp() {
    state.help = !state.help;
    applyHelpMode(state.help);
  }

  /* everything except HELP and ZOOM is inert while the sheet is up: guarded at the event layer,
     not merely greyed out, so no handler runs and nothing can flip a switch behind the sheet */
  function helpBlocks() { return state.help === true; }

  /* ---- ribbon runs ---------------------------------------------------------------------
     Product decision (§48): switching the ribbon affects only the characters typed after the
     switch; what is already on the paper keeps the ink it was typed with. The runs are held in
     memory as rendering state - the TXT stays semantic plain text and carries no colour, so a
     saved document reopens entirely in the current ribbon. */
  function ribbonSwitch(index) {
    var runs = state.runs, last = runs[runs.length - 1], n = document_text().length;
    if (!last) { state.runs = [{ start: 0, colour: index }]; }
    else if (last.colour !== index) {
      if (last.start >= n) last.colour = index;      /* nothing typed since the last switch */
      else runs.push({ start: n, colour: index });
    }
    syncInk(true);
  }

  /* keep run boundaries aligned when the text is edited before them */
  function noteEdit(oldLen) {
    var v = document_text(), delta = v.length - oldLen;
    if (!delta || state.runs.length < 2) return;
    var caret = el.editor.selectionStart || 0;
    var runs = state.runs, i;
    for (i = 1; i < runs.length; i++) if (runs[i].start > caret) runs[i].start += delta;
    for (i = 1; i < runs.length; i++) {
      if (runs[i].start < runs[i - 1].start) runs[i].start = runs[i - 1].start;
      if (runs[i].start > v.length) runs[i].start = v.length;
    }
  }

  /* Rendered synchronously: the span count is the number of ribbon runs (normally one or
     two), so the cost is a few textContent writes even in a long document. Deferring this to
     an animation frame would risk a stale paper whenever frames are throttled. */
  function syncInk() {
    renderInk();
  }

  function renderInk() {
    var ta = el.editor, ink = el.ink;
    if (!ta || !ink) return;
    var v = ta.value;
    /* Composition: engines normally include the marked text in value. If a platform does not,
       show it here anyway so typing is never invisible; the composing range is underlined. */
    var pre = state.composing ? (state.preedata || "") : "";
    var shown = v;
    if (pre && v.indexOf(pre) === -1) shown = v + pre;

    var sig = shown.length + "|" + pre + "|";
    for (var k = 0; k < state.runs.length; k++) sig += state.runs[k].start + ":" + state.runs[k].colour + ",";
    if (sig === state.inkSig && ink.firstChild) return;
    state.inkSig = sig;

    var frag = document.createDocumentFragment();
    for (var i = 0; i < state.runs.length; i++) {
      var from = Math.min(state.runs[i].start, shown.length);
      var to = (i + 1 < state.runs.length) ? Math.min(state.runs[i + 1].start, shown.length) : shown.length;
      if (to <= from) continue;
      var span = document.createElement("span");
      span.className = "ink-" + (state.runs[i].colour ? 1 : 0);
      if (pre && to === shown.length) span.className += " composing";
      span.textContent = shown.slice(from, to);
      frag.appendChild(span);
    }
    while (ink.firstChild) ink.removeChild(ink.firstChild);
    if (frag.childNodes.length) ink.appendChild(frag);
  }

  function bindEditor(ta) {
    ta.addEventListener("keydown", onKeyDown);
    /* second net for the same §16 rule: some engines do not honour preventDefault on
       keydown for every input path, and beforeinput covers exactly the cases where an
       ordinary character insertion is about to happen (paste / drop / IME are exempt). */
    ta.addEventListener("beforeinput", onBeforeInput);
    ta.addEventListener("input", onInput);
    ta.addEventListener("click", onCaretMoved);
    ta.addEventListener("keyup", onCaretMoved);
    /* §P0 Safari resets the selection to 0 when a focused textarea is refocused after a
       button took focus away, and it does so BEFORE the focus event is dispatched (observed:
       blur = 26, click handler start = 26, focus = 0). The selection therefore has to be
       captured while the editor still owns it - at blur, where it is still correct - and put
       back on the way in, before anything reads selectionStart. Native behaviours are left
       untouched: nothing here intercepts typing, IME, undo, paste or navigation, and a
       programmatic or user focus without a preceding blur is not restored at all. */
    ta.addEventListener("focus", function (e) {
      if (!e.isTrusted) {
        /* our own focus() fired a second, untrusted focus event: not a user gesture. It must
           not re-run the sheet sync on selection values we have not restored yet. */
        restoreCaret();
        return;
      }
      restoreCaret();
      onCaretMoved();
    });
    ta.addEventListener("select", onCaretMoved);
    ta.addEventListener("blur", function () {
      captureCaret();
      onCaretMoved();
    });
    ta.addEventListener("scroll", resetScroll, true);
    /* §18 composition is never intercepted; these handlers only keep the mirror layer in step */
    ta.addEventListener("compositionstart", function () { state.composing = true; syncInk(true); });
    ta.addEventListener("compositionupdate", function (e) { state.preedata = e.data || ""; syncInk(false); });
    ta.addEventListener("compositionend", function () {
      state.composing = false; state.preedata = "";
      state.inkLen = document_text().length;
      onInput();
    });
  }

  function relayout() {
    state.layout = computeLayout(document_text());
    /* own height = content height + one sheet of slack, so neither layer can scroll
       internally even if an out-of-contract glyph wraps differently */
    var h = (state.layout.totalRows * ROW_PX + SHEET_PX) + "px";
    if (el.editor) el.editor.style.height = h;
    if (el.ink) el.ink.style.height = h;
    if (el.flow) el.flow.style.height = h;
  }

  function setCaret(offset) {
    if (!el.editor) return;
    var n = el.editor.value.length;
    if (offset > n) offset = n;
    if (offset < 0) offset = 0;
    try { el.editor.setSelectionRange(offset, offset); } catch (e) {}
  }

  /* §P0 the editing position survives a trip through the controls. This only ever puts back
     what the user's own selection was when the editor lost focus: it never invents a position,
     never moves the caret to the document start or end, and never touches text, undo or IME.
     Held in memory only - not document state, never stored, printed or exported. */
  function captureCaret() {
    var ta = el.editor;
    if (!ta) { state.pendingCaret = null; return; }
    var start = ta.selectionStart, end = ta.selectionEnd;
    if (start === null || start === undefined) { state.pendingCaret = null; return; }
    state.pendingCaret = {
      start: start,
      end: (end === null || end === undefined) ? start : end,
      direction: ta.selectionDirection || "none",
      value: ta.value,
      dirty: isDirty()
    };
  }

  function restoreCaret() {
    var ta = el.editor, p = state.pendingCaret;
    if (!ta || !p) return false;
    state.pendingCaret = null;                    /* one shot: never fights later input */
    /* the selection is only put back when the platform actually lost it; an engine that
       keeps it correctly (Chromium) is left completely alone. */
    if (ta.selectionStart !== 0 || ta.selectionEnd !== 0) return false;
    if (ta.value !== p.value) return false;       /* document changed underneath: do not guess */
    if (p.dirty !== isDirty()) return false;      /* a programmatic load happened in between */
    var n = ta.value.length;
    var s = p.start > n ? n : (p.start < 0 ? 0 : p.start);
    var e = p.end > n ? n : (p.end < 0 ? 0 : p.end);
    try { ta.setSelectionRange(s, e, p.direction); } catch (err) { return false; }
    return true;
  }

  function resetScroll() {
    if (el.window) { el.window.scrollTop = 0; el.window.scrollLeft = 0; }
    if (el.paper) { el.paper.scrollTop = 0; el.paper.scrollLeft = 0; }
  }

  /* §13 the sheet shown is the one the caret is in */
  function caretInfo() {
    if (!state.layout) relayout();
    var off = el.editor ? el.editor.selectionStart : 0;
    return locate(state.layout, off || 0);
  }

  /* ================================================= 3. viewport (1.1.6.1)
     R4 §2.1: two separate quantities. The CARET page (state.sheet) says where editing is;
     the VIEW page (state.viewSheet + state.viewIntraRows) says what the window shows. They
     are equal in the normal state. The wheel may move the view while the caret stays put
     (R4 §2.2, a VIC-meeting ruling); every caret move and the first keystroke after browsing
     put the view back on the caret (R4 §2.3 / P06).

     setViewRow() is the ONLY writer of the view amount, exactly as positionEditor() was the
     only writer of the old page offset. Clamped to [0, totalRows - 54]: the view stops at the
     first row and at the last full sheet, with no rubber band (R4 §2.4). A page number alone
     is not enough - the in-page row is part of the quantity, otherwise a 27-row wheel step is
     rounded back to the same page and the wheel never turns (Gate 1 finding). */

  function totalRows() { return state.layout ? state.layout.totalRows : 0; }

  /* The view is (sheet, how far that sheet has fed). viewRow() is the DOCUMENT ROW currently
     standing at the print line - the one row the machine is printing on. It cannot go before
     the first row and cannot feed past the last one. */
  function maxViewRow() {
    var t = totalRows();
    return t > 1 ? t - 1 : 0;
  }

  /* [2026-10-16] The full-page view stands on a SHEET, not on the text: a page holds 54 rows, so
     it may feed to that page's last row even when the document ends earlier - that is exactly what
     makes a whole page visible, empty rows and all. Only the page view asks for it. */
  function maxPageViewRow() {
    var pages = Math.max(1, Math.ceil(Math.max(1, totalRows()) / ROWS_PER_SHEET));
    return pages * ROWS_PER_SHEET - 1;
  }

  function minViewRow() { return 0; }

  function viewRow() { return state.viewSheet * ROWS_PER_SHEET + state.viewIntraRows; }

  /* [2026-10-16] Where a document row sits in the stage's document coordinates. The skeuomorphic
     view pins the row standing at the print line (the sheet has fed out that far); the WPS view
     shows a whole page-aligned sheet, so a row sits at the top margin plus its distance from the
     page's first row. */
  function rowTopPx(row) {
    if (state.wps) return RAIL_MARGIN_PX + (row - state.viewSheet * ROWS_PER_SHEET) * ROW_PX;
    return PRINT_LINE_TOP_PX + (row - viewRow()) * ROW_PX;
  }

  /* Which rows the chrome may draw on. Skeuomorphic: the sheet the throat shows, up to the row
     standing at the print line (nothing below it has come out of the machine yet). WPS: the whole
     page, because the whole page is what is on screen. */
  function rowVisibleOnSheet(row) {
    var pageStart = state.viewSheet * ROWS_PER_SHEET;
    return state.wps ? (row >= pageStart && row < pageStart + ROWS_PER_SHEET)
                     : (row >= pageStart && row <= viewRow());
  }

  function setViewRow(row, wholeSheet) {
    if (!isFinite(row)) return false;
    row = Math.floor(row);
    var min = minViewRow();
    if (row < min) row = min;
    var max = wholeSheet ? maxPageViewRow() : maxViewRow();
    if (row > max) row = max;
    var sheet = Math.floor(row / ROWS_PER_SHEET);
    var intra = row - sheet * ROWS_PER_SHEET;
    if (sheet === state.viewSheet && intra === state.viewIntraRows) return false;
    state.viewSheet = sheet;
    state.viewIntraRows = intra;
    positionEditor();
    /* The chrome and the page counter describe the WINDOW, so they move with it: without this
       a wheel gesture moved the paper while the counter still showed the caret's page (found
       by the mechanical harness, 2026-10-15). */
    refreshViewportChrome();
    return true;
  }

  /* The one browse primitive: the wheel moves the view and marks the viewport as displaced.
     state.viewBrowsing is what tells "the user is looking at another sheet" apart from "the
     document ends here so the view is clamped" - the two are very different for AA (§5.3). */
  function moveViewRows(rows) {
    if (!rows) return false;
    var moved = setViewRow(viewRow() + rows);
    if (moved) state.viewBrowsing = true;
    return moved;
  }

  /* The normal view: the line being written stands at the print line, on the sheet that row
     belongs to. Because the PAPER moves (not the text), this is simply "the caret's row is the
     row at the print line": viewRow = caret row. How far the sheet has come out of the machine
     falls out of the pair, and positionEditor() turns it into the translate.
     Following the caret also ends the browsing state (P06).

     [1.1.5.1 -> 1.1.6.1] The old rule was "the caret's page, page-aligned": the sheet sat still
     and only turned at row 54. Now the sheet advances one line per line from the very first
     line, and a new sheet starts when the old one is full - which is what "纸张向上进给相应
     行距" looks like when the paper is a sheet coming out of a machine. */
  function viewToCaret() {
    var info = caretInfo();
    /* [2026-10-16] WPS shows a page-aligned sheet: the view is the caret's PAGE, not its row. */
    var moved = setViewRow(state.wps ? (info.sheet < 0 ? 0 : info.sheet) * ROWS_PER_SHEET : info.row);
    state.viewBrowsing = false;
    return moved;
  }

  /* ---- 2026-10-16 (VIC): the FULL-PAGE view ----------------------------------------------
     PAGE UP / PAGE DOWN (and the physical Page Up / Page Down keys, which VIC moved here from
     "move the caret by a sheet" - Y-2 is settled by this) look at the document ONE WHOLE PAGE at
     a time: the sheet is all the way out of the machine (feed 0), so its 54 rows are on screen
     together. It is BROWSING, never editing: the caret does not move, state.viewBrowsing is set
     (so AA names the page on screen - Y-5 - and the print head hides), it is silent, it never
     animates the feed and it changes no pagination. Any input, a paper click or Escape ends it
     through the ordinary D-1 paths, which put the view back on the caret. */
  function pageCount() {
    return Math.max(1, Math.ceil(Math.max(1, totalRows()) / ROWS_PER_SHEET));
  }

  function caretPage() { return Math.floor(caretInfo().row / ROWS_PER_SHEET); }

  /* "the caret is not at that page's end": not on the page's last row, and not at the end of the
     document either - both mean there is still writing to do on that page. */
  function caretAtPageEnd() {
    var row = caretInfo().row;
    return (row % ROWS_PER_SHEET) === (ROWS_PER_SHEET - 1) || row >= Math.max(0, totalRows() - 1);
  }

  function showWholePage(page) {
    var last = pageCount() - 1;
    if (page < 0 || page > last) return false;
    if (!state.pageView) state.pageViewZoomIndex = state.zoomIndex;
    state.pageView = true;
    state.viewBrowsing = true;
    if (PAGEVIEW_LOCKS_FIT) {
      state.zoomIndex = 0;                      /* FIT: the only zoom that can show a whole page */
      applyZoom();
    }
    /* the page's LAST row at the print line == the sheet is completely out of the machine */
    setViewRow(page * ROWS_PER_SHEET + (ROWS_PER_SHEET - 1), true);
    refreshViewportChrome();
    if (el.btnZoom) el.btnZoom.disabled = true; /* the zoom is the page view's to hold */
    return true;
  }

  /* Leaves the page view. The view itself is NOT set here - the caller either has set it or is
     about to - so this is safe to call from viewToCaret()'s own path. */
  function leavePageView() {
    if (!state.pageView) return;
    state.pageView = false;
    if (state.pageViewZoomIndex !== null && state.pageViewZoomIndex !== undefined) {
      state.zoomIndex = state.pageViewZoomIndex;
    }
    state.pageViewZoomIndex = null;
    applyZoom();
    if (el.btnZoom) el.btnZoom.disabled = state.help === true;
  }

  function exitPageView() {
    if (!state.pageView) return false;
    leavePageView();
    viewToCaret();
    refreshViewportChrome();
    return true;
  }

  /* One PAGE UP (-1) or PAGE DOWN (+1). From the editing state it opens the page next to the
     caret's page; inside the view it steps one page and CLAMPS at the first and last page (no
     blank pages). VIC's rule: a PAGE DOWN whose target page is the page being edited, with the
     caret not at that page's end, leaves the view and returns to the editing position. */
  function pageFlip(direction) {
    if (state.help) return false;
    var pages = pageCount();
    /* [2026-10-16] In WPS mode the sheet is already whole and page-aligned, so the pair simply
       turns the page: no feed to press out, no FIT lock, and no "return to the edited page" rule
       (that rule belongs to the skeuomorphic page view, which has a separate editing position). */
    if (state.wps) {
      var targetPage = state.viewSheet + direction;
      if (targetPage < 0 || targetPage > pages - 1) return false;
      setViewRow(targetPage * ROWS_PER_SHEET);
      /* browsing, not editing: AA must name the page ON SCREEN (the WPS page counter is hidden,
         but the state has to stay consistent), and the first keystroke brings the caret's own
         page back through the ordinary D-1 path. */
      state.viewBrowsing = true;
      refreshViewportChrome();
      return true;
    }
    if (!state.pageView) return showWholePage(caretPage() + direction);
    var shown = Math.floor(viewRow() / ROWS_PER_SHEET);
    var target = shown + direction;
    if (target < 0 || target > pages - 1) return false;
    if (PAGEDOWN_RETURNS_ON_CARET_PAGE && direction > 0 && target === caretPage() && !caretAtPageEnd()) {
      return exitPageView();
    }
    return showWholePage(target);
  }

  /* ---- browse suppression (D-1) -------------------------------------------------------
     A browse action owns the viewport for a moment. Without this, the keyup / select /
     onCaretMoved paths that belong to the same gesture pull the view straight back to the
     caret (measured on real Safari: view 3 -> 10 after one PageUp). The window is a
     timestamp, so a lost keyup cannot wedge it; any keydown, click or input ends it at once,
     so a genuine navigation is never swallowed. */
  var BROWSE_HOLD_MS = 250;

  function viewNow() {
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  }

  function browseActive() { return state.browseUntil > viewNow(); }
  function browseHold(ms) { state.browseUntil = Math.max(state.browseUntil, viewNow() + (ms || BROWSE_HOLD_MS)); }
  function browseClear() { state.browseUntil = 0; }

  /* ---- wheel browsing (R4 §2.2 / §2.4) ------------------------------------------------
     The wheel moves the viewport and never the caret, silently. Delta modes are normalised,
     the remainder is carried across events so a trackpad's inertia does not lose or overrun
     a line, and the step is one line (16 document px) - the same pitch as the 6 LPI grid, so
     no half-line of paper ever appears. preventDefault is required: Safari's document-level
     wheel listener is passive by default and the page would scroll as well, doubling the
     displacement. */
  var wheelAcc = 0;

  function onWheel(e) {
    if (state.help) return;
    browseHold(BROWSE_HOLD_MS);
    var px = e.deltaY || 0;
    if (e.deltaMode === 1) px *= ROW_PX;              /* DOM_DELTA_LINE */
    else if (e.deltaMode === 2) px *= SHEET_PX;       /* DOM_DELTA_PAGE */
    wheelAcc += px;
    var rows = wheelAcc < 0 ? Math.ceil(wheelAcc / ROW_PX) : Math.floor(wheelAcc / ROW_PX);
    if (rows !== 0) {
      wheelAcc -= rows * ROW_PX;
      moveViewRows(rows);
    }
    if (e.cancelable !== false) e.preventDefault();
  }

  /* The input moment (R4 §2.3): browsing ends and the view returns to the caret BEFORE the
     mechanical eligibility of this input is judged. Reversing the order would let the
     eligibility formula read a stale "is the view showing the caret page" and silence the
     first keystroke after a browse. */
  function inputMoment() {
    if (state.pageView) exitPageView();          /* any input returns to the editing position */
    browseClear();
    /* The same rule viewToCaret() uses: the caret's row goes back to the print line. In WPS mode
       that rule is PAGE-ALIGNED instead (the sheet is whole and never feeds), so the view only has
       to follow when the caret crosses into another page. Without this branch every single
       keystroke re-set the view to the caret's row - a no-op for the paper (the feed is pinned at
       0) but a full positionEditor() + refreshViewportChrome() every time: measured 2026-10-16,
       40 style writes per 10 keys in WPS against 25 in the skeuomorphic view. */
    var info = caretInfo();
    var base = state.wps ? (info.sheet < 0 ? 0 : info.sheet) * ROWS_PER_SHEET : info.row;
    if (viewRow() !== base) setViewRow(base);
    /* the browse session ends here even when the clamp means the view cannot move: from this
       keystroke on, AA is the page being written on again (R4 §5.3) */
    state.viewBrowsing = false;
  }

  /* ---- D-2 RETIRED (2026-10-16, VIC) ---------------------------------------------------
     Page Up / Page Down used to move the CARET one sheet (54 rows, keeping its column) and let
     the view follow. VIC replaced that with the full-page view above, so the function is gone;
     the keys and the two Primary Controls now call pageFlip(). Silent, no feed, no line change -
     the same "modern navigation, never a line feed" rule (S02 / P12) still holds. */

  /* ---- D-4: a paper point becomes a document offset -----------------------------------
     Used ONLY for clicks outside the text column (the paper's margins and the slot area); a
     click on the text itself is left to the engine's own hit test, which was measured to be
     exact (Chromium, 2026-10-15, at FIT zoom and at 100%, before and while browsing).
     The pointer arrives in CSS px AFTER the document ZOOM transform, so it is divided by the
     live scale - taken from the paper's own rect, never parsed out of a transform string -
     before it is read against the 96px margin and the 8 x 16 document grid. */
  function documentPointFromClient(x, y) {
    var rect = el.paper.getBoundingClientRect();
    var z = rect.width > 0 ? (rect.width / PAPER_W) : 1;
    if (!isFinite(z) || z <= 0) z = 1;
    return { x: (x - rect.left) / z, y: (y - rect.top) / z, z: z };
  }

  /* Row + column units -> document offset. The row is walked in code points so a CJK character
     counts as its two units and a surrogate pair stays one character; the result is the offset
     of the character the pointer is inside, which is what "click where you mean to type" means. */
  function offsetFromRowUnits(row, colUnits) {
    var rows = flattenRows(state.layout);
    if (!rows.length) return 0;
    if (row < 0) row = 0;
    if (row >= rows.length) row = rows.length - 1;
    var r = rows[row];
    var text = r.text || "";
    var units = 0, i = 0;
    while (i < text.length) {
      var cp = text.codePointAt(i);
      var w = unitsOfCodePoint(cp);
      if (units + w > colUnits) break;
      units += w;
      i += (cp > 0xFFFF ? 2 : 1);
    }
    return r.from + i;
  }

  function placeCaretFromPaperPoint(clientX, clientY) {
    if (!el.editor || !state.layout) return false;
    var p = documentPointFromClient(clientX, clientY);
    /* The point is measured ON THE SHEET, and the sheet moves: its own row index plus the
       sheet's first document row gives the document row. */
    var pageStartHere = state.viewSheet * ROWS_PER_SHEET;
    var row = pageStartHere + Math.floor((p.y - RAIL_MARGIN_PX) / ROW_PX);
    var colUnits = Math.floor((p.x - RAIL_MARGIN_PX) / RAIL_UNIT_PX);
    if (colUnits < 0) colUnits = 0;
    if (colUnits > UNITS_PER_ROW) colUnits = UNITS_PER_ROW;
    setCaret(offsetFromRowUnits(row, colUnits));
    syncSheet(false);                      /* the view follows the caret: the click is navigation */
    return true;
  }

  /* The ONE place the paper and the text are placed. Two independent quantities:
       * which sheet's text the window holds -> the flow's page offset (page-aligned, so the
         sheet carries its own 54 rows: the sheet is a physical object, not a sliding window);
       * how far that sheet has come out     -> the paper's own translate.
     Nothing else moves the paper (P04: machine fixed, paper moves). */
  function positionEditor() {
    if (!el.flow) return;
    var pageStart = state.viewSheet * ROWS_PER_SHEET;
    el.flow.style.top = (-(pageStart * ROW_PX)) + "px";
    applyPaperFeed(0);
    resetScroll();
  }

  /* How far the sheet has come out of the machine, in document px. When the row standing at the
     print line is row k of its sheet, the sheet's top edge is (FEED_ANCHOR_ROW - k) lines above
     the print line: 53 lines at the first row (the machine still holds all but the top margin)
     and 0 at the last row (the whole writing area is out). */
  function paperFeedPx(extraRows) {
    return (FEED_ANCHOR_ROW - state.viewIntraRows - (extraRows || 0)) * ROW_PX;
  }

  function applyPaperFeed(extraRows) {
    if (!el.paper) return;
    /* [2026-10-16 bug fix] While the HELP sheet is up the paper carries no feed offset at all.
       The help sheet is pinned to the TOP of the editing window (it is 865.39 document px of
       static copy: 96px margin + 48 rows) and must be readable in full, while the feed model
       deliberately holds a fresh sheet down at the print line - at the first row only the top
       margin and one line are inside the throat. Left alone, HELP therefore showed exactly one
       line and hid the other 849px. With the offset at 0 the whole help sheet (96..961.39) sits
       inside the 960px throat, so every line is visible. The editing position is restored by
       positionEditor() when the sheet closes. */
    el.paper.style.transform = "translateY(" +
      ((state.help || state.wps) ? 0 : paperFeedPx(extraRows)) + "px)";
  }

  function syncSheet(force) {
    if (!el.editor) return;
    var info = caretInfo();
    var sheet = info.sheet < 0 ? 0 : info.sheet;
    /* The view follows the caret unless the user is browsing (D-1). `force` is the
       new-document / open / recovery path: it always re-anchors, and stays silent. */
    /* [2026-10-16] the full-page view owns the viewport: the caret may move (a click inside the
       visible page) without the sheet being pulled back to the print line. */
    var follows = !state.pageView && (force || !browseActive());
    state.sheet = sheet;
    if (follows) viewToCaret();
    /* [1.1.6.1 S01/S02/S04] This function no longer makes a sound. 1.1.5.1 played the sheet
       sound here whenever the page changed, so every navigation and every click across a
       boundary was audible; under the locked rules only a real mechanical write may sound,
       and that decision belongs to mechanicalFeedback(), which knows what the edit was. The
       view move itself stays instant and silent (P02). */
    /* §15 the end-of-line warning was REMOVED by P09 in 1.1.6.1: no attribute, no state and no
       bell. The block that used to live here is gone, and nothing else depended on it -
       style.css and index.html have no consumer of data-margin (checked 2026-10-15). */
    refreshViewportChrome();
  }

  /* Everything that is drawn from the window's position rather than from the document: the
     two rail marks, the carriage rail, the print head's state and the page counter. Called
     from syncSheet (the caret moved) and from setViewRow (the window moved), so the two ways
     the view can change can never leave the chrome stale. */
  function refreshViewportChrome() {
    updateRailMarks();
    updateTypeLine();
    updatePrintHead(caretInfo());
    updateCounter();
  }

  /* ================================================= 3d. mechanical feedback (1.1.6.1)
     R4 §1–§4. Two decisions that 1.1.5.1 took in the wrong place are taken here instead:
     what an operation IS (mechanical writing or modern editing), and what that earns it
     (a sound, a line feed, or nothing at all). Print-head visibility is a separate question
     that reads the same source facts (§1.2). */

  /* The pre-edit snapshot. It MUST be taken before the edit: afterwards the selection has
     already moved, so "was the caret at the end" and "was there a selection" are no longer
     answerable (R4 §4.2). */
  function takeEditSnapshot() {
    var ta = el.editor;
    if (!ta) { state.editSnap = null; return; }
    var info = caretInfo();
    var empty = ta.selectionStart === ta.selectionEnd;
    state.editSnap = {
      empty: empty,
      atEnd: empty && ta.selectionStart === ta.value.length,
      row: info.row,
      sheet: info.sheet < 0 ? 0 : info.sheet,
      colUnits: info.colUnits,
      len: ta.value.length,
      composing: state.composing === true
    };
  }

  /* R4 §4.2 mechanical eligibility: a typing-class input, no selection before the edit, and
     the caret at the true end of the document before the edit. Composition is excluded so
     that S03 keeps the 1.1.5.1 IME handling exactly as it was. */
  function mechanicalEligible(snap, inputType) {
    if (!snap) return false;
    if (!TYPING_INPUT_TYPES[inputType] && inputType !== "deleteContentBackward") return false;
    if (snap.composing) return false;
    if (!snap.empty && !Y6_SELECTION_REPLACE_IS_MECHANICAL) return false;
    return snap.atEnd;
  }

  /* Sound slots: 0 sound1 character · 1 sound2 space/nav/backspace · 2 sound3 return ·
     3 sound4 the sheet turning over. */
  var SOUND_CHARACTER = 0, SOUND_SPACE = 1, SOUND_RETURN = 2, SOUND_SHEET = 3;

  /* The chain of R4 §4.1: SOUND OFF (inside playSound) -> eligibility -> cross-page sound4 ->
     ordinary mechanical sound. Called once per edit, after the layout is current. */
  function mechanicalFeedback() {
    var snap = state.editSnap;
    var inputType = state.lastInputType;
    state.editSnap = null;
    state.lastInputType = "";
    if (!snap || !el.editor) return;
    if (!mechanicalEligible(snap, inputType)) return;   /* silent: paste, drop, undo, history */

    var info = caretInfo();
    var sheet = info.sheet < 0 ? 0 : info.sheet;
    var typed = TYPING_INPUT_TYPES[inputType] === 1;
    var backspace = inputType === "deleteContentBackward";
    var crossed = sheet !== snap.sheet;
    var forward = info.row > snap.row;
    var backward = info.row < snap.row;

    if (typed && crossed) {
      /* P02 / S04: a real forward page crossing - instant switch, no paper-change animation,
         and sound4 replaces the carriage-return sound (it is never stacked). */
      landFeed();
      playSound(SOUND_SHEET);
      return;
    }
    if (typed && forward) {
      /* The only event that may animate a feed (P12): a real forward line break from normal
         sequential writing - Enter, or an AUTO RETURN wrap, which the engine performs inside
         the layout without any newline character. */
      playSound(SOUND_RETURN);
      feedForwardLine();
      return;
    }
    if (backspace && backward) {
      /* P01 scheme A: the paper steps back by the line pitch instantly, no reverse animation
         and no extra feed sound. */
      landFeed();
      return;
    }
    if (backspace) { playSound(SOUND_SPACE); return; }  /* end Backspace, same line (§4.2) */
    if (typed) playSound(state.lastInputData === " " ? SOUND_SPACE : SOUND_CHARACTER);
  }

  /* ---- the three independent paths (R4 §3.4) ------------------------------------------
     1. feedForwardLine() - the ONLY animated one. Transform only (R4 §7.8 / UIREQ §7), never
        a layout property, and a newer target wins outright: the animation restarts from rest
        instead of being queued or replayed (R4 §3.1 / D2).
        The steady-state question - where the paper comes to rest relative to the fixed print
        line - needs the machine frame and printLineY, which is Gate 2's business. This build
        plays the feed as a transient one-row gesture that settles back into the page-aligned
        rest position: it cannot break "one sheet at a time" (G1) and it does not pretend to a
        geometry that has not been registered. The UI-integration build changes the rest
        position, not this code path.
     2. landFeed() - shared by the two INSTANT paths (P01 reverse, P02 page switch). It never
        animates; it only guarantees a running feed cannot outlive them.
     3. Nothing else may move the paper. */
  var feedTimer = null;

  function feedTiming() {
    var ms = 90, ease = "cubic-bezier(.2,0,0,1)";
    try {
      var cs = getComputedStyle(document.documentElement);
      var v = parseFloat(cs.getPropertyValue("--feed-ms"));
      if (isFinite(v) && v > 0) ms = v;
      var e = (cs.getPropertyValue("--feed-ease") || "").trim();
      if (e) ease = e;
    } catch (err) { /* keep the fallbacks: an animation must never be able to break input */ }
    return { ms: ms, ease: ease };
  }

  function landFeed() {
    if (feedTimer) { window.clearTimeout(feedTimer); feedTimer = null; }
    if (!el.paper) return;
    el.paper.style.transition = "none";
    applyPaperFeed(0);
  }

  /* The animated feed: the sheet sits one line lower than its rest position for an instant and
     travels up into it. Rest is already the new row, so the animation ends exactly on the layout
     value - no jump, and no layout property is ever animated (R4 §7.8). */
  function feedForwardLine() {
    var paper = el.paper;
    if (!paper) return;
    var t = feedTiming();
    landFeed();                                              /* a new target wins outright */
    paper.style.transition = "none";
    paper.style.transform = "translateY(" + (paperFeedPx(0) + ROW_PX) + "px)";  /* one row back */
    void paper.offsetHeight;                                 /* commit the start value */
    paper.style.transition = "transform " + t.ms + "ms " + t.ease;
    applyPaperFeed(0);
    feedTimer = window.setTimeout(function () {
      feedTimer = null;
      paper.style.transition = "none";
      applyPaperFeed(0);
    }, t.ms + 20);
  }

  /* ---- R4 §1 print-head visibility ----------------------------------------------------
     Active <=> no selection AND offset === value.length  (the LOCKED formula; "the caret is
     on the last visual line" is explicitly forbidden as a substitute), plus the Y-1 condition
     that the window is showing the caret's page. Visibility never grants mechanical feedback:
     a paste at the end leaves the head Active and stays silent (§1.2). */
  function updatePrintHead(info) {
    var head = el.printHead;
    if (!head) return;
    var ta = el.editor;
    var active = false;
    if (ta && !state.help) {
      var empty = ta.selectionStart === ta.selectionEnd;
      var atEnd = empty && ta.selectionStart === ta.value.length;
      /* Y-1 (provisional): the caret's row must have come OUT of the machine. The rows that
         count are the shown sheet's, up to the one standing at the print line; anything below
         that is still inside the machine. */
      var pageStartHead = state.viewSheet * ROWS_PER_SHEET;
      var viewOnCaret = !Y1_ACTIVE_NEEDS_VIEW_ON_CARET ||
                        (info.row >= pageStartHead && info.row <= viewRow());
      active = atEnd && viewOnCaret;
    }
    head.style.setProperty("--print-head-col", String(info.colUnits || 0));
    document.documentElement.setAttribute("data-print-head", active ? "active" : "hidden");
  }

  /* ---- R4 §5 page-counter window ------------------------------------------------------
     AA/BB, two digits each; a blank document shows 01/01; either value over 99 shows E1/E1
     (Y-4 provisional). BB comes from the layout that just ran, never from an estimate of how
     many characters fit (§5.2).

     §5.3 has two cases that must not be confused:
       * writing  -> AA is the page being written on (the caret's page), even when the view is
                     clamped to the last full sheet at the end of a partial document;
       * browsing -> AA is the page the WINDOW shows, by default that of its top visible row
                     (Y-5 provisional).
     "The user is browsing" is state.viewBrowsing, not "the view differs from the caret page":
     the clamp makes those two differ without anybody browsing. */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function counterValues() {
    var total = Math.max(1, totalRows());
    var sheets = Math.max(1, Math.ceil(total / ROWS_PER_SHEET));
    var page;
    if (state.viewBrowsing) {
      page = Y5_AA_IS_TOP_VISIBLE_ROW
        ? (Math.floor(viewRow() / ROWS_PER_SHEET) + 1)
        : (state.viewSheet + 1);
    } else {
      page = state.sheet + 1;
    }
    if (page < 1) page = 1;
    if (page > sheets) page = sheets;
    return { aa: page, bb: sheets };
  }

  function counterText(v) {
    if (v.aa > 99 || v.bb > 99) {
      return Y4_COUNTER_OVERFLOW_ALL ? "E1/E1" : (pad2(Math.min(v.aa, 99)) + "/E1");
    }
    return pad2(v.aa) + "/" + pad2(v.bb);
  }

  function updateCounter() {
    var v = (state.help && state.helpCounter) ? state.helpCounter : counterValues();
    var text = counterText(v);
    if (el.pageCounter && el.pageCounter.textContent !== text) el.pageCounter.textContent = text;
    document.documentElement.setAttribute("data-page", text);
  }

  /* ================================================= 3a. paper colophon (1.1.1)
     "WORD ΚΑΛΛΙΌΠΗ BY VIC" is centred in the paper's bottom margin: 80% of the document type
     size, fixed black, in the document's own font stack. Both values are document measurements,
     so the mark scales with the paper and only needs re-placing when document ZOOM changes. It
     is chrome, not document content: nothing is written anywhere, and being inside .stage it is
     hidden by @media print, so Print, EXPORT PDF, the TXT and Recovery never see it. */
  var PAPER_MARK_CENTRE = 1008;  /* centre of the 1in bottom margin, in document px from the paper top */
  var PAPER_MARK_SIZE = 12.8;    /* 80% of the 16px document type size */

  function updatePaperMark() {
    var m = el.paperMark;
    if (!m) return;
    /* [1.1.6.1] The colophon is printed on the SHEET. It now sits inside the scaled throat, so
       its geometry is document px and must NOT be multiplied by the zoom any more - the parent
       scale does that once. It therefore also travels with the paper, like any other printed
       mark, and at the r1 throat it spends the whole run below the machine throat (P05 is still
       open on whether the paper colophon survives at all). */
    m.style.fontSize = PAPER_MARK_SIZE + "px";
    m.style.top = PAPER_MARK_CENTRE + "px";
    m.style.display = "block";
  }

  /* ================================================= 3b. rail marks (1.1.1)
     Two black triangles marking the visual line the caret is on (PM rail revision ruling):
     the left one points right, its tip eight character cells left of the first character cell
     of that visual line; the right one points left, its tip six character cells right of the
     last character cell. Both gaps are document measurements, so they scale with the text. Both are
     4x8 CSS px - half of the 8x16px Latin document cell - vertically centred on the line, and
     both are hidden whenever that line holds no character.

     READ-ONLY by ruling (§11): everything below only reads the existing editing state and
     computes screen positions from it. It never writes the textarea value, never touches the
     semantic text, pagination, AUTO RETURN, IME, undo, selection or the caret itself, and it
     creates no document state - the marks are presentation and stay out of TXT, Recovery,
     SAVE, Print and PDF. Layout is never affected: both marks are absolutely positioned chrome.
     Sizes and gaps are screen-space measurements and never scale with document ZOOM; only the
     position follows the paper, so applyZoom() re-runs this function. */
  var RAIL_LEFT_CELLS = 8;     /* left triangle's right tip -> first character cell, in cells */
  var RAIL_RIGHT_CELLS = 6;    /* last character cell -> right triangle's left tip, in cells */
  var RAIL_W = 4;              /* half of the 8px Latin cell width   */
  var RAIL_H = 8;              /* half of the 16px Latin cell height */
  var RAIL_MARGIN_PX = 96;     /* 1in paper margin: the text column's left edge */
  var RAIL_UNIT_PX = 8;        /* one document unit = 8px (12 CPI) */

  function railRow(info) {
    /* The visual row the caret is on. locate() resolves a caret sitting exactly on a soft
       wrap boundary to the earlier row (the convention the AUTO RETURN guard uses); engines
       draw such a caret at the start of the following row, so the mark follows the caret
       instead. locate() itself is left untouched. */
    var layout = state.layout, rows = layout.rowsPerLine[info.line];
    var base = layout.lineStartRow[info.line];
    var k = info.row - base;
    var r = rows[k];
    var colUnits = info.colUnits;
    if (r && k + 1 < rows.length && info.inLine === r.end && info.inLine < info.lineText.length &&
        rows[k + 1].start === r.end) {
      k = k + 1;
      r = rows[k];
      colUnits = 0;                 /* a caret on a soft-wrap boundary sits at the next row's start */
    }
    return { row: base + k, rowData: r, colUnits: colUnits };
  }

  function updateRailMarks() {
    var left = el.railLeft, right = el.railRight;
    if (!left || !right) return;
    /* [2026-10-16] These marks belong to the WPS (1.1.5.2) view; the skeuomorphic view has the
       delivered machine instead and hides them in CSS. Bail out BEFORE writing geometry: measured
       2026-10-16, the chrome that was not on screen still cost ~25 style writes per 10 keystrokes. */
    if (!state.wps) return;
    if (!el.editor || !state.layout) { left.style.display = right.style.display = "none"; return; }
    var info = locate(state.layout, el.editor.selectionStart || 0);
    var pick = railRow(info);
    var r = pick.rowData;
    if (!r) { left.style.display = right.style.display = "none"; return; }
    /* [1.1.6.1] The marks are screen chrome drawn on the sheet, so they follow the sheet: a row
       is on screen when it belongs to the sheet the throat is showing AND has already come out
       of the machine, i.e. it is not below the row standing at the print line. The row at the
       print line sits at PRINT_LINE_TOP_PX in the stage, so a row's screen position is that
       constant plus its distance from the print-line row. */
    if (!rowVisibleOnSheet(pick.row)) {
      left.style.display = right.style.display = "none";
      return;
    }
    /* An empty visual line keeps the leading mark only (2026-10-06 amendment to the rail
       ruling §7): the caret is still on that line, so the line is marked at its start, while
       the trailing mark has no last character cell to sit after. */
    var z = currentZoom();
    var xFirst = RAIL_MARGIN_PX * z;                               /* first cell's left edge */
    var yCentre = (rowTopPx(pick.row) + ROW_PX / 2) * z;           /* line's vertical centre */
    /* eight character cells in DOCUMENT space: the gap grows with document ZOOM, so the mark
       always reads as eight characters away from the row's first cell (PM 2026-10-06) */
    left.style.left = (xFirst - RAIL_LEFT_CELLS * RAIL_UNIT_PX * z - RAIL_W) + "px";
    left.style.top = (yCentre - RAIL_H / 2) + "px";
    left.style.display = "block";
    if (r.units <= 0) { right.style.display = "none"; return; }
    var xLast = (RAIL_MARGIN_PX + r.units * RAIL_UNIT_PX) * z;     /* last cell's right edge */
    /* six character cells in DOCUMENT space, like the left gap (PM 2026-10-06) */
    right.style.left = (xLast + RAIL_RIGHT_CELLS * RAIL_UNIT_PX * z) + "px";
    right.style.top = left.style.top;
    right.style.display = "block";
  }


  /* ================================================= 3c. typewriter position line (1.1.1)
     A red underline six character cells long ending exactly at the caret - the typewriter's
     carriage rail - plus a second segment starting 1 cell to the right of the caret and 3
     cells long. Both lengths are FIXED: near the start of a row the left part is neither
     shortened nor hidden and runs on into the paper's left margin; near the end of a row the
     right part does the same into the right margin (PM 2026-10-06). They are hidden only when
     there is no insertion point to mark (editor unfocused or a selection is active). Same read-only geometry and the same two hooks as the rail marks
     (syncSheet / applyZoom) - no text is written, no state is created, no layout is affected. */
  var TYPE_LINE_CELLS = 6;     /* six character cells long, in document units */
  var MASK_W = 2;              /* the caret patch's width, in document px (1.1.5.2 value) */
  var TYPE_LINE_H = 2;         /* rail thickness, in document px */
  var TYPE_TICK_W = 2;         /* graduation stroke width, in document px */
  var TYPE_TICK_LONG_CELLS = 2;  /* full-character-height tick, this many cells left of the caret */
  var TYPE_TICK_SHORT_CELLS = 4; /* half-height tick, this many cells left of the caret */
  var TYPE_LINE_R_RIGHT_CELLS = 3;   /* right segment length, in cells, after the caret */
  var TYPE_LINE_R_GAP_CELLS = 1;     /* gap between the caret and the right segment, in cells */

  function updateTypeLine() {
    var g = el.typeLine, gr = el.typeLineRight, mask = el.caretMask;
    /* same rule as updateRailMarks(): WPS-only chrome, no writes while it is out of the way */
    if (!state.wps) return;
    /* the rail is two rows only: the caret's own row and the row two rows above it, so one
       empty row separates them (PM 2026-10-06: the middle row was removed) */
    var leftBars = [[el.typeLine, 0], [el.typeLineUp2, 2]];
    var rightBars = [[el.typeLineRight, 0], [el.typeLineRightUp2, 2]];
    function hideAll() {
      leftBars.concat(rightBars).forEach(function (p) {
        if (p[0]) p[0].style.display = "none";
      });
      if (mask) mask.style.display = "none";
    }
    if (!g || !gr || !el.editor || !state.layout || document.activeElement !== el.editor ||
        el.editor.selectionStart !== el.editor.selectionEnd) { hideAll(); return; }
    var pick = railRow(locate(state.layout, el.editor.selectionStart || 0));
    /* [1.1.6.1] same rule as the rail marks: the carriage rail belongs to a row that is out of
       the machine on the sheet the throat is showing, so a caret that browsing has taken off
       that sheet - or below the print line - hides the whole rail. */
    if (!rowVisibleOnSheet(pick.row)) { hideAll(); return; }
    var z = currentZoom();
    var colTop = rowTopPx(pick.row);
    var xRight = (RAIL_MARGIN_PX + pick.colUnits * RAIL_UNIT_PX) * z;   /* the caret itself */
    var lineTop = (colTop + ROW_PX) * z;                 /* the carriage line's own row */
    var h = (TYPE_LINE_H * z) + "px";
    /* ONE integrated rail: the caret's row and the row two above it, left segment ... */
    var leftX = (xRight - TYPE_LINE_CELLS * RAIL_UNIT_PX * z) + "px";
    var leftW = (TYPE_LINE_CELLS * RAIL_UNIT_PX * z) + "px";
    leftBars.forEach(function (p) {
      var b = p[0];
      if (!b) return;
      b.style.left = leftX;
      b.style.top = (lineTop - p[1] * ROW_PX * z) + "px";
      b.style.width = leftW;
      b.style.height = h;
      b.style.display = "block";
    });
    /* ... and the matching right segment on the same two rows. The upper row may fall inside
       the paper's top margin; that is intended, so nothing is clipped or suppressed. */
    var rightX = (xRight + TYPE_LINE_R_GAP_CELLS * RAIL_UNIT_PX * z) + "px";
    var rightW = (TYPE_LINE_R_RIGHT_CELLS * RAIL_UNIT_PX * z) + "px";
    rightBars.forEach(function (p) {
      var b = p[0];
      if (!b) return;
      b.style.left = rightX;
      b.style.top = (lineTop - p[1] * ROW_PX * z) + "px";
      b.style.width = rightW;
      b.style.height = h;
      b.style.display = "block";
    });
    /* the two graduations belong to the caret's own row only (children of that bar) */
    var long = el.typeTickLong, short = el.typeTickShort;
    if (long && short) {
      var len = TYPE_LINE_CELLS * RAIL_UNIT_PX;
      long.style.left = (len - TYPE_TICK_LONG_CELLS * RAIL_UNIT_PX - TYPE_TICK_W / 2) * z + "px";
      short.style.left = (len - TYPE_TICK_SHORT_CELLS * RAIL_UNIT_PX - TYPE_TICK_W / 2) * z + "px";
      long.style.width = short.style.width = (TYPE_TICK_W * z) + "px";
      long.style.height = (ROW_PX * z) + "px";
      short.style.height = (ROW_PX / 2 * z) + "px";
    }
    /* [2026-10-16] V24 retired the paper-coloured patch in the skeuomorphic view (the native
       caret is the visible one there). WPS mode IS the 1.1.5.2 page view, so there the patch is
       back where 1.1.5.2 had it: it covers the native caret (caret-color:transparent) and the
       carriage rail marks the position instead. */
    if (mask) {
      if (state.wps) {
        mask.style.left = ((RAIL_MARGIN_PX + pick.colUnits * RAIL_UNIT_PX) * z) + "px";
        mask.style.top = (rowTopPx(pick.row) * z) + "px";
        mask.style.width = (MASK_W * z) + "px";
        mask.style.height = (ROW_PX * z) + "px";
        mask.style.display = "block";
      } else {
        mask.style.display = "none";
      }
    }
  }

  function onCaretMoved() { syncSheet(false); }

  function onInput() {
    var oldLen = state.inkLen || 0;
    relayout();
    noteEdit(oldLen);
    state.inkLen = document_text().length;
    syncSheet(false);
    syncInk(false);
    /* [1.1.6.1] The sound and the feed are judged here, after the layout is current and the
       pre-edit snapshot can be compared with the result (R1-T05: whether an Enter crossed a
       page is only knowable once the engine has inserted it). */
    mechanicalFeedback();
    scheduleRecoveryCheck();
  }

  /* ------------------------------------------------------------ input guards */

  /* Insert through the browser's own editing path so the native undo stack stays
     intact (trap: assigning .value destroys it). The result is verified, because a
     platform may report success without inserting anything - the typed characters
     must never be silently dropped. */
  function insertText(str) {
    var ta = el.editor;
    if (!ta) return;
    var before = ta.value;
    var s = ta.selectionStart, e = ta.selectionEnd;
    ta.focus();
    var done = false;
    try { done = document.execCommand("insertText", false, str); } catch (err) { done = false; }
    if (!done || ta.value === before) {
      /* Data integrity first: the text still lands even if this path loses undo. */
      try { ta.setRangeText(str, s, e, "end"); } catch (err2) { ta.value = before; }
      onInput();
    }
  }

  /* [1.1.6.1] Will this keystroke change the document? Only then is the pre-edit snapshot
     refreshed at keydown; composition is excluded because S03 keeps its own path, and every
     OS shortcut is excluded because a shortcut is not typing (S02). */
  var EDIT_SNAPSHOT_KEYS = { Enter: 1, Backspace: 1, Delete: 1, Tab: 1 };

  function keyWillEdit(e) {
    if (e.isComposing || e.keyCode === 229) return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (typeof e.key === "string" && e.key.length === 1) return true;
    return EDIT_SNAPSHOT_KEYS[e.key] === 1;
  }

  function onKeyDown(e) {
    /* §H the editor is disabled while HELP is up, so this listener should not fire; it is
       kept as the second net so that no keystroke can ever reach the document in that state. */
    if (state.help) return;
    if (e.defaultPrevented) return;

    /* [1.1.6.1 R4 §2.3] The input moment: browsing ends and, if the view is showing another
       sheet, it returns to the caret BEFORE anything judges this keystroke - so the first key
       after a browse is treated exactly like normal writing and is never silently swallowed.
       The pre-edit snapshot for the eligibility test is taken here too: at keydown the
       document has not changed yet, which is the only moment the formula's "no selection" and
       "caret at the end" can be answered (R4 §4.2). The snapshot is only refreshed for keys
       that will actually edit, so a stale arrow-key snapshot can never be spent on a later
       insertion. */
    inputMoment();
    if (keyWillEdit(e)) takeEditSnapshot();

    /* §23 a keyboard action triggers the typing sound, including while a Chinese
       IME is composing: do not wait for the commit. */
    playForKeystroke(e);

    if (e.key === "Tab") {                       /* §22 TAB = 4 units, no tab stops */
      var t = caretInfo();
      if (t.atLineEnd && !state.autoReturn && t.colUnits + UNITS_PER_TAB > UNITS_PER_ROW) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      insertText("    ");
      return;
    }

    /* §18 never intercept composition. */
    if (e.isComposing || e.keyCode === 229) return;
    /* Leave every shortcut with the operating system (§20). */
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    /* [2026-10-16, VIC - Y-2 settled] Page Up / Page Down look at the document one WHOLE PAGE at
       a time (the same action as the two Primary Controls). They stay modern navigation: silent,
       instant, no feed, and the caret never moves. The engine cannot do this here: with the
       control sized to the whole document and clipped it computes its paging step from a viewport
       it does not have, and on Safari it moved neither the caret nor the page. Deliberately placed
       AFTER the composition guard so an IME candidate list keeps its own Page Up / Page Down. */
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      pageFlip(e.key === "PageDown" ? 1 : -1);
      return;
    }

    if (e.key.length === 1 && !state.autoReturn) {
      var info = caretInfo();
      var w = unitsOfCodePoint(e.key.codePointAt(0));
      /* §16 AUTO RETURN OFF: after 78 units normal keyboard character input stops
         and waits for ENTER. Only sequential typing at the margin is stopped; editing
         earlier in the document is never blocked and nothing is ever truncated. */
      if (info.atLineEnd && info.colUnits + w > UNITS_PER_ROW) {
        e.preventDefault();
      }
    }
  }

  /* §16 AUTO RETURN OFF, second net. Only an ordinary character insertion is limited:
     insertFromPaste / insertFromDrop are exempt (§19), insertCompositionText is exempt
     (§18 never intercept composition). */
  function onBeforeInput(e) {
    /* [1.1.6.1] beforeinput is the one hook every insertion path passes through, including
       the ones with no keydown of ours (paste, drop, IME commit): the browse state ends and
       the view returns to the caret here, before the edit is judged. */
    if (!e.defaultPrevented) inputMoment();
    /* The browser's own classification of this edit, and the pre-edit snapshot, are recorded
       here: this is the last moment before the document changes. inputType is what separates
       a real keystroke (insertText / insertParagraph / insertLineBreak) from paste, drop and
       undo, which may never sound or feed whatever the caret does (R4 §4.2). */
    state.lastInputType = e.inputType || "";
    state.lastInputData = e.data || "";
    if (!e.isComposing) takeEditSnapshot();
    if (state.autoReturn || e.defaultPrevented || e.isComposing) return;
    if (e.inputType !== "insertText") return;
    var data = e.data || "";
    if (!data) return;
    var info = caretInfo();
    if (info.atLineEnd && info.colUnits + unitsOfText(data) > UNITS_PER_ROW) e.preventDefault();
  }

  /* ============================================================ 4. zoom (§34) */

  function fitZoom() {
    var vv = window.visualViewport;
    var vw = vv ? vv.width : document.documentElement.clientWidth;
    var vh = vv ? vv.height : document.documentElement.clientHeight;
    var chrome = (el.bar ? el.bar.offsetHeight : 0) + 36;
    /* [1.1.6.1 UI integration] The frame is what has to fit: it is 1230.21 x 1092.10 document px
       around an 816 x 1056 sheet, so fitting only the sheet would push the machine's lower edge and
       its 207.11px left overhang off screen (and the page must never scroll - R10). This is also
       the delivery's own budget: (viewport height - 81) / 1092.098. */
    /* [2026-10-16] WPS mode has no machine, so FIT fits the PAPER again - exactly the 1.1.5.2
       formula the field is used to. */
    var z = Math.min((vw - 36) / (state.wps ? PAPER_W : MACHINE_W),
                     (vh - chrome) / (state.wps ? PAPER_H : MACHINE_H));
    if (!isFinite(z) || z <= 0) z = 1;
    return Math.max(0.25, Math.min(2, z));
  }

  function currentZoom() {
    var v = ZOOM_STEPS[state.zoomIndex].value;
    return v === null ? fitZoom() : v;
  }

  /* Document geometry and viewport scale are independent (§34): zoom is a screen
     transform only, it never reaches the print DOM. */
  function applyZoom() {
    var z = currentZoom();
    /* [1.1.6.1 UI integration] The zoom moved one more level up: it is now a transform on the
       machine FRAME, the single box that holds the rear layer, the sheet (whose .paper keeps its
       own feed translate, so nothing fights it), the throat, the print head, the front layer and
       the page counter. Machine, sheet and chrome therefore share one scale (R4 §6.2), and the
       stage-inner reserves exactly the frame's footprint at that scale. */
    if (el.machineFrame) el.machineFrame.style.transform = "scale(" + z + ")";
    /* WPS mode reserves the paper's footprint (the frame is styled down to the sheet there) */
    el.stageInner.style.width = ((state.wps ? PAPER_W : MACHINE_W) * z) + "px";
    el.stageInner.style.height = ((state.wps ? PAPER_H : MACHINE_H) * z) + "px";
    el.btnZoom.textContent = "ZOOM " + ZOOM_STEPS[state.zoomIndex].label;
    /* 1.1.1: the rail marks keep their 4x8px size but must follow the paper's new scale */
    if (!helpHidesRails) {
      updateRailMarks();
      updateTypeLine();
    }
    updatePaperMark();
  }

  function cycleZoom() {
    state.zoomIndex = (state.zoomIndex + 1) % ZOOM_STEPS.length;
    applyZoom();
  }

  /* ======================================================= 5. paper / ribbon */

  /* §47 / §48 PAPER and RIBBON are document-global rendering state, not text
     attributes: the TXT is semantic plain text and never carries colour. The sheet
     already on screen and everything typed after the switch therefore follow the
     current ribbon together, and so does print.

     The colour is applied directly to the painting element as well as to the custom
     properties: the rendered result must not depend on custom-property invalidation
     travelling down the inheritance chain, which some engines handle unreliably. */
  function applyColors() {
    var paper = PAPER_COLORS[state.paperIndex].value;
    var ribbon = RIBBON_COLORS[state.ribbonIndex].value;
    var root = document.documentElement;
    root.style.setProperty("--paper-color", paper);
    root.style.setProperty("--ribbon-color", ribbon);
    /* both ribbon inks must be available at once: the paper can hold two runs (§48) */
    root.style.setProperty("--ribbon-0", RIBBON_COLORS[0].value);
    root.style.setProperty("--ribbon-1", RIBBON_COLORS[1].value);
    el.paper.style.backgroundColor = paper;
    el.paper.style.color = ribbon;                       /* fallback ink; runs paint themselves */
    el.paper.style.webkitTextFillColor = "";
    /* The editing control no longer paints glyphs: the mirror layer does, per run (§48).
       Keep the control transparent on both colour channels - otherwise it would draw a
       second copy of the text in the current ribbon colour. [1.1.6.1 V24] The caret is LIVE
       again and follows the ribbon: this inline value has to be set here rather than left to
       the stylesheet, because an inline color/style would otherwise keep overriding it - which
       is exactly how the old build kept the caret invisible. */
    if (el.editor) {
      el.editor.style.color = "transparent";
      el.editor.style.webkitTextFillColor = "transparent";
      /* [2026-10-16] WPS mode is the 1.1.5.2 page view: there the native caret was covered by
         the paper-coloured mask and the carriage rail showed the position, so the caret-colour
         assignment above must not reach it. This is an INLINE style, so the CSS rule alone
         (html[data-wps="on"] #editor) would lose to it. */
      el.editor.style.caretColor = state.wps ? "transparent" : ribbon;
    }
    if (el.ink) el.ink.style.webkitTextFillColor = "";   /* never let the layer override a run */
    el.btnPaper.textContent = "PAPER " + PAPER_COLORS[state.paperIndex].name;
    el.btnRibbon.textContent = "RIBBON " + RIBBON_COLORS[state.ribbonIndex].name;
  }

  /* ============================================================== 6. sound §24 */
  /* Audio is feedback, never logic (§25): the edit never waits for it, every
     rejection is swallowed, and any subset of the files may be missing.

     1.1.2 reworks HOW a hit is started, and widens the set from three slots to four.
     The SOUND ON/OFF control is unchanged. Measured on the 1.1.1 code (Safari 27,
     file://, 137 keystrokes in a burst): the three slots held 18 <audio> elements,
     the browser refused 21 play() calls and every one of those was heard as a key
     with no sound at all - 15 % of the keystrokes. The refusals come from having
     that many media elements racing, not from the sound itself. So there are two
     routes now, and the better one is tried first:

       "webaudio" - each existing file is decoded once into an AudioBuffer and a hit
                    is a fresh AudioBufferSourceNode. No media element, no pipeline
                    start-up, nothing to refuse, polyphony for free. This is the
                    route the published (http/https) build takes because it needs
                    fetch(). Measured: 278 of 278 hits started, 0 elements.
       "element"  - fallback for file://, where fetch() is refused outright: only the
                    slots whose file actually exists get voices, AUDIO_VOICES[i] each,
                    and a voice is parked back at 0 once it has ended so no seek ever
                    sits on the keystroke path. Measured: 0 refusals, 0 silent keys,
                    2.7 ms from key to sound.

     Slot 3 is the one sound that is not a keystroke: it is the sheet turning over,
     read from syncSheet() where that is already decided (§13).

     No route touches the editor, the document, the caret or any output. */
  var AUDIO_FILES = [
    "assets/audio/sound1.mp3",   /* 0  ordinary character key           */
    "assets/audio/sound2.mp3",   /* 1  space, arrows, paging, Home/End  */
    "assets/audio/sound3.mp3",   /* 2  return                           */
    "assets/audio/sound4.mp3"    /* 3  the sheet turns over - not a key */
  ];
  /* Voices per slot, sized by traffic x duration instead of one flat number: slot 0 is
     the shortest sound and takes most of the typing, slot 2 is a second long, and the
     sheet only turns over now and then. A flat 4 would mean 16 media elements once all
     four files exist, and 18 is the count at which Safari started refusing play()
     outright. This budget is 11. */
  var AUDIO_VOICES = [4, 3, 2, 2];
  var AUDIO_PARK_MS = 120;                /* element route: settle before rewinding */
  /* The 1.1.2 key->slot map (AUDIO_NAV_KEYS) lived here. 1.1.6.1 retired it: a key is no
     longer a sound decision. The four slots are chosen by mechanicalFeedback() from what the
     operation turned out to be (R4 §4.2), so space, Backspace, the arrows, paging, Home/End
     and Delete are no longer described by a table of keys - the table was what made every
     arrow audible. Slot use today: 0 character · 1 space and end-Backspace · 2 return and
     AUTO RETURN wrap · 3 the sheet turning over.
     Still open with the product side, unchanged: Tab (inserts four units, stays silent - a
     1.1.2 leftover, now recorded in the 1.1.6.1 inventory §2.4) and the -9.0 dB level set. */
  var audio = { on: true, route: "none", ctx: null, buffers: [], pools: [] };

  function newAudioEl(src) {
    var a = document.createElement("audio");
    a.preload = "auto";
    a.src = src;
    a.addEventListener("error", function () { /* missing asset: fail silently §04/§25 */ });
    document.body.appendChild(a);
    return a;
  }

  /* ---- route "webaudio": decode whatever exists, leave the rest silent (§25) ---- */
  function initWebAudio(done) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || typeof fetch !== "function") { done(false); return; }
    var ctx;
    try { ctx = new AC(); } catch (e) { done(false); return; }
    var left = AUDIO_FILES.length, live = 0;
    var finish = function () {
      if (--left > 0) return;
      if (live) { audio.ctx = ctx; done(true); }
      else { try { if (ctx.close) ctx.close(); } catch (e) {} done(false); }
    };
    for (var i = 0; i < AUDIO_FILES.length; i++) {
      (function (i) {
        fetch(AUDIO_FILES[i]).then(function (r) {
          if (!r.ok) throw new Error("http " + r.status);
          return r.arrayBuffer();
        }).then(function (buf) {
          return new Promise(function (res, rej) {
            var ret = ctx.decodeAudioData(buf, res, rej);
            if (ret && ret.then) ret.then(res, rej);
          });
        }).then(function (decoded) {
          audio.buffers[i] = decoded; live++;
        })["catch"](function () { /* missing file or refused fetch: slot stays silent */ })
          .then(finish);
      })(i);
    }
  }

  /* a voice is rewound only once it has ended, so play() never pays for a seek */
  function wireVoice(a) {
    a.addEventListener("ended", function () {
      setTimeout(function () {
        if (a.paused || a.ended) { try { a.currentTime = 0; } catch (e) {} }
      }, AUDIO_PARK_MS);
    });
  }

  function pickVoice(pool) {
    var n = pool.length;
    if (pool.__rr === undefined) pool.__rr = 0;
    var first = null;
    for (var k = 0; k < n; k++) {
      var c = pool[(pool.__rr + k) % n];
      if (c.paused || c.ended) { pool.__rr = (pool.__rr + k + 1) % n; return c; }
      if (!first) first = c;
    }
    pool.__rr = (pool.__rr + 1) % n;
    return first;
  }

  /* ---- route "element": nothing is built for a slot whose file is not there ---- */
  function initElementRoute() {
    for (var i = 0; i < AUDIO_FILES.length; i++) {
      (function (i) {
        var probe = newAudioEl(AUDIO_FILES[i]);
        var settled = false;
        var finish = function (exists) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (!exists) {
            probe.removeAttribute("src");
            if (probe.load) probe.load();
            if (probe.parentNode) probe.parentNode.removeChild(probe);
            return;                       /* dead slot: it never costs an element */
          }
          wireVoice(probe);
          audio.pools[i].push(probe);     /* the probe becomes the first voice */
          var want = AUDIO_VOICES[i] || AUDIO_VOICES[0];
          for (var v = 1; v < want; v++) {
            var el = newAudioEl(AUDIO_FILES[i]);
            wireVoice(el);
            audio.pools[i].push(el);
          }
        };
        probe.addEventListener("loadedmetadata", function () { finish(true); });
        probe.addEventListener("error", function () { finish(false); });
        var timer = setTimeout(function () { finish(false); }, 2500);
      })(i);
    }
  }

  function initAudio() {
    audio.route = "none";
    audio.buffers = [];
    audio.pools = [];
    for (var i = 0; i < AUDIO_FILES.length; i++) audio.pools.push([]);
    initWebAudio(function (ok) {
      if (ok) { audio.route = "webaudio"; return; }
      audio.route = "element";
      initElementRoute();
    });
  }

  function playSound(i) {
    if (!audio.on || audio.route === "none") return;
    try {
      if (audio.route === "webaudio") {
        var buf = audio.buffers[i];
        if (!buf) return;
        /* the context is born suspended until a gesture; a keystroke is one (§25) */
        if (audio.ctx.state === "suspended" && audio.ctx.resume) audio.ctx.resume();
        var src = audio.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(audio.ctx.destination);
        src.start();
        return;
      }
      var pool = audio.pools[i];
      if (!pool || !pool.length) return;
      var a = pickVoice(pool);
      if (a.currentTime !== 0) a.currentTime = 0;
      var p = a.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
    } catch (e) { /* §25 never let audio break input */ }
  }

  /* [1.1.6.1 S01/S02] 1.1.5.1 decided the sound at keydown from the key alone, which made
     every arrow key, every Page Up/Down and even ⌘C/⌘V audible - the sound map was consulted
     before the modifier guard, so a shortcut with a printable letter still played sound1.
     Under the locked rules the key is no longer the question: ordinary characters, space,
     Enter and Backspace are judged AFTER the edit by mechanicalFeedback() against what the
     operation actually was (§4.2), and all modern navigation and editing is silent (S02).

     The one path that stays here is the Chinese IME (S03, LOCKED: "保持 1.1.5.1 既有输入与
     声音处理行为"): a composition still plays per keystroke and still does not wait for the
     commit. It is played directly rather than through eligibility, because during composition
     the caret is not at the document end and the eligibility formula would refuse it. */
  function playForKeystroke(e) {
    if (!audio.on) return;
    if (e.isComposing || e.keyCode === 229) { playSound(SOUND_CHARACTER); return; }
    /* every other key: silent here - the edit path decides, and navigation never sounds */
  }

  /* =========================================================== 7. TXT files */

  function readFileText(file) {
    if (typeof file.text === "function") return file.text();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result)); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsText(file, "utf-8");
    });
  }

  /* §29 TXT / UTF-8 / LF. BOM is stripped, line endings normalise to LF, and a
     replacement character marks the source as unsafe to overwrite in place. */
  function normaliseOpened(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return text.replace(/\r\n?/g, "\n");
  }

  function loadDocument(text, name, opts) {
    opts = opts || {};
    state.name = name || DEFAULT_NAME;
    state.handle = opts.handle || null;
    state.safeOverwrite = opts.safeOverwrite !== false;
    buildEditor(text);
    state.savedText = text;                 /* freshly opened / created: not dirty */
    state.sheet = 0;
    state.viewSheet = 0;                    /* 1.1.6.1: a freshly loaded document shows sheet 1 */
    state.viewIntraRows = 0;
    state.viewBrowsing = false;
    positionEditor();
    applyColors();                          /* the rebuilt editor takes the live paper + ribbon */
    syncSheet(true);
  }

  function confirmDiscard() {
    /* §27 / §42 native confirmation only - never a custom modal */
    if (!isDirty()) return true;
    return window.confirm("Discard unsaved changes?");
  }

  function newDocument() {
    if (!confirmDiscard()) return;
    loadDocument("", DEFAULT_NAME, {});
    Recovery.clear();                       /* §40 NEW resets recovery */
  }

  function openDocument() {
    if (!confirmDiscard()) return;
    el.fileInput.value = "";
    el.fileInput.click();                   /* §28 browser / OS native file flow */
  }

  function onFileChosen() {
    var f = el.fileInput.files && el.fileInput.files[0];
    if (!f) return;
    readFileText(f).then(function (raw) {
      var hasReplacement = raw.indexOf("\uFFFD") !== -1;
      loadDocument(normaliseOpened(raw), f.name, { safeOverwrite: !hasReplacement });
    })["catch"](function () { /* unreadable file: fail silently, keep current text */ });
  }

  function serialise(text) {
    return text;                            /* UTF-8 / LF, written without BOM */
  }

  function downloadText(text, name) {
    var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name || DEFAULT_NAME;      /* §31 no -copy / -v2 naming */
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    window.setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 4000);
  }

  function writeToHandle(handle, text) {
    return handle.createWritable().then(function (w) {
      return w.write(new Blob([text], { type: "text/plain;charset=utf-8" }))
        .then(function () { return w.close(); });
    });
  }

  /* §30 SAVE by feature detection: update the authorised file when the platform
     allows it, otherwise use the browser's own save/download flow. Never pretend
     an unreachable original file was overwritten. */
  function saveDocument() {
    var text = serialise(document_text());
    var name = state.name || DEFAULT_NAME;

    function afterWrite() {
      state.savedText = document_text();
      Recovery.clear();                     /* §40 SAVE invalidates recovery */
    }

    if (state.handle && state.safeOverwrite && typeof state.handle.createWritable === "function") {
      writeToHandle(state.handle, text).then(afterWrite)["catch"](function () {
        downloadText(text, name);           /* fall back, do not claim success */
        afterWrite();
      });
      return;
    }

    if (state.safeOverwrite && typeof window.showSaveFilePicker === "function") {
      window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: "Text", accept: { "text/plain": [".txt"] } }]
      }).then(function (handle) {
        state.handle = handle;
        state.name = handle.name || name;
        return writeToHandle(handle, text).then(afterWrite);
      })["catch"](function (err) {
        if (err && err.name === "AbortError") return;    /* user cancelled: not saved */
        downloadText(text, name);
        afterWrite();
      });
      return;
    }

    downloadText(text, name);
    afterWrite();
  }

  /* ================================================= 8. print-only DOM §14/§32 */

  function exportPdf() {
    var layout = state.layout || computeLayout(document_text());
    var rows = flattenRows(layout);
    if (!rows.length) rows = [{ text: "", from: 0, to: 0 }];

    var sheets = Math.max(1, Math.ceil(rows.length / ROWS_PER_SHEET));
    var root = el.printRoot;
    while (root.firstChild) root.removeChild(root.firstChild);

    var frag = document.createDocumentFragment();
    for (var s = 0; s < sheets; s++) {
      var sheet = document.createElement("div");
      sheet.className = "print-sheet";
      /* print / PDF uses the current paper and ribbon colours (§32) */
      sheet.style.backgroundColor = PAPER_COLORS[state.paperIndex].value;
      sheet.style.color = RIBBON_COLORS[state.ribbonIndex].value;   /* fallback; runs paint themselves */
      var flow = document.createElement("div");
      flow.className = "print-flow";
      var from = s * ROWS_PER_SHEET, to = Math.min(rows.length, from + ROWS_PER_SHEET);
      for (var r = from; r < to; r++) {
        var row = document.createElement("div");
        row.className = "print-row";
        /* colour only: textContent of the spans is the user's text, never markup (§48) */
        var segs = rowSegments(rows[r]);
        for (var g = 0; g < segs.length; g++) {
          var cell = document.createElement("span");
          cell.className = "ink-" + (segs[g].colour ? 1 : 0);
          cell.textContent = segs[g].text;
          row.appendChild(cell);
        }
        flow.appendChild(row);
      }
      sheet.appendChild(flow);
      frag.appendChild(sheet);
    }
    root.appendChild(frag);

    var cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      window.removeEventListener("afterprint", cleanup);
      while (root.firstChild) root.removeChild(root.firstChild);
    }
    window.addEventListener("afterprint", cleanup);
    window.print();                          /* browser / OS Save as PDF §32 */
    window.setTimeout(cleanup, 120000);      /* safety net if afterprint never fires */
  }

  /* ============================================================ 9. recovery §38 */
  /* IndexedDB -> localStorage -> session memory, all by feature detection.
     Recovery is never a TXT file and never overwrites one (§40). */
  var Recovery = (function () {
    var DB_NAME = "kalliope", STORE = "draft", ID = "current", LS_KEY = "kalliope.draft";
    var mode = "memory";
    var db = null;
    var memory = null;

    function hasLocalStorage() {
      try {
        var k = "__kalliope_probe__";
        window.localStorage.setItem(k, "1");
        window.localStorage.removeItem(k);
        return true;
      } catch (e) { return false; }
    }

    function openIdb() {
      return new Promise(function (resolve, reject) {
        var settled = false, req;
        var timer = window.setTimeout(function () {
          if (!settled) { settled = true; reject(new Error("idb timeout")); }
        }, 2500);
        try { req = window.indexedDB.open(DB_NAME, 1); }
        catch (e) { window.clearTimeout(timer); reject(e); return; }
        req.onupgradeneeded = function () {
          var d = req.result;
          if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "id" });
        };
        req.onsuccess = function () {
          if (settled) return;
          settled = true; window.clearTimeout(timer); resolve(req.result);
        };
        req.onerror = function () {
          if (settled) return;
          settled = true; window.clearTimeout(timer); reject(req.error || new Error("idb error"));
        };
      });
    }

    function idbPut(rec) {
      if (!db) return;
      try {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(rec);
      } catch (e) { /* storage is optional, never fatal */ }
    }

    function idbGet() {
      if (!db) return Promise.resolve(null);
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE, "readonly");
          var rq = tx.objectStore(STORE).get(ID);
          rq.onsuccess = function () { resolve(rq.result || null); };
          rq.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }

    function lsPut(rec) {
      try { window.localStorage.setItem(LS_KEY, JSON.stringify(rec)); } catch (e) {}
    }

    function lsGet() {
      try {
        var s = window.localStorage.getItem(LS_KEY);
        return s ? JSON.parse(s) : null;
      } catch (e) { return null; }
    }

    function lsClear() {
      try { window.localStorage.removeItem(LS_KEY); } catch (e) {}
    }

    function record() {
      /* §H while the HELP sheet is up the editor is disabled, so document_text() is "":
         writing that would replace the user's draft with an empty one. Refuse instead. */
      if (state.help || !el.editor) return null;
      return { id: ID, v: 1, text: document_text(), name: state.name, ts: Date.now() };
    }

    return {
      init: function () {
        var self = this;
        return openIdb().then(function (d) {
          db = d; mode = "idb";
        })["catch"](function () {
          mode = hasLocalStorage() ? "ls" : "memory";
        }).then(function () {
          return self.read();
        });
      },
      read: function () {
        var local = mode === "ls" ? lsGet() : (hasLocalStorage() ? lsGet() : null);
        return idbGet().then(function (rec) {
          var best = rec;
          if (local && (!best || (local.ts || 0) > (best.ts || 0))) best = local;
          if (memory && (!best || (memory.ts || 0) > (best.ts || 0))) best = memory;
          return best;
        });
      },
      write: function () {
        if (!isDirty()) return;
        var rec = record();
        if (!rec) return;              /* §H the editor is closed (HELP): never store an empty draft */
        memory = rec;
        if (mode === "idb") idbPut(rec);
        /* localStorage is written as well: it is synchronous, so the newest draft
           survives an unload even when the async IndexedDB write is dropped (§39) */
        lsPut(rec);
      },
      /* §39 visibilitychange / pagehide: localStorage is synchronous, so the newest
         draft survives even when an async IndexedDB write would be dropped. */
      writeSync: function () {
        if (!isDirty()) return;
        var rec = record();
        if (!rec) return;              /* §H same guard on the synchronous path (pagehide / hidden tab) */
        memory = rec;
        lsPut(rec);
        idbPut(rec);
      },
      clear: function () {
        memory = null;
        lsClear();
        if (db) {
          try {
            var tx = db.transaction(STORE, "readwrite");
            tx.objectStore(STORE)["delete"](ID);
          } catch (e) {}
        }
      },
      mode: function () { return mode; }
    };
  })();

  var recoveryTimer = null;

  function scheduleRecoveryCheck() {
    /* the 3-minute timer is created once; edits only make the next tick useful */
    if (recoveryTimer) return;
    recoveryTimer = window.setInterval(function () { Recovery.write(); }, RECOVERY_MS);
  }

  /* ============================================================ 10. wiring */

  function bindControls() {
    /* §H while the HELP sheet is up the document controls are inert - all except ZOOM, which
       stays live so the sheet can be scaled for reading. The guard is at the event layer rather
       than only in the disabled attribute, so no handler body runs at all: nothing can change a
       setting, load a file or make a sound behind the sheet. */
    function on(btn, fn) {
      btn.addEventListener("click", function (e) {
        if (helpBlocks()) { e.preventDefault(); return; }
        fn(e);
      });
    }

    on(el.btnNew, newDocument);
    on(el.btnOpen, openDocument);
    on(el.btnSave, saveDocument);
    on(el.btnPdf, exportPdf);
    /* §H ZOOM is bound directly, NOT through on(): it keeps working while the HELP sheet is up,
       so a reader who finds the sheet too small can scale it. */
    el.btnZoom.addEventListener("click", cycleZoom);
    /* [2026-10-16] the full-page browse pair */
    if (el.btnPageUp) el.btnPageUp.addEventListener("click", function () { pageFlip(-1); });
    if (el.btnPageDown) el.btnPageDown.addEventListener("click", function () { pageFlip(1); });
    /* [2026-10-16] the WPS switch (1.1.5.2 page view <-> skeuomorphic interaction) */
    if (el.btnWps) el.btnWps.addEventListener("click", function () { applyWps(!state.wps); });

    on(el.btnReturn, function () {
      state.autoReturn = !state.autoReturn;
      el.btnReturn.textContent = "AUTO RETURN " + (state.autoReturn ? "ON" : "OFF");
      if (el.editor) el.editor.focus();
    });
    on(el.btnSound, function () {
      audio.on = !audio.on;
      el.btnSound.textContent = "SOUND " + (audio.on ? "ON" : "OFF");
      if (el.editor) el.editor.focus();
    });
    on(el.btnPaper, function () {
      state.paperIndex = (state.paperIndex + 1) % PAPER_COLORS.length;
      applyColors();
      if (el.editor) el.editor.focus();
    });
    on(el.btnRibbon, function () {
      state.ribbonIndex = (state.ribbonIndex + 1) % RIBBON_COLORS.length;
      applyColors();
      ribbonSwitch(state.ribbonIndex);   /* only what is typed next takes the new ink (§48) */
      if (el.editor) el.editor.focus();
    });

    /* §H HELP: always live - it is the only way out of the help sheet, besides ESC.
       Nothing else is touched: no sound, no recovery write, no colour change. */
    el.btnHelp.addEventListener("click", toggleHelp);

    el.fileInput.addEventListener("change", function (e) {
      if (helpBlocks()) { e.target.value = ""; return; }
      onFileChosen(e);
    });

    /* Clicking the paper outside the text column (margins, slot area) puts the typing point on
       the nearest row and cell instead of doing nothing.
       [1.1.6.1 D-4] Measured first, in Chromium 2026-10-15: a click ON the text is already
       placed exactly by the engine's own hit test - at FIT zoom (0.87) and at 100%, before and
       while browsing - so that path is deliberately left ALONE; replacing it with our own
       arithmetic would put text selection and drag-selection at risk for no gain. (The Gate 1
       PoC measured an offset in Safari; that remains a Safari item for the acceptance pass.)
       What was genuinely broken is this: a click in the paper's margin only called focus() and
       left the caret wherever it was. The mapping below uses document coordinates normalised by
       1/z, so it is correct at every zoom step, and never touches the native text path. */
    el.paper.addEventListener("mousedown", function (ev) {
      if (helpBlocks()) return;                  /* §H the sheet owns this paper now */
      if (ev.target === el.editor) return;       /* native hit test: exact, left untouched */
      var x = ev.clientX, y = ev.clientY;
      window.setTimeout(function () {
        if (!el.editor) return;
        el.editor.focus();
        placeCaretFromPaperPoint(x, y);
      }, 0);
    });

    /* ================= 1.1.6.1 wheel browsing and browse suppression (R4 §2.2/§2.4, D-1)
       The listener is registered with an explicit { passive: false }: Safari treats a
       document-level wheel listener as passive otherwise, preventDefault is ignored, the page
       scrolls as well and every displacement happens twice. It is bound on the document, not
       on the sheet, so the wheel browses wherever the pointer is inside the machine. */
    try { document.addEventListener("wheel", onWheel, { passive: false }); }
    catch (errWheel) { document.addEventListener("wheel", onWheel, false); }

    /* Any key ends a browse window at once, so the suppression can never swallow a genuine
       navigation (a lost keyup cannot wedge it either - the window is only a timestamp).
       keyup deliberately does NOT clear it: the stray keyup that belongs to the browsing
       gesture itself is exactly the path that used to pull the view back (D-1). */
    document.addEventListener("keydown", function () { if (!helpBlocks()) browseClear(); }, true);
    document.addEventListener("click", function () { if (!helpBlocks()) browseClear(); }, true);

    /* §34/§36 FIT follows the viewport */
    var pending = false;
    function onViewportChange() {
      if (pending) return;
      pending = true;
      window.requestAnimationFrame(function () {
        pending = false;
        if (ZOOM_STEPS[state.zoomIndex].value === null) applyZoom();
      });
    }
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", onViewportChange);
      window.visualViewport.addEventListener("scroll", onViewportChange);
    }

    /* §H ESC closes the help sheet. Capture phase, because focus is not inside the editor
       while the sheet is up. It is the only key this listener accepts, and it does nothing
       at all when the sheet is not showing. */
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!state.help) {
        /* [2026-10-16] Escape also backs out of the full-page view */
        if (state.pageView) { e.preventDefault(); exitPageView(); }
        return;
      }
      e.preventDefault();
      state.help = false;
      applyHelpMode(false);
    }, true);

    /* §42 unsaved work: browser-native unload confirmation where available */
    window.addEventListener("beforeunload", function (e) {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = "";
      return "";
    });

    /* §39 additional recovery triggers */
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") Recovery.writeSync();
    });
    window.addEventListener("pagehide", function () { Recovery.writeSync(); });
  }

  /* ============================== 11. grid capability guard (§04 / §06)

     The two runtime fonts are expected assets. This is a light capability check only -
     document.fonts.check() is not a glyph measurement engine, and no geometry is changed.
     When a slot is not usable the document still opens, edits, prints and saves; what is
     withdrawn is AUTO RETURN OFF, because OFF is defined against the exact 78-unit grid
     and must not pretend to be reliable when the grid cannot be guaranteed. No new UI:
     the existing AUTO RETURN control simply stays in its native disabled state. */
  function guardGrid() {
    /* document.fonts.check() is NOT usable here: it answers "would this text render", and for a
       family that does not exist at all it still reports true (a system font would render it).
       What we need is whether OUR declared runtime faces are present and loaded, which is what
       the FontFace status gives us - a status query, not glyph measurement. */
    var latin = false, cjk = false, declared = false;
    try {
      if (document.fonts && document.fonts.forEach) {
        declared = true;
        document.fonts.forEach(function (f) {
          var fam = String(f.family || "").replace(/^["']|["']$/g, "");
          if (fam === "KalliopeLatin" && f.status === "loaded") latin = true;
          if (fam === "KalliopeCJK" && f.status === "loaded") cjk = true;
        });
      }
    } catch (e) { declared = false; }
    var exact = !!(declared && latin && cjk);
    document.documentElement.setAttribute("data-grid", exact ? "exact" : "degraded");
    if (exact) return;
    state.autoReturn = true;
    el.btnReturn.textContent = "AUTO RETURN ON";
    el.btnReturn.disabled = true;      /* OFF is not offered: it cannot be honoured reliably */
  }

  /* ============================================================== 12. start */

  function start() {
    cacheElements();
    buildHelpSheet();          /* §H build the read-only sheet once, into the existing paper */
    /* build markers: <html data-build> from this script, <html data-css> from style.css */
    var cssBuild = "";
    try {
      cssBuild = getComputedStyle(document.documentElement).getPropertyValue("--build").trim();
    } catch (e) { cssBuild = ""; }
    document.documentElement.setAttribute("data-build", APP_BUILD);
    document.documentElement.setAttribute("data-css", cssBuild || "unknown");
    /* visible build identifier (browser chrome only - not a product control) */
    document.title = "Word Καλλιόπη — " + APP_BUILD;
    bindControls();
    initAudio();
    loadDocument("", DEFAULT_NAME, {});       /* §27 empty document, page 1, line 1 */
    applyColors();
    applyZoom();
    scheduleRecoveryCheck();

    /* the first paint settles the viewport metrics; FIT follows them (§36) */
    var refit = function () {
      if (ZOOM_STEPS[state.zoomIndex].value === null) applyZoom();
    };
    window.requestAnimationFrame(refit);
    window.addEventListener("load", refit);

    /* warm the runtime fonts first, then run the grid capability guard on the settled state */
    var warm = [];
    if (window.FontFace && document.fonts && document.fonts.load) {
      try {
        warm.push(document.fonts.load('16px KalliopeLatin', "M")["catch"](function () {}));
        warm.push(document.fonts.load('16px KalliopeCJK', "\u4E2D")["catch"](function () {}));
      } catch (e) {}
    }
    Promise.all(warm).then(function () {
      if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
        document.fonts.ready.then(function () {
          window.setTimeout(guardGrid, 0);
        }, function () { guardGrid(); });
      } else {
        guardGrid();
      }
    });

    /* §40 a recovery draft may be restored into the editor; it never touches a file */
    Recovery.init().then(function (rec) {
      if (rec && typeof rec.text === "string" && rec.text.length && !isDirty()) {
        state.name = rec.name || DEFAULT_NAME;
        buildEditor(rec.text);
        state.savedText = "";               /* recovered text is not saved anywhere */
        syncSheet(true);
      }
    })["catch"](function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
