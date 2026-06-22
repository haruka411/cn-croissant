import { convertFileSrc } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { readDir } from "@tauri-apps/plugin-fs";

export type CustomBoardImage = {
    name: string;
    path: string;
    url: string;
};

export type CustomBoardCalibrationMode = "standard" | "scale" | "manual";

export type CustomBoardCalibration = {
    mode: CustomBoardCalibrationMode;
    originX: number;
    originY: number;
    cellSize: number;
    scale: number;
};

export const CUSTOM_BOARD_REFERENCE_WIDTH = 767;
export const CUSTOM_BOARD_REFERENCE_HEIGHT = 842;
export const CUSTOM_BOARD_REFERENCE_CELL_SIZE = 68;
export const CUSTOM_BOARD_REFERENCE_ORIGIN_X =
    CUSTOM_BOARD_REFERENCE_WIDTH / 2 - 4 * CUSTOM_BOARD_REFERENCE_CELL_SIZE;
export const CUSTOM_BOARD_REFERENCE_ORIGIN_Y =
    CUSTOM_BOARD_REFERENCE_HEIGHT / 2 - 4.5 * CUSTOM_BOARD_REFERENCE_CELL_SIZE;

export const DEFAULT_CUSTOM_BOARD_CALIBRATION: CustomBoardCalibration = {
    mode: "standard",
    originX: CUSTOM_BOARD_REFERENCE_ORIGIN_X,
    originY: CUSTOM_BOARD_REFERENCE_ORIGIN_Y,
    cellSize: CUSTOM_BOARD_REFERENCE_CELL_SIZE,
    scale: 100,
};

export function customBoardDisplayName(path: string): string {
    return path.split(/[\\/]/).pop() || path;
}

export function customBoardImageUrl(path: string): string {
    return convertFileSrc(path);
}

export async function loadCustomBoardImages(dir: string): Promise<CustomBoardImage[]> {
    if (!dir) return [];

    const entries = await readDir(dir);
    const pngEntries = entries
        .filter((entry) => entry.isFile && entry.name.toLowerCase().endsWith(".png"))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    return await Promise.all(
        pngEntries.map(async (entry) => {
            const path = await join(dir, entry.name);
            return {
                name: entry.name,
                path,
                url: customBoardImageUrl(path),
            };
        }),
    );
}
