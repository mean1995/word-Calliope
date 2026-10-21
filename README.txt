Word Καλλιόπη — README
======================

版本 1.1.6.2 ｜ 本文件随软件一起保留，是给使用者的说明，不是开发文档。

1.1.6.2 更新内容
----------------

    更新：

        打开时先出现一个加载画面：灰底上一行小字 WORD KALLIOPE、一条细分隔线、
        静止的 LOADING...，下面是一句中文引文。引文每 4 秒换一句，共 11 句
        （10 句常用、1 句少见），每次打开从常用句里随机开始。

        加载画面不会提前消失：等机身图像、首屏字体和恢复草稿的判断都做完，
        才一次性显示完整打字机 —— 不再出现纸张、页码、机身底图、前壳
        一层层冒出来的过程。

        首屏字体尚未确认前，AUTO RETURN 按钮暂时不可点（避免误以为 OFF 可用）；
        字体确认后自动恢复，不会一直停用。

        机身图像、字体或草稿读取失败时仍会进入程序；等待超过 60 秒会自动放行。

    修复：

        1.1.6.1 在冷启动（新设备、清缓存、换网络）时，首屏会依次冒出纸张、
        页码窗数字、机身底图和机身前图；现在首屏一次成型。

1.1.6.1 更新内容
----------------

    更新：

        拟物化机身与真实打字机交互方式：屏幕上出现一台打字机（机身、纸张、
        打印头），纸从机器里一行一行走出来，正在写的那一行停在打印线上；
        写过的正文可以被机身压住。

        WPS 模式切换：一键回到旧版那个没有机身、整页一屏的编辑界面。
        默认关闭，也不记忆。

        滚轮浏览：上下移动纸张看前后文，光标不动，也不发声。

        整页浏览 PGUP / PGDN（新控件）：一页一屏地看上一页 / 下一页。

        页码窗（新）：机身右下方显示 当前页 / 总页数。

        ZOOM 五档（FIT / 75% / 100% / 125% / 150%）下，机身、出纸槽、
        页码窗、打印线始终都在屏幕里。

        HELP：整页可读；打开期间 ZOOM 锁在 FIT 并停用文档控件，末尾另有
        一行兼容说明。

        恢复浏览器原生的闪烁光标（1.1.5.2 里被遮罩盖住、看不见）。

        机身与页码窗只是屏幕上的装饰：不会进入 TXT、草稿、打印或 PDF。

        EXPORT PDF 按钮改名 EXPORT；键名统一为全大写 PGUP / PGDN。

    修复：

        方向键、Page Up / Page Down、Home / End，以及 ⌘C 这类快捷键，
        在 1.1.5.2 里都会发出打字声；现在只有真正的打字才发声。

        点在纸面空白处（页边距、出纸槽附近）在 1.1.5.2 里没有反应；
        现在会把插入点放到最近的格子。

    早期版本：

        1.1.5：切换 PAPER / RIBBON 后，光标、选区与可见纸张不再跳回第一页。
        1.1.3：机身铭牌放大到 1.75 倍并固定高度。


A. ABOUT WORD ΚΑΛΛΙΌΠΗ
----------------------

Word Καλλιόπη 是一款 lightweight、offline、plain-text writing tool。

它不是古董打字机模拟器，也不是 Word 或 Markdown 编辑器，而是一台虚构的、
处在 electronic typewriter 与早期 personal computer 之间的写作机器：
纸张有明确的物理尺寸（US Letter、四边 1 英寸页边距），字符落在固定的
12 CPI / 6 LPI 网格上，屏幕同一时刻只显示一张纸。

    Modern input. Typewriter output.

输入、编辑、复制粘贴、Undo、中文输入法都交给操作系统与浏览器完成；
保留下来的只有打字机的部分：纸、固定书写区、固定字距、色带、回车、换纸与按键声。

运行方式：整个文件夹就是程序。直接用浏览器打开 index.html 即可，
不需要安装，不需要服务器，不需要联网。

你的文字只存在于：浏览器内存、浏览器内的 Recovery 草稿、你自己保存的 TXT、
你自己导出的 PDF。程序不联网、不上传文字、不收集任何使用数据。

发行文件：

    index.html          程序入口
    style.css           版面与纸张
    app.js              程序主体
    assets/machine/     机身与打印头美术（后壳 / 前壳 / 打印头）
    assets/fonts/       运行字体（KalliopeLatin / KalliopeCJK / KalliopeButton /
                        KalliopeCounter 页码窗面板字体）
    assets/audio/       按键音目录（默认可为空）
    assets/icons/       应用图标（Add to Home Screen / Add to Dock）
    README.txt          本文件


B. CONTROLS
-----------

NEW            新建空白文档（当前文档有未保存内容时会先询问）
OPEN           打开 UTF-8 的 .txt 文件
SAVE           保存当前 TXT；具体行为由浏览器能力决定：
               浏览器允许直接写回文件时写回，不允许时走浏览器的下载流程
EXPORT         调用浏览器 Print / Save as PDF
ZOOM           FIT / 75% / 100% / 125% / 150%；只影响屏幕显示，
               纸张尺寸、页边距、字号、12 CPI / 6 LPI、分页与 PDF 都不变
AUTO RETURN    ON：到达行末时自动换到下一行继续输入
               OFF：到达行末后停止字符输入，等待 Enter
               （OFF 只约束直接键盘输入的字符。中文输入法、粘贴、拖放、打开文件
                 都不会被截断：超过行宽的内容照常进入文档，再由版面自动重排。）
SOUND          开启 / 关闭 Καλλιόπη 自身的按键音
PAPER          WHITE / CANARY
RIBBON         BLACK / BLUE-BLACK
PGUP / PGDN    整页浏览：一页一屏地看上一页 / 下一页，光标不动。
               WPS 模式下则是翻到上 / 下一页。
WPS            在「打字机」与旧版整页编辑界面之间切换（默认打字机）。
HELP           打开帮助纸页（打开期间文档控件停用）；按 Escape 关闭。

关于 RIBBON：

    RIBBON 是色带开关，只影响**之后输入**的文字；
    点击前已经写在纸上的文字保持原来的墨色不变。
    色带颜色属于显示状态，TXT 始终是 semantic plain text、不保存任何颜色，
    因此保存后重新打开该文件时，整篇会按当前色带颜色显示。

Print / PDF 使用当前的 PAPER 与 RIBBON。


C. ADDING YOUR OWN SOUNDS
-------------------------

/assets/audio/ 不需要任何声音文件，没有音效时程序完全正常工作。

发行包内附四组声音，各自独立，缺哪一组哪一组静默（不弹提示、不报错）：

    sound1.mp3    普通字符键                                263 ms
    sound2.mp3    空格、方向键、Page Up/Down、Home、End、退格   211 ms
    sound3.mp3    回车                                     1047 ms
    sound4.mp3    换下一页纸（视窗真的换到另一张纸时）        1047 ms

想更换音效时，把 MP3 放进 /assets/audio/，并严格使用以下文件名：

    sound1.mp3    ordinary character key
    sound2.mp3    space, arrows, Page Up / Page Down, Home, End, Backspace
    sound3.mp3    return
    sound4.mp3    the sheet turning over

允许只放其中任意几个；缺少的音效直接静默，不影响打字，也不产生错误。
使用者不需要修改 HTML / CSS / JavaScript 中的任何内容。

    Audio is feedback, never logic.
