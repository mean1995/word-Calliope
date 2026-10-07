Word Καλλιόπη — README
======================

版本 1.1.3 ｜ 本文件随软件一起保留，是给使用者的说明，不是开发文档。

    1.1.3 起，纸张左侧那块机身铭牌放大到 1.75 倍（28px → 49px），并固定
    在同一高度：切换 ZOOM 或翻页，它都不再移动。窗口左侧空档不够时铭牌
    隐藏（牌子变大，比 1.1.2 更早触发隐藏）。


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
    assets/fonts/       运行字体（KalliopeLatin / KalliopeCJK / KalliopeButton）
    assets/audio/       按键音目录（默认可为空）
    README.txt          本文件


B. CONTROLS
-----------

NEW            新建空白文档（当前文档有未保存内容时会先询问）
OPEN           打开 UTF-8 的 .txt 文件
SAVE           保存当前 TXT；具体行为由浏览器能力决定：
               浏览器允许直接写回文件时写回，不允许时走浏览器的下载流程
EXPORT PDF     调用浏览器 Print / Save as PDF
ZOOM           FIT / 75% / 100% / 125% / 150%；只影响屏幕显示，
               纸张尺寸、页边距、字号、12 CPI / 6 LPI、分页与 PDF 都不变
AUTO RETURN    ON：到达行末时自动换到下一行继续输入
               OFF：到达行末后停止字符输入，等待 Enter
               （OFF 只约束直接键盘输入的字符。中文输入法、粘贴、拖放、打开文件
                 都不会被截断：超过行宽的内容照常进入文档，再由版面自动重排。）
SOUND          开启 / 关闭 Καλλιόπη 自身的按键音
PAPER          WHITE / CANARY
RIBBON         BLACK / BLUE-BLACK

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
