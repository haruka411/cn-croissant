# cn-croissant

中文 | [English](./README.en.md)

cn-croissant 是一个中国象棋的GUI工具，目标是提供棋局管理、棋谱导入导出、引擎分析、对弈和训练相关能力。
项目基于 [En Croissant](https://github.com/franciscoBSalgueiro/en-croissant) 二次开发。

本项目使用 Tauri、React 构建，并在开发过程大量使用 Codex + GPT-5.5 实现、迁移和重构。

## 项目状态

项目仍处于开发早期，功能还很不完善。
当前重点是让 En Croissant 风格的桌面棋类工具适配中国象棋规则、记谱和引擎生态。

## 与 En Croissant 的关系

cn-croissant 不是从零开始的新项目，而是基于 En Croissant 的代码、架构和交互模式进行中国象棋化改造。原项目是优秀的国际象棋桌面工具，本项目保留其桌面应用基础、界面组织方式和部分通用工程结构，同时替换或重写棋类规则、棋盘、记谱、引擎和数据模型中与中国象棋相关的部分。

## 本地开发

需要先准备 Tauri 所需的系统依赖、Node.js、pnpm 和 Rust 工具链。

安装依赖：

```bash
pnpm install
```

启动开发环境：

```bash
pnpm dev
```

前端类型检查和构建：

```bash
pnpm build-vite
```

运行测试：

```bash
pnpm test
```

构建桌面程序：

```bash
pnpm build
```

构建产物通常位于：

```text
src-tauri/target/release
```

## 常用脚本

```bash
pnpm lint
pnpm test
pnpm build-vite
pnpm build
```

## 目录结构

```text
src/              React/TypeScript 前端代码
src/xiangqi/      中国象棋规则、记谱、持久化和棋盘相关代码
src-tauri/        Tauri/Rust 后端代码
engine/           内置引擎资源
sound/            声音资源
docs/             开发和迁移说明
```

## 致谢

- [En Croissant](https://github.com/franciscoBSalgueiro/en-croissant)：本项目的上游基础和主要参考对象。
- Pikafish 及中国象棋引擎生态：为中国象棋分析能力提供基础。
- Codex + GPT-5.5：辅助本项目的迁移、开发和重构。
