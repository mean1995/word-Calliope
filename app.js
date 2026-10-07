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
  var MARGIN_UNITS = 70;                  /* end-of-line warning state     §15 */
  var RECOVERY_MS = 3 * 60 * 1000;        /* §38 */
  var SHEET_PX = ROWS_PER_SHEET * ROW_PX; /* 864 */
  var PAPER_W = 8.5 * 96, PAPER_H = 11 * 96;
  /* ---------------------------------------------------------------- paper feed (1.1.4)
     A sheet is a sheet, not a viewport: it rises out of the machine from below, and the
     printing point - the carriage line - never moves. The visible height of the paper above
     that line is FEED_MIN while the caret is on the sheet's first row, and grows by exactly
     one row for every row the caret advances, up to FEED_MAX on the sheet's last row.
     FEED_OUT is the whole sheet: the state a finished page reaches - bottom margin and the
     colophon included - before the next sheet is fed in. All four are DOCUMENT measurements
     (§10), so document ZOOM scales them; nothing here is a screen-space constant. */
  var FEED_MIN = 96 + ROW_PX;                    /* 112  = 1in top margin + the caret's row */
  var FEED_MAX = 96 + ROWS_PER_SHEET * ROW_PX;   /* 960  = caret on the sheet's last row    */
  var FEED_OUT = PAPER_H;                        /* 1056 = the whole sheet out              */
  var SHEET_OUT_MS = 650;                        /* how long a finished sheet stays out     */
  /* The seam between two sheets in the stack: a visible gap, so a page break reads as a page
     break instead of an endless scroll. A DOCUMENT measurement like the rest of the paper
     geometry (§10), so it scales with ZOOM: 9.3px at FIT, 12px at 100%, 18px at 150%.
     Ruled 2026-10-08: a few px to ten-odd px, only needs to be visible. */
  var SHEET_GAP = 12;
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
  var APP_BUILD = "1.1.4";

  /* ------------------------------------------------------------------- elements */
  var el = {};

  function cacheElements() {
    el.bar = document.getElementById("bar");
    el.stage = document.getElementById("stage");
    el.stageInner = document.getElementById("stage-inner");
    el.paper = document.getElementById("paper");
    el.window = document.getElementById("sheet-window");
    /* 1.1.4: the platen window holds the finished sheets that stay in the machine */
    el.sheetLayer = document.querySelector(".platen");
    el.machineLogo = document.querySelector(".machine-logo");
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
  }

  /* ---------------------------------------------------------------------- state */
  var state = {
    name: DEFAULT_NAME,
    handle: null,          /* FileSystemFileHandle when the platform grants one  §30 */
    safeOverwrite: true,   /* false once U+FFFD was seen on OPEN                 §29 */
    savedText: "",         /* value at the last SAVE / OPEN / NEW                   */
    sheet: 0,              /* the sheet the caret is on: the EDITABLE one           §13 */
    /* 1.1.4 (ruled 2026-10-08 §1/§2): how much paper exists is the document's business, not
       the caret's. `outSheet` only ever holds a sheet that is being rolled out as part of a
       forward sheet change - null the rest of the time, including while the caret is moved
       back into paper that is already out. */
    outSheet: null,        /* the finished sheet being rolled out, or null          1.1.4 */
    outAt: 0,              /* when that roll-out started, for the 650ms dwell       1.1.4 */
    layout: null,
    autoReturn: true,      /* §16 */
    zoomIndex: 0,
    paperIndex: 0,
    ribbonIndex: 0
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
    /* a fresh document: sheet 1, and no sheet change in flight (1.1.4) */
    state.sheet = 0;
    state.outSheet = null;
    positionEditor();
    syncInk(true);
    try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
  }

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
    ta.addEventListener("focus", onCaretMoved);
    ta.addEventListener("select", onCaretMoved);
    ta.addEventListener("blur", onCaretMoved);
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

  function positionEditor() {
    if (!el.flow) return;
    /* the editable sheet is liveSheet(): while a finished sheet is on its way out (1.1.4) the
       paper still holds THAT sheet's rows, so the flow must not move yet */
    el.flow.style.top = (-(liveSheet() * SHEET_PX)) + "px";
    resetScroll();
  }

  /* ---------------------------------------------------------------- paper feed (1.1.4)
     RULED 2026-10-08 (§1, §3): the caret says WHERE THE USER IS EDITING; the laid-out document
     says HOW MUCH PAPER EXISTS and how far it has been fed. Two different things, and keeping
     them apart is what makes "go back and fix a line on page 1" behave:

       - moving the caret back never retracts the roll, never removes a sheet and never replays
         a sheet change (§2);
       - every page the document actually has is on the roll, whether the caret is in it or not
         (§4, §9);
       - paper still feeds upward while writing at the document frontier, so the machine keeps
         its behaviour exactly where it was designed to have it (§5, §6).

     The frontier is a pure function of the document's own extent - never of the caret. */
  function documentRows() {
    if (!state.layout) relayout();
    var n = state.layout ? state.layout.totalRows : 1;
    return n > 0 ? n : 1;                            /* an empty document is one empty line */
  }

  function frontier() {
    var last = documentRows() - 1;                   /* the last visual row of the document */
    var sheet = Math.floor(last / ROWS_PER_SHEET);
    return { sheet: sheet, feed: FEED_MIN + (last - sheet * ROWS_PER_SHEET) * ROW_PX };
  }

  /* The sheet whose paper is the editable one: normally the caret's sheet, and while a finished
     sheet is being rolled out, that finished sheet (§7). */
  function liveSheet() {
    return state.outSheet === null ? state.sheet : state.outSheet;
  }

  /* One geometry for everything on screen:
       sheets : the highest sheet index that exists on the roll (the frontier, or the sheet
                being rolled out during a sheet change)
       feed   : how far THAT sheet has come out, in document px above the printing line
       docH   : the machine box in document px - one full band per sheet plus the visible part
                of the last one, with one page as the floor so the first sheet stands in an
                empty machine
       platen : the printing line, in screen px from the box's top
       live   : the sheet whose paper is the editable one */
  function feedGeometry(z) {
    var f = frontier();
    var out = state.outSheet;
    var sheets = out === null ? f.sheet : out;
    var feed = out === null ? f.feed : FEED_OUT;
    var docH = Math.max(PAPER_H, sheets * (PAPER_H + SHEET_GAP) + feed);
    return { sheets: sheets, feed: feed, docH: docH, platen: docH * z,
             live: out === null ? state.sheet : out };
  }

  /* The printing line - the carriage line at the machine - in screen px from the box's top. */
  function platenY(z) {
    return feedGeometry(z).platen;
  }

  /* Places the live sheet at the bottom of the stack, and keeps the printing line where the
     eye left it: as the paper is fed the stack above grows, and it is the machine - not the
     text - that must look still. Anchored only while that line is on screen, so scrolling
     back through finished sheets is never fought. Screen-space only: the TXT, Recovery,
     pagination, Print and PDF never see any of it. */
  function updateFeed() {
    if (!el.paper) return;
    var z = currentZoom();
    var geo = feedGeometry(z);
    var before = el.stageInner ? el.stageInner.getBoundingClientRect().bottom : null;
    el.stageInner.style.height = geo.platen + "px";
    /* the root keeps a permanent scrollbar gutter (style.css), which narrows the content box
       by the scrollbar's width; shifting the machine by half of it centres it on the window
       instead of 8px to the left. Zero on overlay scrollbars (iOS, default macOS), so this
       is a no-op there. */
    var gutter = window.innerWidth - document.documentElement.clientWidth;
    el.stageInner.style.transform = gutter > 0 ? "translateX(" + (gutter / 2) + "px)" : "";
    /* the editable sheet is a full page, EXCEPT when it is the sheet at the frontier: only
       that one is still coming out of the machine, so only that one is clipped */
    var clipFeed = (geo.live === geo.sheets) ? geo.feed : PAPER_H;
    el.paper.style.transform =
      "translateY(" + (geo.live * (PAPER_H + SHEET_GAP) * z) + "px) scale(" + z + ")";
    var clip = "inset(0px 0px " + (PAPER_H - clipFeed) + "px 0px)";
    el.paper.style.clipPath = clip;
    el.paper.style.webkitClipPath = clip;
    /* the badge is machine chrome (1.1.3: 409.5px above the printing line, never moved by
       ZOOM). 1.1.4 anchors it to that line instead of the paper's top edge, so a growing
       roll above cannot drag it along. */
    if (el.machineLogo) el.machineLogo.style.top = (geo.platen - 434) + "px";
    paintSheets(geo, z);
    var after = el.stageInner ? el.stageInner.getBoundingClientRect().bottom : null;
    if (before !== null && after !== null && after !== before &&
        before > 0 && before < window.innerHeight) {
      window.scrollBy(0, after - before);
    }
  }

  /* Reveals the caret when the user is editing somewhere the roll does not already show (§9,
     §11: OPEN, Recovery and navigation must never hide the place being edited). Only ever
     scrolls when the caret is actually off screen, and never while the caret is at the
     frontier - there the printing line is what must stay still, and it does. */
  function revealCaret() {
    if (!el.editor || !state.layout || !el.stageInner) return;
    var z = currentZoom();
    var geo = feedGeometry(z);
    if (geo.live === geo.sheets) return;             /* at the frontier: the platen rule owns it */
    var pick = railRow(caretInfo());
    if (pick.row < geo.live * ROWS_PER_SHEET ||
        pick.row >= (geo.live + 1) * ROWS_PER_SHEET) return;
    var rowTop = (geo.live * (PAPER_H + SHEET_GAP) + RAIL_MARGIN_PX +
                  (pick.row - geo.live * ROWS_PER_SHEET) * ROW_PX) * z;
    var top = el.stageInner.getBoundingClientRect().top + window.pageYOffset + rowTop;
    var bottom = top + ROW_PX * z;
    if (top < window.pageYOffset + 80) window.scrollTo(0, Math.max(0, top - 80));
    else if (bottom > window.pageYOffset + window.innerHeight - 80) {
      window.scrollTo(0, bottom - window.innerHeight + 80);
    }
  }

  /* The caret's row in screen px from the machine box's top (ruled 2026-10-08 §5). It is the
     one place the two states of the model meet: at the frontier the caret's row IS the printing
     line, so paper moves and the carriage stays; back in paper that is already out, the carriage
     is drawn on the caret's own row inside that sheet while the paper stays put. While a
     finished sheet is being rolled out, the carriage waits at the printing line. */
  function caretRowTop(z, pick) {
    var geo = feedGeometry(z);
    if (state.outSheet !== null) return geo.platen - ROW_PX * z;
    return (geo.live * (PAPER_H + SHEET_GAP) + RAIL_MARGIN_PX +
            (pick.row - geo.live * ROWS_PER_SHEET) * ROW_PX) * z;
  }

  /* ------------------------------------------------- finished sheets: the stack (1.1.4)
     A finished sheet does not leave the machine - it stays in the stack above the printing
     line, so everything typed can be scrolled back to. The finished sheets are painted
     read-only from the same layout the print path uses; the live sheet keeps the textarea.
     A sheet is repainted only when its own content or the ribbon runs actually changed, so
     typing at the end of a document does not rebuild the pages before it. */
  var sheetCopies = [];          /* index -> element, one per sheet on the roll */
  var sheetSigs = [];            /* index -> content signature last painted  */

  function sheetSignature(rows, from, to) {
    var sig = "", i;
    for (i = from; i < to && i < rows.length; i++) sig += rows[i].text + "\u0000";
    /* the ribbon boundaries are what make a row more than one colour; they change rarely */
    for (i = 0; i < state.runs.length; i++) sig += state.runs[i].start + ":" + state.runs[i].colour + ",";
    return sig;
  }

  function paintSheetCopy(box, rows, from, to) {
    while (box.firstChild) box.removeChild(box.firstChild);
    var flow = document.createElement("div");
    flow.className = "sheet-flow";
    for (var r = from; r < to && r < rows.length; r++) {
      var line = document.createElement("div");
      line.className = "sheet-row";
      var segs = rowSegments(rows[r]);
      for (var g = 0; g < segs.length; g++) {
        var cell = document.createElement("span");
        cell.className = "ink-" + (segs[g].colour ? 1 : 0);
        cell.textContent = segs[g].text;
        line.appendChild(cell);
      }
      flow.appendChild(line);
    }
    /* the colophon lives in the sheet's bottom margin, exactly as on the live sheet */
    var mark = document.createElement("div");
    mark.className = "sheet-mark";
    mark.textContent = "WORD KALLIOPE BY VIC";
    box.appendChild(flow);
    box.appendChild(mark);
  }

  /* Paints the roll: every sheet the document has is on it. The sheet the caret is in is the
     real, editable paper (the textarea lives there); all the others - BEFORE it and AFTER it
     (§4) - are read-only copies, so no page can be hidden behind the caret's position. Only
     the sheet at the frontier is clipped: it is the one still coming out of the machine. */
  function paintSheets(geo, z) {
    if (!el.sheetLayer || !state.layout) return;
    var last = geo.sheets, live = geo.live, rows = null, s;
    for (s = 0; s <= last; s++) {
      if (s === live) continue;                      /* that one is the editable paper */
      if (!rows) rows = flattenRows(state.layout);
      var from = s * ROWS_PER_SHEET, to = from + ROWS_PER_SHEET;
      var sig = sheetSignature(rows, from, to);
      var box = sheetCopies[s];
      if (!box) {
        box = document.createElement("div");
        box.className = "sheet-copy";
        box.setAttribute("aria-hidden", "true");
        el.sheetLayer.appendChild(box);
        sheetCopies[s] = box;
        sheetSigs[s] = null;
      }
      var clipFeed = (s === last) ? geo.feed : PAPER_H;
      box.style.transform =
        "translateY(" + (s * (PAPER_H + SHEET_GAP) * z) + "px) scale(" + z + ")";
      var clip = "inset(0px 0px " + (PAPER_H - clipFeed) + "px 0px)";
      box.style.clipPath = clip;
      box.style.webkitClipPath = clip;
      if (sheetSigs[s] !== sig) {
        paintSheetCopy(box, rows, from, to);
        sheetSigs[s] = sig;
      }
    }
    /* sheets the document no longer has (§3: only a real change of extent removes paper), and
       the band the editable paper has taken over, leave the roll */
    for (var k = 0; k < sheetCopies.length; k++) {
      if (k > last || k === live) {
        if (sheetCopies[k] && sheetCopies[k].parentNode) {
          sheetCopies[k].parentNode.removeChild(sheetCopies[k]);
        }
        sheetCopies[k] = null;
        sheetSigs[k] = null;
      }
    }
  }

  /* A finished sheet stays out for SHEET_OUT_MS and then the next one is fed in - without
     another keystroke, which is why this timer exists. */
  var feedTimer = null;
  function scheduleFeedCatchUp() {
    if (feedTimer) return;
    feedTimer = window.setTimeout(function () {
      feedTimer = null;
      syncSheet(false);
    }, SHEET_OUT_MS + 20);
  }

  /* Keeps the view in step with where the user is editing. The caret decides only WHICH sheet is
     editable and where the carriage is drawn; how much paper exists is the document's business
     (§1). Nothing here can therefore retract the roll, and nothing here plays the sheet change -
     that belongs to forward writing alone (§7, see beginSheetTurn). */
  function syncSheet(force) {
    if (!el.editor) return;
    var info = caretInfo();
    var liveBefore = liveSheet();
    if (force) state.outSheet = null;              /* new / open / recovery: not a sheet change */
    state.sheet = info.sheet < 0 ? 0 : info.sheet;
    /* a finished sheet finishes rolling out on its own, with no keystroke involved */
    if (state.outSheet !== null && Date.now() - state.outAt >= SHEET_OUT_MS) state.outSheet = null;
    if (liveSheet() !== liveBefore) positionEditor();
    /* §15 end-of-line warning state. The warning tracks the typing position (the
       carriage) inside the current 78-unit line: at 70 units the line is in the
       margin warning state. There is no bell asset, so the state never depends on
       sound and never alters input behaviour; it is exposed as an attribute only. */
    if (info.colUnits >= MARGIN_UNITS) el.paper.setAttribute("data-margin", "warning");
    else el.paper.removeAttribute("data-margin");
    updateFeed();
    updateRailMarks();
    updatePaperMark();
    updateTypeLine();
    if (state.outSheet !== null) scheduleFeedCatchUp();
  }

  /* §24 slot 3 is the only sound that is not a keystroke: the sheet turning over. RULED
     2026-10-08 (§7): it - and the 650ms "finished sheet rolls out, then the next one goes in"
     sequence - belongs to FORWARD WRITING that takes the document into a new physical sheet,
     and to nothing else. Navigation, selection, undoing, opening a file or returning to a sheet
     that already exists must never replay either of them.

     All three of these must hold, which together mean "the user was typing at the frontier":
     the document really grew a sheet, it grew by exactly one, and the caret crossed with it. */
  function beginSheetTurn(prevFrontier) {
    if (state.outSheet !== null) return;             /* already turning */
    var now = frontier();
    if (now.sheet !== prevFrontier.sheet + 1) return;
    var pick = railRow(caretInfo());
    if (Math.floor(pick.row / ROWS_PER_SHEET) !== now.sheet) return;
    state.outSheet = prevFrontier.sheet;
    state.outAt = Date.now();
    playSound(3);
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
    var z = currentZoom();
    var geo = feedGeometry(z);
    /* 1.1.4: the colophon is printed in the bottom margin, so it exists on screen only once
       that margin is out of the machine: always true for a sheet that is not the frontier
       (its page is finished), and true for the frontier sheet only when it has been rolled
       all the way out. */
    var out = (geo.live !== geo.sheets) || geo.feed > PAPER_MARK_CENTRE;
    m.style.fontSize = (PAPER_MARK_SIZE * z) + "px";
    m.style.top = (geo.live * (PAPER_H + SHEET_GAP) * z + PAPER_MARK_CENTRE * z) + "px";
    m.style.display = out ? "block" : "none";
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
    if (!el.editor || !state.layout) { left.style.display = right.style.display = "none"; return; }
    var info = locate(state.layout, el.editor.selectionStart || 0);
    var pick = railRow(info);
    var r = pick.rowData;
    if (!r) { left.style.display = right.style.display = "none"; return; }
    /* An empty visual line keeps the leading mark only (2026-10-06 amendment to the rail
       ruling §7): the caret is still on that line, so the line is marked at its start, while
       the trailing mark has no last character cell to sit after. */
    var z = currentZoom();
    var xFirst = RAIL_MARGIN_PX * z;                               /* first cell's left edge */
    /* ruled 2026-10-08 §5: while writing at the frontier this is the printing line (paper
       moves, carriage stays); when the caret goes back into paper that is already out, the
       carriage follows the caret up the roll and the paper does not move. */
    var yCentre = caretRowTop(z, pick) + (ROW_PX / 2) * z;         /* line's vertical centre */
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
  var TYPE_LINE_H = 2;         /* rail thickness, in document px */
  var TYPE_TICK_W = 2;         /* graduation stroke width, in document px */
  var TYPE_TICK_LONG_CELLS = 2;  /* full-character-height tick, this many cells left of the caret */
  var TYPE_TICK_SHORT_CELLS = 4; /* half-height tick, this many cells left of the caret */
  var TYPE_LINE_R_RIGHT_CELLS = 3;   /* right segment length, in cells, after the caret */
  var TYPE_LINE_R_GAP_CELLS = 1;     /* gap between the caret and the right segment, in cells */

  function updateTypeLine() {
    var g = el.typeLine, gr = el.typeLineRight, mask = el.caretMask;
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
    var z = currentZoom();
    var xRight = (RAIL_MARGIN_PX + pick.colUnits * RAIL_UNIT_PX) * z;   /* the caret itself */
    /* ruled 2026-10-08 §5: the carriage line marks where the user is editing. At the frontier
       that is the printing line; back in paper that is already out, it travels up the roll
       with the caret while the paper stays put. */
    var colTop = caretRowTop(z, pick);                   /* the caret's row            */
    var lineTop = colTop + ROW_PX * z;                   /* the carriage line's own row */
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
    /* the native caret is at the same boundary; caret-color alone proved unreliable on real
       Safari, so a paper-coloured patch covers it as well (PM 2026-10-06: hide it completely) */
    if (mask) {
      mask.style.left = (xRight - 1) + "px";
      mask.style.top = colTop + "px";          /* colTop is screen-space since 1.1.4 */
      mask.style.width = "2px";
      mask.style.height = (ROW_PX * z) + "px";
      mask.style.display = "block";
    }
  }

  function onCaretMoved() {
    syncSheet(false);
    revealCaret();               /* navigation must not leave the caret behind (§9, §11) */
  }

  function onInput(e) {
    var oldLen = state.inkLen || 0;
    var prevFrontier = frontier();          /* before the layout changes (see beginSheetTurn) */
    relayout();
    noteEdit(oldLen);
    state.inkLen = document_text().length;
    /* §7: only WRITING may start a sheet change. Undo, redo, paste and drop can all make the
       document grow into a new sheet, and none of them is the machine turning the paper - the
       browser labels them for us (InputEvent.inputType), so they are simply not offered the
       turn. Everything else may try: the turn still requires the document to have grown by
       exactly one sheet with the caret on it, so deletions and middle edits can never start
       one. RETURN arrives as "insertParagraph" - that is typing, and it must be allowed. */
    var kind = (e && e.inputType) || "";
    if (kind.indexOf("history") !== 0 && kind.indexOf("insertFrom") !== 0) {
      beginSheetTurn(prevFrontier);
    }
    syncSheet(false);
    syncInk(false);
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

  function onKeyDown(e) {
    if (e.defaultPrevented) return;

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
    var z = Math.min((vw - 36) / PAPER_W, (vh - chrome) / PAPER_H);
    if (!isFinite(z) || z <= 0) z = 1;
    return Math.max(0.25, Math.min(2, z));
  }

  function currentZoom() {
    var v = ZOOM_STEPS[state.zoomIndex].value;
    return v === null ? fitZoom() : v;
  }

  /* 1.1.4: the printing line sits at the bottom of the stack, so as soon as that is taller
     than the window - every ZOOM step from 100% up, and every finished sheet - it can be
     below the fold. The user types on that line, so the machine brings it into view whenever
     the geometry changes (zoom, resize, first paint). Deliberately NOT on a keystroke:
     scrolling up to read what was written is never fought. */
  function revealPlaten() {
    if (!el.stageInner) return;
    var z = currentZoom();
    var stageTop = el.stageInner.getBoundingClientRect().top + window.pageYOffset;
    var want = stageTop + platenY(z) + 12 - window.innerHeight;
    if (want > window.pageYOffset) window.scrollTo(0, want);
  }

  /* Document geometry and viewport scale are independent (§34): zoom is a screen
     transform only, it never reaches the print DOM. */
  function applyZoom() {
    var z = currentZoom();
    el.stageInner.style.width = (PAPER_W * z) + "px";     /* the height is updateFeed()'s:
                                                             it depends on the stack (1.1.4) */
    el.btnZoom.textContent = "ZOOM " + ZOOM_STEPS[state.zoomIndex].label;
    /* 1.1.1: the rail marks keep their 4x8px size but must follow the paper's new scale.
       1.1.4: the paper's own transform belongs to updateFeed() now - ZOOM scales the feed
       too, so the sheet is placed rather than merely scaled. */
    updateFeed();
    updateRailMarks();
    updatePaperMark();
    updateTypeLine();
    revealPlaten();
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
       second copy of the text in the current ribbon colour. The caret is switched off by
       design (PM 2026-10-06): this used to be the live ribbon colour, and because it is an
       inline style it silently overrode the stylesheet, so it is set here explicitly rather
       than left to CSS. The rail's paper-coloured mask covers it on engines that ignore it. */
    if (el.editor) {
      el.editor.style.color = "transparent";
      el.editor.style.webkitTextFillColor = "transparent";
      el.editor.style.caretColor = "transparent";
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
  /* Slot 1 covers the keys that are not characters and not return: the delivered asset
     names space, the arrows, paging and Home/End together. The product side then ruled
     two further keys one at a time (2026-10-06) - Backspace takes this same sound,
     Delete stays silent.

     Left silent on purpose: Delete. Tab is silent too but that is a leftover rather
     than a decision - it inserts four units, so it is an editing key like the others,
     and the product side has not ruled on it yet (see the handover, open questions).
     Shift/Ctrl/Alt/Meta, Escape and the function keys are not editing keys and are
     silent by design. */
  var AUDIO_NAV_KEYS = {
    " ": 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
    PageUp: 1, PageDown: 1, Home: 1, End: 1,
    Backspace: 1
  };
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

  function playForKeystroke(e) {
    if (!audio.on) return;
    if (e.key === "Enter") playSound(2);
    else if (AUDIO_NAV_KEYS[e.key] === 1) playSound(1);
    else if (e.key.length === 1 || e.isComposing || e.keyCode === 229) playSound(0);
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
    state.outSheet = null;                  /* §9: an opened document is simply there - every
                                               page it has is on the roll, no sheet change */
    positionEditor();
    applyColors();                          /* the rebuilt editor takes the live paper + ribbon */
    syncSheet(true);
    revealCaret();                          /* the caret starts at the top of the document */
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
    el.btnNew.addEventListener("click", newDocument);
    el.btnOpen.addEventListener("click", openDocument);
    el.btnSave.addEventListener("click", saveDocument);
    el.btnPdf.addEventListener("click", exportPdf);
    el.btnZoom.addEventListener("click", cycleZoom);

    el.btnReturn.addEventListener("click", function () {
      state.autoReturn = !state.autoReturn;
      el.btnReturn.textContent = "AUTO RETURN " + (state.autoReturn ? "ON" : "OFF");
      if (el.editor) el.editor.focus();
    });
    el.btnSound.addEventListener("click", function () {
      audio.on = !audio.on;
      el.btnSound.textContent = "SOUND " + (audio.on ? "ON" : "OFF");
      if (el.editor) el.editor.focus();
    });
    el.btnPaper.addEventListener("click", function () {
      state.paperIndex = (state.paperIndex + 1) % PAPER_COLORS.length;
      applyColors();
      if (el.editor) el.editor.focus();
    });
    el.btnRibbon.addEventListener("click", function () {
      state.ribbonIndex = (state.ribbonIndex + 1) % RIBBON_COLORS.length;
      applyColors();
      ribbonSwitch(state.ribbonIndex);   /* only what is typed next takes the new ink (§48) */
      if (el.editor) el.editor.focus();
    });

    el.fileInput.addEventListener("change", onFileChosen);

    /* clicking the paper (but not the text) puts the caret back in the document */
    el.paper.addEventListener("mousedown", function (ev) {
      if (ev.target === el.editor) return;
      window.setTimeout(function () { if (el.editor) el.editor.focus(); }, 0);
    });

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
