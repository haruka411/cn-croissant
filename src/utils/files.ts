import { Result } from "@badrap/result";
import { basename, resolve } from "@tauri-apps/api/path";
import { exists, writeTextFile } from "@tauri-apps/plugin-fs";
import { platform } from "@tauri-apps/plugin-os";
import { getDefaultStore } from "jotai";
import useSWR from "swr";
import type { FileMetadata } from "@/components/files/file";
import { addRecentFileAtom, tabFamily } from "@/state/atoms";
import { exportGame } from "@/xiangqi/notation";
import { readXiangqiNotationFile } from "@/xiangqi/importFile";
import { createXiangqiStateFromNotation } from "@/xiangqi/persistence";
import { createRootNode } from "@/xiangqi/xiangqi";
import { createTab, isInTempDir, type Tab } from "./tabs";

export function usePlatform() {
    const r = useSWR("os", async () => {
        return platform();
    });
    return { os: r.data, ...r };
}

export async function openFile(
    file: string | FileMetadata,
    setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
    setActiveTab: React.Dispatch<React.SetStateAction<string | null>>,
    options?: {
        gameNumber?: number;
        pgn?: string;
    },
) {
    const store = getDefaultStore();
    const gameNumber = options?.gameNumber ?? 0;
    let fileInfo: FileMetadata;
    let isTempOrigin = false;
    let pgn = options?.pgn;
    let tabName = "Untitled";
    let recentName = "Untitled";

    if (typeof file === "string") {
        isTempOrigin = await isInTempDir(file);
        if (pgn === undefined) {
            pgn = await readXiangqiNotationFile(file);
        }
        const fileName = await basename(file);
        const displayName = fileName.replace(/\.(pgn|xqf|cbl|wxf|txt)$/i, "");

        fileInfo = {
            type: "file" as const,
            metadata: {
                tags: [],
                type: "game" as const,
            },
            name: displayName,
            path: file,
            numGames: 1,
            lastModified: Math.floor(Date.now() / 1000),
        };

        if (pgn) {
            tabName = nameFromNotation(pgn, displayName);
            recentName = tabName;
        } else {
            tabName = displayName;
            recentName = displayName;
        }
    } else {
        fileInfo = file;
        isTempOrigin = await isInTempDir(file.path);
        if (pgn === undefined) {
            pgn = await readXiangqiNotationFile(file.path);
        }
        tabName = file.name || "Untitled";
        recentName = tabName;
    }

    const id = await createTab({
        tab: {
            name: tabName,
            type: "analysis",
        },
        setTabs,
        setActiveTab,
        pgn: pgn || "",
        gameOrigin: {
            kind: isTempOrigin ? "temp_file" : "file",
            file: fileInfo,
            gameNumber,
        },
    });

    if (fileInfo.metadata.type === "repertoire") {
        store.set(tabFamily(id), "practice");
    }

    store.set(addRecentFileAtom, {
        name: recentName,
        path: fileInfo.path,
        type: fileInfo.metadata.type,
    });

    return id;
}

export async function createFile({
    filename,
    filetype,
    pgn,
    dir,
}: {
    filename: string;
    filetype: "game" | "repertoire" | "tournament" | "puzzle" | "other";
    pgn?: string;
    dir: string;
}): Promise<Result<FileMetadata>> {
    const file = await resolve(dir, `${filename}.pgn`);
    if (await exists(file)) {
        return Result.err(Error("File already exists"));
    }
    const metadata = {
        type: filetype,
        tags: [],
    };
    await writeTextFile(file, pgn || defaultXiangqiNotation(filename));
    await writeTextFile(file.replace(".pgn", ".info"), JSON.stringify(metadata));
    return Result.ok({
        type: "file",
        name: filename,
        path: file,
        numGames: 1,
        metadata,
        lastModified: Math.floor(Date.now() / 1000),
    });
}

function nameFromNotation(text: string, fallback: string): string {
    try {
        const state = createXiangqiStateFromNotation(text);
        return (
            state.headers.title ||
            state.headers.event ||
            [state.headers.red, state.headers.black].filter(Boolean).join(" - ") ||
            fallback
        );
    } catch {
        return fallback;
    }
}

function defaultXiangqiNotation(title: string): string {
    return exportGame({
        id: "new",
        title,
        event: title,
        red: "Red",
        black: "Black",
        result: "*",
        root: createRootNode(),
        updatedAt: Date.now(),
    });
}
