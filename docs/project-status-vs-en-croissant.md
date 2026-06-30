# cn-croissant 项目状态与代码审查

更新日期：2026-06-30

本文基于代码审查（规则核心、记谱、引擎分析、棋谱库、棋盘 UI、对弈、训练六大模块）和当前构建验证编写，目标是给出**经代码验证**的真实完成度，而不是"代码是否存在"。当前验证包括前端测试（9 个测试文件 / 68 个用例通过）、Rust 后端测试（6 个用例通过）和 `pnpm build` release 构建通过。

## 项目定位

cn-croissant 在 [En Croissant](https://github.com/franciscoBSalgueiro/en-croissant)（国际象棋桌面工具，Tauri + React）基础上二次开发，改造为中国象棋 GUI。保留其"棋局管理、棋谱导入导出、引擎分析、对弈、训练、数据库"的工具型形态，替换国际象棋专属的规则、记谱、引擎协议和数据模型。

## 当前总体状态

项目已经远不止"换皮"：象棋规则核心、棋盘渲染、记谱、引擎实时分析、人机对弈、结果裁决都是**为象棋重写的真实实现**，且有测试覆盖。但仍处于"核心可用、外围未完"的阶段：

- **核心闭环（分析、对弈、记谱、棋盘）可用且质量较高。**
- **数据相关能力分化明显：对弈开局库查询已可用；本地棋谱库中的 CBL/XQF/研究统计仍不完整。**
- **代码层面残留大量上游国际象棋代码，其中后端 Rust 遗留模块根本不参与编译，属纯死代码。**

## 经验证的完成度总览

| 模块 | 完成度 | 状态依据 |
| --- | --- | --- |
| 象棋规则核心 `xiangqi.ts` | ~90% | 走法/将军/送将过滤正确，有测试 |
| 记谱 `notation.ts` | ~80% | 中文/WXF/坐标三格式双向，变着导出缺失 |
| 结果裁决 `store.tsx` / `rules.ts` | ~75% | 将死/困毙/120 半回合自然和/三次重复/单方长将真实；未实现不同棋规切换 |
| 局面评估 `evaluation.ts` | ~95% | 完整、有测试 |
| 持久化 `persistence.ts` | ~90% | sessionStorage 往返可用 |
| XQF 解析 `xqf.ts` | ~20% | stub，无解密，真实文件不可用 |
| 棋盘渲染 `XiangqiBoard.tsx` | ~90% | 高质量 SVG 棋盘，缺坐标轴渲染 |
| 对弈 `BoardGame.tsx` | ~88% | 三种对局模式/时钟/悔棋/对弈开局库可用 |
| 棋谱栏 `XiangqiGameNotation.tsx` | ~90% | 中文记谱、变着树完整 |
| 信息面板 `XiangqiInfoPanel.tsx` | ~95% | 象棋化彻底 |
| 设置/棋子选择 `PiecesSelect.tsx` | ~92% | 内置主题、自定义 SVG/PNG、70%–200% 缩放可用，仍有少量国象专属设置项 |
| 引擎分析链路 | ~80% | 前端→Rust→引擎全链路贯通可用 |
| 引擎进程管理 | ~55% | 有泄漏、孤儿进程、崩溃无恢复 |
| 目录扫描 + 持久化索引 | ~85% | IndexedDB 索引**已实现** |
| PGN 解析/搜索/打开 | ~80% | 真实可用 |
| 云库 chessdb | ~80% | 链路真实，含缓存/超时/防注入 |
| CBL 单局解析 | ~20% | 仅库级，二进制记录未解析 |
| 对弈开局库查询 | ~70% | 后端支持 `.obk/.xqb/.pfBook`，对弈中优先于引擎；研究/统计视图尚未接入 |
| 残局训练 | 代码 ~80% / 对用户 0% | 组件完整但被占位页屏蔽 |

## 已完成、质量较高的部分

### 1. 象棋规则核心（~90%）

`src/xiangqi/xiangqi.ts`（722 行）实现并经测试验证：

- 9×10 棋盘、红黑双方、七类棋子；FEN 解析/生成，引擎格式（n/b）与标准格式（h/e）互转。
- 走法规则全部正确：蹩马腿、塞象眼（含不过河）、炮隔子吃、车滑行、士走九宫斜、将走九宫直、兵过河平移、九宫边界。
- 合法着 = 伪着法 − 送将，正确过滤被将和被牵制。
- **将帅照面**：把"吃对方将"作为一种伪着法，由 `isInCheck` 统一覆盖，实现巧妙且正确。

已知瑕疵：

- 中文记谱有两套独立生成器——`xiangqi.ts` 的 `moveToText`（无"前/中/后"消歧，叠线子记谱会有歧义）和 `notation.ts` 的 `formatRelativeMove`（正确）。存进着法节点的是前者，导出用后者，两处不一致。建议统一到 `formatRelativeMove`。

### 2. 棋盘渲染（~90%）

`src/xiangqi/XiangqiBoard.tsx`（807 行）是**为象棋从零写的纯 SVG 棋盘**（非改造 chessground），质量高：

- 交叉点棋盘、河界断线、九宫斜线、炮位/兵位星点（传统半括号画法）。
- 红黑文字棋子、11 种内置 CSS 棋子主题 + 自定义 SVG/PNG 主题（从 appData 或用户选择目录读取，含缺失处理与竞态防护）。
- 自定义 SVG/PNG 棋子均支持独立目录、缺失文件检查和 70%–200% 缩放；PNG 棋子默认文件名为 `rk.png`、`ra.png`、`rb.png`、`rn.png`、`rr.png`、`rc.png`、`rp.png`、`bk.png`、`ba.png`、`bb.png`、`bn.png`、`br.png`、`bc.png`、`bp.png`。
- 最后一步高亮、可走点（吃子空心环/落点实心点）、拖拽+点选双模式、右键箭头/圈选（4 色、可删除）、引擎箭头、连续 PV 箭头（含上限与去重）。
- 响应式良好（aspect-ratio 9/10、容器查询单位）。

缺口：

- **坐标轴未渲染**：CSS 有 `.coordinate` 类但无对应 JSX，棋盘只有"楚河汉界"文字，没有边线数字。
- aria-label 为英文 + 内部角色名（"red king on e0"），未 i18n，可访问性弱；无键盘走子。

### 3. 引擎实时分析（~80%）

象棋分析链路**真实贯通**（前端 `XiangqiAnalysisPanel.tsx` → Rust `start_xiangqi_analysis` → 引擎 → 事件回推 → UI）：

- 本地引擎加载、UCI/UCCI 协议选择、MultiPV、时间/深度/节点/无限五种分析模式。
- 候选着列表、ScoreBubble、可展开 PV（含悬浮局面预览）、引擎箭头、连续箭头。
- 局势折线图（可点击跳转）、报告面板、引擎日志查看。
- 内置 Pikafish（7 个 Windows 变体 + 53MB NNUE），双路径探测（打包后 / 开发态）。
- 事件按 fen + requestId 双重过滤，丢弃过期更新；手动启停与面板切换解耦。

### 4. 对弈模式（~85%）

`src/components/boards/BoardGame.tsx` 已象棋化：

- 人 vs 人、人 vs 引擎、引擎 vs 引擎、从当前局面对弈。
- 悔棋（人机对局回退到上一个人类着手）、时钟 + 增量、认输、超时判定，结果写入棋谱头。
- 引擎请求竞态防护到位（requestKey + 走子前校验 fen 未变）。

### 5. 结果裁决（~75%）

`src/xiangqi/store.tsx` 与 `src/xiangqi/rules.ts`：

- 将死 / 困毙（象棋困毙正确判负，非和棋）。
- 120 半回合自然和、三次同局面和、单方长将判负均为真实实现，有前端测试覆盖。
- 之前尝试加入的 AsianRule / ChineseRule / SkyRule / ComputerRule / YitianRule 切换入口已经移除；当前 GUI 不再暴露未完成的不同棋规裁决。
- 长捉不再作为自动胜负裁决依据。后续若要实现不同棋规，应先按可靠项目或规则文本完成整体规则裁决，再开放设置入口。

### 6. 记谱与持久化（~80–95%）

- `notation.ts`：中文纵线 / WXF / 坐标三格式双向转换，进退平、前中后/序数消歧均实现且有测试；解析鲁棒（去注释/变着/回合号/全角/异体字）。缺口：导出仅主线（不含变着/注释）、跨纵线多兵消歧未处理。
- `persistence.ts`：默认头、从 FEN/记谱建态、结果与原因校验、sessionStorage 往返，均可用。

## 未完成、占位或假数据的部分

### 1. CBL 象棋桥库（~20%）

仅库级识别（库名、估算记录数），**单局走法未解析**。真实 .cbl 解压后是 CCBridge 二进制记录格式，当前代码按"找 XML 文本"处理，对二进制库无效，因此"已索引 N 局"几乎恒为 0。两种容器格式（`CCBridge` 单库 zlib / `CCBridgeLibrary` 容器）未区分，后者会解压失败降级。`engine/database` 实测有 1104 个 cbl 文件，但 `MAX_PARSE_CBL_LIBRARIES = 128` 硬截断，其余只列文件名。

### 2. 对弈开局库与本地研究库边界

Rust 后端已有 `xiangqi_opening_book.rs`，支持 `.obk`（`bhobk`）、`.xqb`（`book`）和 `.pfBook`（`pfBook`）三类 SQLite 开局库查询。人机/机机对弈中，电脑轮次会在设定最大库深度内先查开局库，返回合法着法后再决定是否需要引擎搜索。该路径已有临时 pfBook 单元测试，验证了初始局面查询和“开局库优先于引擎搜索”。

仍未完成的是**本地研究/统计视图接入**：`xiangqiDatabase.ts` 目前只扫描并展示 OBK 文件数量，没有把 OBK/XQB/PFBook 候选着纳入分析页、本地棋谱统计或开局树浏览。因此“对弈用开局库”可用，但“研究用开局库数据库”仍是后续任务。

### 3. XQF 解析（~20%，stub）

只校验前两字节 + 固定偏移线性读取，靠"四种坐标变换逐一试合法"暴力解码，测试用的是人工构造字节流。**不处理 XQF 头部密钥异或加密**，真实 .xqf 文件（v1.0+ 几乎都加密）会失败或解出乱码；忽略变着/注释/对局头。属占位，真实棋谱导入不可用。

### 4. 残局训练（代码完整但被禁用）

`XiangqiPuzzleTrainer.tsx`（602 行）**功能上基本完整**：真实题库（763KB 验证题）、云库应手、正误反馈、必胜/必和判定、自定义 FEN 练习。但**未接入**——`BoardsPage.tsx` 的 `puzzles` 分支渲染的是英文占位页 "Xiangqi puzzles are not ready yet"，组件无任何引用。推测禁用原因是依赖在线云库、离线不可用。

### 5. 在线账户

`/accounts` 显示占位。En Croissant 的 Lichess / Chess.com 集成不适用于象棋，除非接入象棋平台或改为文件夹同步方向，否则应保持禁用。

## 文档与代码不一致（需立即纠正）

旧版本状态文档存在以下与代码不符之处，本次已更正：

1. **持久化索引"还没有"——错误**。`xiangqiDatabase.ts` 已实现 IndexedDB 索引（schemaVersion + fingerprint 失效逻辑），不是会话级实时扫描。`DatabaseExplorerPanel` 的相关文案也需同步更新。
2. **本地局面统计面板"暂不挂载"——错误**。`BoardAnalysis.tsx` 已挂载"云库 / 本地棋谱"两个子页。

## 仍保留但需警惕的上游遗留

### 1. 不参与编译的 Rust 死代码（重要）

`src-tauri/src/main.rs` 仍承担大量象棋后端逻辑，目前只拆出了 `xiangqi_opening_book.rs` 与 `xiangqi_zobrist_table.rs` 两个正式模块。项目没有 `lib.rs`，因此以下上游文件仍基本不参与当前象棋主流程编译，属于待清理或待归档参考代码：

```
chess.rs  game.rs  pgn.rs  opening.rs  puzzle.rs  lexer.rs
fs.rs  oauth.rs  sound.rs  progress.rs  error.rs
db/（整目录）  engine/（process.rs / uci.rs / types.rs，上游成熟的引擎封装）
```

这些文件不影响构建，但严重干扰新开发者判断（误以为后端有模块化的 db / engine 层）。其中 `engine/` 目录是上游成熟的进程封装，未来象棋后端模块化时可参考或改造，而非从零写。

### 2. 前端国际象棋遗留

- `src/components/home/Databases.tsx` 仍是 Lichess/Chess.com 个人库逻辑。
- `routes/databases/$databaseId.tsx` 是死路由（参数未使用，渲染同一面板）。
- `DatabaseLoader.tsx` 监听的 `search_progress` 事件象棋链路从不发送，进度条永久停在动画态。
- `chessdb/api.ts`（国象版，chessops）在象棋流程里是死代码，象棋用的是 `chessdb/xiangqi.ts`。
- `DetachedEval.tsx` 调用未注册的 `get_best_moves`，实际不可用。
- `src/components/panels/analysis`、`src/components/puzzles`、`src/utils/repertoire.ts` 等仍是国象逻辑。

### 3. 术语与文案残留

- **white/black 与 red/black 命名混用**：`players` 用 `white`/`black` 键、`gameInputColorAtom` 取值 `"white"/"black"`，靠"white=红方"的隐式约定映射，维护风险高。
- 多处英文未 i18n：棋盘 aria-label、记谱栏 "Xiangqi" 标题、残局占位页、报告图表空状态/tooltip。
- 设置页残留国象专属项（子力显示、开局库最小局数、SRS 难度 Again/Hard/Good/Easy）与国际象棋骑士图标 `IconChess`。

## 已确认的 bug 清单

按影响排序：

1. **中文记谱双实现不一致**：`moveToText` 缺消歧，叠线子记谱有歧义（`xiangqi.ts` vs `notation.ts`）。
2. **引擎进程泄漏 / 孤儿进程风险**：分析和对弈引擎的生命周期仍集中在 `main.rs`，退出、崩溃、切换时需要更明确的 kill / cleanup / 错误回传。
3. **引擎崩溃恢复不足**：reader 线程在 EOF/出错时的 UI 反馈和 stderr 诊断仍需加强，避免前端永久 loading。
4. **DatabasePanel React key 冲突**：同一文件多局用 `key={game.path}`，多局会重复 key 且高亮串味（应用 `game.id`）。
5. **CBL 元数据提取不稳定**：CCBridge 二进制库仍未完整解析，作者/简介/单局记录可靠性不足。
6. **内置 Pikafish 选型固定取兼容变体**，未做 CPU 特性探测选最快二进制。
7. **引擎日志无上限累积**：每 200ms 全量 clone + 序列化 + IPC 回传，无限分析下是内存/性能隐患。
8. **不同棋规裁决未实现**：当前只保留统一基础裁决；AsianRule / ChineseRule / SkyRule / ComputerRule / YitianRule 不应在 GUI 中出现，直到整体规则逻辑真正实现。

## 主要优化方向

- **架构收束**：把 main.rs 的象棋分析后端抽成独立模块；清理（或归档说明）不参与编译的遗留 .rs；统一 white/black → red/black 术语。
- **大文件拆分**：`XiangqiAnalysisPanel.tsx`（1876 行）拆为 context / arrows / settings / report / pv 多模块；引擎默认设置合并到单一来源。
- **正确性**：统一中文记谱生成器；若要实现不同棋规裁决，必须以完整规则逻辑为单位实现并测试，而不是只调整长将/长捉局部参数。
- **健壮性**：修引擎进程泄漏与崩溃恢复；引擎日志加环形缓冲上限；云库加请求去重/退避。
- **专业化**：渲染坐标轴；全流程 i18n（含 aria-label）；清理设置页国象残留项。

## 与原版 En Croissant 的能力对比

| 功能 | 原版 En Croissant | 当前 cn-croissant |
| --- | --- | --- |
| 棋盘 | chessground 格子棋盘 | 自研 SVG 交叉点棋盘，质量高（缺坐标轴） |
| 规则 | chessops | 自研象棋规则核心，正确且有测试 |
| 分析 | UCI、多引擎、报告、日志、云分析 | 象棋本地分析全链路可用；进程管理待加固 |
| MultiPV / 分析模式 | 支持 | 已支持五种模式 + 多候选显示 |
| 对弈 | 人/引擎、时钟、悔棋 | 象棋化可用，支持 .obk/.xqb/.pfBook 对弈开局库 |
| 记谱 | PGN 标准 | 中文/WXF/坐标三格式，变着导出待补 |
| 数据库 | 成熟 | 扫描 + IndexedDB 索引 + PGN 可用；CBL/XQF/OBK 研究统计未完成 |
| repertoire | 成熟 | 占位；短期目标是开局库/布局浏览，不做间隔重复训练 |
| puzzle | 国际象棋题库 | 组件完整但禁用，依赖在线云库 |
| annotation | 国际象棋 NAG | 主流程移除，待改为文字批注/标签 |
| online accounts | Lichess / Chess.com | 禁用，待定象棋平台方向 |
| tablebase | 国际象棋残局表 | 无象棋残局库正式接入 |

## 功能分级建议

### A. 应继续打磨的核心（已可用）

棋盘渲染、引擎实时分析、对弈/时钟/悔棋、记谱导入导出、PGN 棋谱浏览、保存/自动保存。

### B. 下一阶段正式开发

CBL/CBR 单局解析、OBK/XQB/PFBook 研究视图接入、象棋开局库浏览、复盘报告增强、云库稳定化、残局训练正式版、引擎进程加固、架构收束。

### C. 暂不应开放

原版国际象棋数据库页、原版 puzzle、原版 repertoire 训练、Lichess/Chess.com 账户页、国际象棋 NAG 评注系统。
