import { resourceDir, resolve } from "@tauri-apps/api/path";
import { exists, mkdir } from "@tauri-apps/plugin-fs";

function getStoredDirectory(key: string): string | null {
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    try {
        const parsed = JSON.parse(stored);
        if (typeof parsed !== "string" || parsed.length === 0) return null;
        return isLegacyUserDefault(parsed) ? null : parsed;
    } catch {
        return null;
    }
}

function isLegacyUserDefault(path: string): boolean {
    const normalized = path.replaceAll("\\", "/").toLowerCase();
    return (
        (normalized.includes("/appdata/") && normalized.includes("cn-croissant")) ||
        normalized.endsWith("/documents/encroissant") ||
        normalized.endsWith("/encroissant")
    );
}

async function getInstallDataDir(folder: string): Promise<string> {
    return resolve(await resourceDir(), "cn-croissant-data", folder);
}

async function ensureDirectory(path: string): Promise<string> {
    if (!(await exists(path))) {
        await mkdir(path, { recursive: true });
    }
    return path;
}

export async function getDatabasesDir(): Promise<string> {
    const customDir = getStoredDirectory("databases-dir");
    if (customDir) {
        return ensureDirectory(customDir);
    }

    return ensureDirectory(await getInstallDataDir("db"));
}

export async function getDocumentDir(): Promise<string> {
    const customDir = getStoredDirectory("document-dir");
    if (customDir) {
        return ensureDirectory(customDir);
    }

    return ensureDirectory(await getInstallDataDir("files"));
}

export async function getEnginesDir(): Promise<string> {
    const customDir = getStoredDirectory("engines-dir");
    if (customDir) {
        return ensureDirectory(customDir);
    }

    return ensureDirectory(await getInstallDataDir("engines"));
}

export async function getPuzzlesDir(): Promise<string> {
    const customDir = getStoredDirectory("puzzles-dir");
    if (customDir) {
        return ensureDirectory(customDir);
    }

    return ensureDirectory(await getInstallDataDir("puzzles"));
}
