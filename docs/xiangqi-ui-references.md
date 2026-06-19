# 可借鉴的开源象棋界面与相关项目

调研日期：2026-06-18

本文整理可供 cn-croissant 参考的开源象棋界面、棋盘组件、引擎生态和辅助项目。重点不是直接照搬，而是判断哪些交互模式、数据结构和功能边界适合迁移到一个“象棋版 En Croissant”。

## 1. PyChess Variants / pychess-variants

链接：

- https://github.com/gbtami/pychess-variants
- https://www.pychess.org/

项目定位：

PyChess Variants 是开源在线棋类变体平台，支持 Xiangqi 等多种棋类。它的前端基于 chessgroundx，分析和引擎对弈依赖 Fairy-Stockfish / fairy-stockfish.wasm / fishnet 类工作流。

可借鉴点：

- 在线平台式的信息架构：对弈、锦标赛、棋谱导入、分析、编辑器、题目等功能分区清楚。
- 多棋类共用棋盘组件的做法：chessgroundx 对不同棋盘尺寸、棋子、坐标和变体规则有成熟抽象。
- “轻量进入、逐步展开”的体验：用户可以快速创建对局、找 AI、导入棋谱或进入分析。
- 引擎和 UI 解耦：引擎可在服务端或 wasm 层运行，前端消费分析结果。

对 cn-croissant 的启发：

- 我们当前是桌面工具，不需要照搬在线大厅；但可以借鉴其“分析 / 导入 / 编辑 / 训练”入口结构。
- 棋盘绘制层可继续向“规则无关、坐标可配置、箭头和标注独立”的方向收束。
- 后续若做云库或在线残局，可以借鉴它把在线服务与本地棋盘状态解耦的方式。

## 2. elephantchess.io / elephantchess

链接：

- https://github.com/benckx/elephantchess.io

项目定位：

elephantchess.io 是开源 Xiangqi Web 应用，目标包括真人对弈、人机对弈、题目、分析和复盘。项目同时包含 Kotlin 的 xiangqi-core、engine-api 以及前端棋盘相关模块。

可借鉴点：

- 功能组合与我们目标高度接近：PvP、PvB、题目、分析、复盘。
- xiangqi-core 这样的规则核心和 UI 分离模式，适合参考其模块边界。
- Web 应用里对“创建链接邀请朋友”“大厅”“机器人挑战”的处理，可以为未来在线能力预留设计方向。
- 题目和复盘不是孤立页面，而是与分析和错误学习相连。

对 cn-croissant 的启发：

- 残局 / 题目训练不宜只显示一个局面和提示，最好和“引擎评估、正确着法、复盘解释、下一题”形成闭环。
- 可以参考其“规则核心 + 前端棋盘 + 引擎 API”的分层方式，减少现在部分象棋逻辑散落在组件里的问题。

## 3. XBoard / WinBoard

链接：

- https://manpages.ubuntu.com/manpages/noble/man6/xboard.6.html
- https://github.com/ddugovic/xboard-4.7.1

项目定位：

XBoard / WinBoard 是历史悠久的开源棋类 GUI，支持 Xiangqi、Shogi、Makruk 等变体，并能作为引擎前端、棋谱浏览器和在线服务器客户端使用。

可借鉴点：

- 对引擎协议的长期兼容经验：CECP/XBoard、UCI、USI、UCCI 等。
- 变体棋支持不是只改棋盘，而是从棋盘尺寸、棋子、走法、引擎启动参数、棋谱浏览一起适配。
- 传统桌面 GUI 的强项是稳定、可配置、引擎友好，而不是视觉现代化。

对 cn-croissant 的启发：

- 引擎管理应继续把协议作为一等配置：Pikafish 走 UCI，部分传统象棋引擎可能需要 UCCI。
- “棋盘、引擎、棋谱、时钟、对局状态”之间应有清晰契约，避免在单个 React 组件里堆过多流程。
- 对于高级用户，后续可以增加更细的引擎启动参数、日志、协议诊断和兼容性提示。

## 4. GMChess / XQWizard 系列

链接：

- https://github.com/lerosua/gmchess
- https://manpages.ubuntu.com/manpages/bionic/man6/gmchess.6.html

项目定位：

GMChess 是 Linux / macOS 下的传统中国象棋 GUI，使用 gtkmm 和 C++，代码源流来自 XQWizard，许可证为 GPLv2。

可借鉴点：

- 传统象棋软件的用户预期：棋盘居中、棋谱栏清楚、可人机对弈、可读棋谱和棋书。
- 简单直接的人机对弈入口，不需要复杂账户或在线系统。
- 棋谱阅读和学习资料是老牌象棋软件的重要功能。

对 cn-croissant 的启发：

- 我们不应只追求引擎分析，还应重视“读谱、摆谱、研究局面”的舒适度。
- 未来“数据库”不一定先做成 En Croissant 式赛事数据库，也可以先做本地棋谱库、棋手/开局检索和棋谱阅读。

## 5. atopx/chessboard：象棋学习助手

链接：

- https://github.com/topics/xiangqi

项目定位：

GitHub Xiangqi topic 中列出的 atopx/chessboard 是一个 Tauri/Rust/Pikafish 方向的象棋学习助手，强调屏幕局面识别、引擎分析和走法建议。

可借鉴点：

- 与我们同属 Tauri 桌面生态，技术路线有参考价值。
- “屏幕识别 + 引擎提示”说明象棋用户对外部平台辅助、局面抓取、快速分析有需求。
- Pikafish 集成、箭头提示和局面识别可以作为长期高级功能方向。

对 cn-croissant 的启发：

- 短期不应把精力放到屏幕识别，但可以预留“从图片/剪贴板/外部窗口导入局面”的扩展口。
- 分析箭头、连续 PV 箭头、多个候选着的呈现是用户非常敏感的体验点，应该继续打磨。

## 6. Kadagaden/chess-pieces 与棋子/棋盘资源

链接：

- https://github.com/topics/xiangqi

项目定位：

Kadagaden/chess-pieces 提供 Chess、Janggi、Xiangqi、Sittuyin 等棋类的棋子和棋盘资源，常被变体棋项目复用。

可借鉴点：

- 棋子资源应做成可替换主题，而不是绑定在棋盘逻辑里。
- 国际用户可能需要字形棋子、图形棋子、简体/繁体、不同配色主题。

对 cn-croissant 的启发：

- 继续完善棋盘主题、棋子主题、坐标显示、棋子文字比例等设置。
- 资源结构要稳定，方便后续导入更多皮肤。

## 7. Pikafish 与 Fairy-Stockfish

链接：

- https://github.com/official-pikafish/Pikafish
- https://github.com/fairy-stockfish/Fairy-Stockfish

项目定位：

Pikafish 是强力 UCI 中国象棋引擎，本身不带 GUI，需要配合图形界面。Fairy-Stockfish 是多变体引擎，支持 UCI、UCCI、USI、CECP/XBoard 等协议，可覆盖 Xiangqi 等区域棋类。

可借鉴点：

- 引擎生态要求 GUI 对 UCI/UCCI、MultiPV、nodes、depth、movetime、infinite、日志和 option 设置有完整支持。
- GUI 需要区分“分析引擎”和“对弈引擎”的生命周期，避免用户切换面板导致引擎行为变化。

对 cn-croissant 的启发：

- 当前已经围绕 Pikafish 做了很多工作，后续要继续提升兼容性和错误提示。
- UCCI 支持应保持正式能力，而不是隐藏实验项。

## 8. 其他轻量项目

链接：

- https://github.com/topics/chinese-chess
- https://github.com/hartwork/xiangqi-setup

值得留意：

- west-shell/obsidian-xiangqi：偏“变化树/笔记”方向，说明象棋学习有笔记化需求。
- zkwi/xiangqi-web：React/Vite 方向的 Web 对战、残局研究示例，可关注其轻量局面研究体验。
- hartwork/xiangqi-setup：从 WXF/FEN/annoFEN/XAY 渲染 SVG，可借鉴棋谱导出图片、局面图生成。

## 总体结论

可直接借鉴的不是某个单一项目，而是几条明确方向：

- 规则核心与 UI 分离：elephantchess、PyChess Variants 都证明这对长期维护重要。
- 引擎协议正式化：XBoard / Fairy-Stockfish / Pikafish 生态说明 UCI/UCCI、日志、MultiPV、限制模式必须稳定。
- 训练功能要闭环：题目不只是“摆一个残局”，还要有正确性判断、对方回应、胜负/和棋提示、复盘解释。
- 象棋用户重视读谱研究：传统 GMChess / XQWizard 系软件提醒我们，棋谱阅读、棋库、开局库可能比在线账户更优先。
- 棋盘视觉和箭头体验很关键：棋子主题、坐标、连续 PV、多个候选着箭头应作为核心体验继续优化。
