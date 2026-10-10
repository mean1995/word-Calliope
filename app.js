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
  var APP_BUILD = "1.1.5.2";

  /* ------------------------------------------------------------------- elements */
  var el = {};

  function cacheElements() {
    el.bar = document.getElementById("bar");
    el.stage = document.getElementById("stage");
    el.stageInner = document.getElementById("stage-inner");
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
    el.btnHelp = document.getElementById("btn-help");
  }

  /* ---------------------------------------------------------------------- state */
  var state = {
    name: DEFAULT_NAME,
    handle: null,          /* FileSystemFileHandle when the platform grants one  §30 */
    safeOverwrite: true,   /* false once U+FFFD was seen on OPEN                 §29 */
    savedText: "",         /* value at the last SAVE / OPEN / NEW                   */
    sheet: 0,
    layout: null,
    autoReturn: true,      /* §16 */
    zoomIndex: 0,
    paperIndex: 0,
    ribbonIndex: 0,
    pendingCaret: null,    /* §P0 selection held while a control owns focus; memory only */
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
     exactly as written. 45 rows of the 54 a sheet holds.
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
    "<span>它前面的人，“一颗心”也可以略大于整个宇宙。</span>"
  ].join("\n");
  /* HELPSHEET:END */

  function applyHelpMode(on) {
    if (!el.editor) return;
    if (on) {
      /* remember the real editing position before the control is taken away (§P0 gives the
         capture; here we only make sure it happens before the selection can be lost) */
      captureCaret();
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
      try { el.editor.focus({ preventScroll: true }); } catch (e) { el.editor.focus(); }
      scheduleRecoveryCheck();
    }
  }

  /* The document controls, as a set. AUTO RETURN has to stay disabled afterwards: it is
     disabled for good by syncControls() because OFF is not offered, so restoring it blindly
     would change product behaviour. Remembering that one flag is cheaper than re-deriving it.
     §H ZOOM is deliberately NOT in this set: while HELP is up it stays live, because the sheet
     has to be readable - if the help text is too small the reader must be able to scale it. */
  var returnDisabledByDesign = false;

  function setDocumentControlsEnabled(yes) {
    if (!yes) returnDisabledByDesign = el.btnReturn ? el.btnReturn.disabled === true : false;
    [el.btnNew, el.btnOpen, el.btnSave, el.btnPdf,
     el.btnReturn, el.btnSound, el.btnPaper, el.btnRibbon].forEach(function (b) {
      if (!b) return;
      if (yes) b.disabled = (b === el.btnReturn) ? returnDisabledByDesign : false;
      else b.disabled = true;
    });
    if (!yes) el.btnZoom.disabled = false;       /* the one control that keeps working (§H) */
  }

  /* §H the two rail triangles belong to the editing position; while the HELP sheet is up there
     is no editing position to mark, so they are cleared. applyZoom() would put them straight
     back (it redraws them for the new scale), so it is told to leave that alone in this state. */
  var helpHidesRails = false;

  function setRailsHidden(hidden) {
    helpHidesRails = hidden;
    if (!hidden) { updateRailMarks(); return; }
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

  function positionEditor() {
    if (!el.flow) return;
    el.flow.style.top = (-(state.sheet * SHEET_PX)) + "px";
    resetScroll();
  }

  function syncSheet(force) {
    if (!el.editor) return;
    var info = caretInfo();
    var sheet = info.sheet < 0 ? 0 : info.sheet;
    if (force || sheet !== state.sheet) {
      var turned = !force && sheet !== state.sheet;
      state.sheet = sheet;
      positionEditor();
      /* §24 slot 3 is the only sound that is not a keystroke: the sheet turning over.
         It is read here because this is where "the view really moved to another sheet"
         is already decided - typing past the foot of a sheet, arrowing or paging across
         one, clicking into another. `force` is the new-document / open / recovery path
         and stays silent. This is a read: nothing is written, nothing waits (§25). */
      if (turned) playSound(3);
    }
    /* §15 end-of-line warning state. The warning tracks the typing position (the
       carriage) inside the current 78-unit line: at 70 units the line is in the
       margin warning state. There is no bell asset, so the state never depends on
       sound and never alters input behaviour; it is exposed as an attribute only. */
    if (info.colUnits >= MARGIN_UNITS) el.paper.setAttribute("data-margin", "warning");
    else el.paper.removeAttribute("data-margin");
    updateRailMarks();
    updateTypeLine();
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
    m.style.fontSize = (PAPER_MARK_SIZE * z) + "px";
    m.style.top = (PAPER_MARK_CENTRE * z) + "px";
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
    var yCentre = (RAIL_MARGIN_PX + (pick.row - state.sheet * ROWS_PER_SHEET) * ROW_PX +
                   ROW_PX / 2) * z;                                /* line's vertical centre */
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
    var colTop = RAIL_MARGIN_PX + (pick.row - state.sheet * ROWS_PER_SHEET) * ROW_PX;
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
    /* the native caret is at the same boundary; caret-color alone proved unreliable on real
       Safari, so a paper-coloured patch covers it as well (PM 2026-10-06: hide it completely) */
    if (mask) {
      mask.style.left = (xRight - 1) + "px";
      mask.style.top = colTop * z + "px";
      mask.style.width = "2px";
      mask.style.height = (ROW_PX * z) + "px";
      mask.style.display = "block";
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
    /* §H the editor is disabled while HELP is up, so this listener should not fire; it is
       kept as the second net so that no keystroke can ever reach the document in that state. */
    if (state.help) return;
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

  /* Document geometry and viewport scale are independent (§34): zoom is a screen
     transform only, it never reaches the print DOM. */
  function applyZoom() {
    var z = currentZoom();
    el.paper.style.transform = "scale(" + z + ")";
    el.stageInner.style.width = (PAPER_W * z) + "px";
    el.stageInner.style.height = (PAPER_H * z) + "px";
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

    /* clicking the paper (but not the text) puts the caret back in the document */
    el.paper.addEventListener("mousedown", function (ev) {
      if (helpBlocks()) return;                  /* §H the sheet owns this paper now */
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

    /* §H ESC closes the help sheet. Capture phase, because focus is not inside the editor
       while the sheet is up. It is the only key this listener accepts, and it does nothing
       at all when the sheet is not showing. */
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !state.help) return;
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
