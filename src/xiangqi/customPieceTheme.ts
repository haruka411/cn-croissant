import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir, join, resourceDir } from "@tauri-apps/api/path";
import { exists, mkdir } from "@tauri-apps/plugin-fs";
import { openPath } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import type { XiangqiColor, XiangqiRole } from "./xiangqi";

export type CustomPieceKey = `${XiangqiColor}-${XiangqiRole}`;
export type CustomPieceUrls = Partial<Record<CustomPieceKey, string>>;
export type CustomPieceFormat = "svg" | "png";

export const CUSTOM_PIECE_FOLDER_NAME = "custom-pieces";
export const CUSTOM_PNG_PIECE_FOLDER_NAME = "custom-png-pieces";
export const CUSTOM_SVG_PIECE_FILES: Record<CustomPieceKey, string> = {
    "red-king": "rk.svg",
    "red-advisor": "ra.svg",
    "red-elephant": "rb.svg",
    "red-horse": "rn.svg",
    "red-rook": "rr.svg",
    "red-cannon": "rc.svg",
    "red-pawn": "rp.svg",
    "black-king": "bk.svg",
    "black-advisor": "ba.svg",
    "black-elephant": "bb.svg",
    "black-horse": "bn.svg",
    "black-rook": "br.svg",
    "black-cannon": "bc.svg",
    "black-pawn": "bp.svg",
};
export const CUSTOM_PNG_PIECE_FILES: Record<CustomPieceKey, string> = {
    "red-king": "rk.png",
    "red-advisor": "ra.png",
    "red-elephant": "rb.png",
    "red-horse": "rn.png",
    "red-rook": "rr.png",
    "red-cannon": "rc.png",
    "red-pawn": "rp.png",
    "black-king": "bk.png",
    "black-advisor": "ba.png",
    "black-elephant": "bb.png",
    "black-horse": "bn.png",
    "black-rook": "br.png",
    "black-cannon": "bc.png",
    "black-pawn": "bp.png",
};
export const CUSTOM_PIECE_FILES = CUSTOM_SVG_PIECE_FILES;

export type CustomPieceThemeState = {
    dir: string;
    urls: CustomPieceUrls;
    missing: string[];
    loading: boolean;
    checkedDirs: string[];
};

const emptyState: CustomPieceThemeState = {
    dir: "",
    urls: {},
    missing: Object.values(CUSTOM_PIECE_FILES),
    loading: false,
    checkedDirs: [],
};

const loadingState: CustomPieceThemeState = {
    ...emptyState,
    loading: true,
};
const customPieceThemeCache = new Map<string, Promise<Omit<CustomPieceThemeState, "loading">>>();

export function customPieceKey(color: XiangqiColor, role: XiangqiRole): CustomPieceKey {
    return `${color}-${role}`;
}

export function useCustomXiangqiPieces(
    enabled: boolean,
    preferredDir?: string,
    reloadToken = 0,
    format: CustomPieceFormat = "svg",
): CustomPieceThemeState {
    const [state, setState] = useState<CustomPieceThemeState>(() =>
        enabled ? loadingState : emptyState,
    );

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            if (!enabled) {
                setState(emptyState);
                return;
            }

            setState((current) => ({ ...current, loading: true }));
            try {
                const theme = await loadCustomXiangqiPieceTheme(preferredDir, { format });
                if (!cancelled) setState({ ...theme, loading: false });
            } catch {
                if (!cancelled) setState({ ...emptyState, loading: false });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [enabled, preferredDir, reloadToken, format]);

    return state;
}

export async function openCustomXiangqiPieceFolder(
    preferredDir?: string,
    format: CustomPieceFormat = "svg",
): Promise<string> {
    const dir = preferredDir || (await ensureCustomPieceDir(format));
    await openPath(dir);
    return dir;
}

export async function loadCustomXiangqiPieceTheme(
    preferredDir?: string,
    options: { forceReload?: boolean; format?: CustomPieceFormat } = {},
): Promise<Omit<CustomPieceThemeState, "loading">> {
    const format = options.format ?? "svg";
    const dirs = await customPieceDirCandidates(preferredDir, format);
    const files = customPieceFiles(format);
    const cacheKey = `${format}\n${dirs.join("\n")}`;
    if (options.forceReload) customPieceThemeCache.delete(cacheKey);

    const cachedTheme = customPieceThemeCache.get(cacheKey);
    if (cachedTheme) return cachedTheme;

    const themePromise = loadCustomXiangqiPieceThemeFromCandidates(dirs, files)
        .then((theme) => {
            if (theme.missing.length > 0) customPieceThemeCache.delete(cacheKey);
            return theme;
        })
        .catch((error) => {
            customPieceThemeCache.delete(cacheKey);
            throw error;
        });
    customPieceThemeCache.set(cacheKey, themePromise);
    return themePromise;
}

async function loadCustomXiangqiPieceThemeFromCandidates(
    dirs: string[],
    files: Record<CustomPieceKey, string>,
): Promise<Omit<CustomPieceThemeState, "loading">> {
    const checkedDirs: string[] = [];
    let bestResult: Omit<CustomPieceThemeState, "loading"> | null = null;

    for (const dir of dirs) {
        if (checkedDirs.includes(dir)) continue;
        checkedDirs.push(dir);
        const result = await loadCustomXiangqiPieceThemeFromDir(dir, checkedDirs, files);
        if (result.missing.length === 0) return result;
        if (!bestResult || result.missing.length < bestResult.missing.length) bestResult = result;
    }

    return (
        bestResult ?? {
            dir: dirs[0] ?? "",
            urls: {},
            missing: Object.values(files),
            checkedDirs,
        }
    );
}

async function loadCustomXiangqiPieceThemeFromDir(
    dir: string,
    checkedDirs: string[],
    files: Record<CustomPieceKey, string>,
): Promise<Omit<CustomPieceThemeState, "loading">> {
    const urls: CustomPieceUrls = {};
    const missing: string[] = [];

    for (const [key, filename] of Object.entries(files) as [
        CustomPieceKey,
        string,
    ][]) {
        const file = await join(dir, filename);
        if (await exists(file)) {
            urls[key] = convertFileSrc(file);
        } else {
            missing.push(filename);
        }
    }

    return { dir, urls, missing, checkedDirs: [...checkedDirs] };
}

async function ensureCustomPieceDir(format: CustomPieceFormat): Promise<string> {
    const dir = (await customPieceDirCandidates(undefined, format))[0];
    if (!(await exists(dir))) {
        await mkdir(dir, { recursive: true });
    }
    return dir;
}

async function customPieceDirCandidates(
    preferredDir?: string,
    format: CustomPieceFormat = "svg",
): Promise<string[]> {
    if (preferredDir) return [preferredDir];
    const folder = format === "png" ? CUSTOM_PNG_PIECE_FOLDER_NAME : CUSTOM_PIECE_FOLDER_NAME;

    const dirs = [
        await join(await resourceDir(), folder),
        await join(".", folder),
        await join(await appDataDir(), folder),
    ];
    return Array.from(new Set(dirs));
}

function customPieceFiles(format: CustomPieceFormat): Record<CustomPieceKey, string> {
    return format === "png" ? CUSTOM_PNG_PIECE_FILES : CUSTOM_SVG_PIECE_FILES;
}
