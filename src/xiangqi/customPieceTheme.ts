import { convertFileSrc } from "@tauri-apps/api/core";
import { join, resourceDir } from "@tauri-apps/api/path";
import { exists, mkdir } from "@tauri-apps/plugin-fs";
import { openPath } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import type { XiangqiColor, XiangqiRole } from "./xiangqi";

export type CustomPieceKey = `${XiangqiColor}-${XiangqiRole}`;
export type CustomPieceUrls = Partial<Record<CustomPieceKey, string>>;

export const CUSTOM_PIECE_FOLDER_NAME = "custom-pieces";
export const CUSTOM_PIECE_FILES: Record<CustomPieceKey, string> = {
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

export type CustomPieceThemeState = {
    dir: string;
    urls: CustomPieceUrls;
    missing: string[];
    loading: boolean;
};

const emptyState: CustomPieceThemeState = {
    dir: "",
    urls: {},
    missing: Object.values(CUSTOM_PIECE_FILES),
    loading: false,
};

export function customPieceKey(color: XiangqiColor, role: XiangqiRole): CustomPieceKey {
    return `${color}-${role}`;
}

export function useCustomXiangqiPieces(enabled: boolean): CustomPieceThemeState {
    const [state, setState] = useState<CustomPieceThemeState>(emptyState);

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            if (!enabled) {
                setState(emptyState);
                return;
            }

            setState((current) => ({ ...current, loading: true }));
            try {
                const theme = await loadCustomXiangqiPieceTheme();
                if (!cancelled) setState({ ...theme, loading: false });
            } catch {
                if (!cancelled) setState({ ...emptyState, loading: false });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [enabled]);

    return state;
}

export async function openCustomXiangqiPieceFolder(): Promise<string> {
    const dir = await ensureCustomPieceDir();
    await openPath(dir);
    return dir;
}

export async function loadCustomXiangqiPieceTheme(): Promise<
    Omit<CustomPieceThemeState, "loading">
> {
    const dir = await ensureCustomPieceDir();
    const urls: CustomPieceUrls = {};
    const missing: string[] = [];

    for (const [key, filename] of Object.entries(CUSTOM_PIECE_FILES) as [
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

    return { dir, urls, missing };
}

async function ensureCustomPieceDir(): Promise<string> {
    const dir = await join(await resourceDir(), CUSTOM_PIECE_FOLDER_NAME);
    if (!(await exists(dir))) {
        await mkdir(dir, { recursive: true });
    }
    return dir;
}
