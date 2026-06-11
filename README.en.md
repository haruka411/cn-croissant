# cn-croissant

English | [中文](./README.md)

cn-croissant is a GUI tool for Xiangqi, also known as Chinese chess. It aims to provide game management, notation import/export, engine analysis, play modes, and training-related features.
The project is a derivative work based on [En Croissant](https://github.com/franciscoBSalgueiro/en-croissant).

This project is built with Tauri and React, and development has made extensive use of Codex + GPT-5.5 for implementation, migration, and refactoring.

## Project Status

The project is still in an early development stage, and many features are incomplete.
The current focus is adapting an En Croissant-style desktop chess tool to Xiangqi rules, notation, and engine workflows.

## Relationship With En Croissant

cn-croissant is not a from-scratch project. It is a Xiangqi-focused adaptation based on En Croissant's code, architecture, and interaction patterns. En Croissant is an excellent desktop tool for international chess. This project keeps its desktop application foundation, interface organization, and part of its shared engineering structure, while replacing or rewriting the chess-specific rules, board, notation, engine, and data model layers for Xiangqi.

## Local Development

You need the system dependencies required by Tauri, Node.js, pnpm, and the Rust toolchain.

Install dependencies:

```bash
pnpm install
```

Start the development environment:

```bash
pnpm dev
```

Type-check and build the frontend:

```bash
pnpm build-vite
```

Run tests:

```bash
pnpm test
```

Build the desktop application:

```bash
pnpm build
```

Build outputs are usually located at:

```text
src-tauri/target/release
```

## Common Scripts

```bash
pnpm lint
pnpm test
pnpm build-vite
pnpm build
```

## Directory Layout

```text
src/              React/TypeScript frontend code
src/xiangqi/      Xiangqi rules, notation, persistence, and board code
src-tauri/        Tauri/Rust backend code
engine/           Bundled engine resources
sound/            Sound assets
docs/             Development and migration notes
```

## Acknowledgements

- [En Croissant](https://github.com/franciscoBSalgueiro/en-croissant): the upstream foundation and primary reference for this project.
- Pikafish and the Xiangqi engine ecosystem: the basis for Xiangqi analysis support.
- Codex + GPT-5.5: assistance with migration, development, and refactoring.
