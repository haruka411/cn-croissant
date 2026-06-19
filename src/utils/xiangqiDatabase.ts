import { join, resourceDir, basename } from "@tauri-apps/api/path";
import { readDir, readFile, stat } from "@tauri-apps/plugin-fs";
import { positionKey, traverseMainline, type GameNode } from "@/xiangqi/xiangqi";
import { makeGameFromNotation } from "@/xiangqi/notation";
import { parseXqfMainline } from "@/xiangqi/xqf";

export type XiangqiDatabaseFileKind =
    | "cbl"
    | "cbr"
    | "pgn"
    | "xqf"
    | "txt"
    | "wxf"
    | "obk"
    | "other";

export type XiangqiDatabaseFile = {
    path: string;
    name: string;
    extension: string;
    size: number;
    kind: XiangqiDatabaseFileKind;
};

export type XiangqiDatabaseSummary = {
    root: string;
    files: XiangqiDatabaseFile[];
    cblFiles: number;
    cbrFiles: number;
    pgnFiles: number;
    xqfFiles: number;
    textFiles: number;
    obkFiles: number;
    totalBytes: number;
};

export type XiangqiDatabaseGame = {
    id: string;
    path: string;
    name: string;
    sourceKind: XiangqiDatabaseFileKind;
    event: string;
    red: string;
    black: string;
    result: string;
    date: string;
    moveCount: number;
    preview: string;
    notation: string;
    root: GameNode;
};

export type XiangqiCblLibraryInfo = {
    path: string;
    name: string;
    title: string;
    author: string;
    description: string;
    estimatedRecords: number;
    decompressedBytes: number;
    indexedGames: number;
};

export type XiangqiPositionMoveStats = {
    move: string;
    notation: string;
    games: number;
    redWins: number;
    draws: number;
    blackWins: number;
    examples: XiangqiDatabaseGame[];
};

export type XiangqiPositionIndex = Record<string, XiangqiPositionMoveStats[]>;

export type XiangqiDatabaseIndex = {
    schemaVersion: number;
    root: string;
    fingerprint: string;
    updatedAt: number;
    summary: XiangqiDatabaseSummary;
    games: XiangqiDatabaseGame[];
    cblLibraries: XiangqiCblLibraryInfo[];
    positionStats: XiangqiPositionIndex;
};

const DATABASE_ROOT = "engine/database";
const DATABASE_INDEX_DB = "cn-croissant-xiangqi-database-index";
const DATABASE_INDEX_STORE = "indexes";
const DATABASE_INDEX_KEY = "default";
const DATABASE_INDEX_SCHEMA_VERSION = 1;
const MAX_SCAN_FILES = 8000;
const MAX_PARSE_GAMES = 3000;
const MAX_PARSE_CBL_LIBRARIES = 128;
const MAX_GAMES_PER_FILE = 200;
const CBL_ZLIB_OFFSET = 20;
const CBL_HEADER = "CCBridge";

export async function loadXiangqiDatabaseIndex(
    options: { root?: string; force?: boolean; limit?: number } = {},
): Promise<XiangqiDatabaseIndex> {
    const summary = await scanXiangqiDatabase(options.root);
    const fingerprint = makeDatabaseFingerprint(summary.files);

    if (!options.force) {
        const stored = await readStoredDatabaseIndex();
        if (
            stored &&
            stored.schemaVersion === DATABASE_INDEX_SCHEMA_VERSION &&
            stored.root === summary.root &&
            stored.fingerprint === fingerprint
        ) {
            return stored;
        }
    }

    const [games, cblLibraries] = await Promise.all([
        loadXiangqiGames(summary.files, options.limit ?? MAX_PARSE_GAMES),
        loadXiangqiCblLibraryInfos(summary.files),
    ]);
    const cblGameCounts = countIndexedGamesByPath(games);
    const index: XiangqiDatabaseIndex = {
        schemaVersion: DATABASE_INDEX_SCHEMA_VERSION,
        root: summary.root,
        fingerprint,
        updatedAt: Date.now(),
        summary,
        games,
        cblLibraries: cblLibraries.map((library) => ({
            ...library,
            indexedGames: cblGameCounts.get(library.path) ?? 0,
        })),
        positionStats: buildXiangqiPositionIndex(games),
    };

    await writeStoredDatabaseIndex(index);
    return index;
}

export async function scanXiangqiDatabase(root?: string): Promise<XiangqiDatabaseSummary> {
    const databaseRoot = root ?? (await resolveDatabaseRoot());
    const files: XiangqiDatabaseFile[] = [];
    await scanDirectory(databaseRoot, files);
    files.sort((a, b) => a.path.localeCompare(b.path));

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    return {
        root: databaseRoot,
        files,
        cblFiles: files.filter((file) => file.kind === "cbl").length,
        cbrFiles: files.filter((file) => file.kind === "cbr").length,
        pgnFiles: files.filter((file) => file.kind === "pgn").length,
        xqfFiles: files.filter((file) => file.kind === "xqf").length,
        textFiles: files.filter((file) => file.kind === "txt" || file.kind === "wxf").length,
        obkFiles: files.filter((file) => file.kind === "obk").length,
        totalBytes,
    };
}

async function resolveDatabaseRoot() {
    const candidates = [DATABASE_ROOT];
    try {
        candidates.unshift(await join(await resourceDir(), DATABASE_ROOT));
    } catch {
        // Development builds may not expose a resource directory yet.
    }

    for (const candidate of candidates) {
        try {
            await readDir(candidate);
            return candidate;
        } catch {
            // Try the next candidate.
        }
    }
    return DATABASE_ROOT;
}

export async function loadXiangqiPgnGames(
    files: XiangqiDatabaseFile[],
    limit = MAX_PARSE_GAMES,
): Promise<XiangqiDatabaseGame[]> {
    return loadXiangqiGames(
        files.filter((file) => file.kind === "pgn"),
        limit,
    );
}

export async function loadXiangqiGames(
    files: XiangqiDatabaseFile[],
    limit = MAX_PARSE_GAMES,
): Promise<XiangqiDatabaseGame[]> {
    const games: XiangqiDatabaseGame[] = [];
    for (const file of files.filter(isGameFile)) {
        if (games.length >= limit) break;
        const remaining = limit - games.length;
        try {
            games.push(...(await readGamesFromFile(file, remaining)));
        } catch {
            // Keep scanning other files. Unsupported files remain visible in the file list.
        }
    }
    return games;
}

export async function loadXiangqiCblLibraryInfos(
    files: XiangqiDatabaseFile[],
    limit = MAX_PARSE_CBL_LIBRARIES,
): Promise<XiangqiCblLibraryInfo[]> {
    const libraries: XiangqiCblLibraryInfo[] = [];
    for (const file of files.filter((item) => item.kind === "cbl" || item.kind === "cbr")) {
        if (libraries.length >= limit) break;
        try {
            const bytes = await readFile(file.path);
            const data = await maybeDecompressCbl(bytes);
            const metadata = parseCblMetadata(data);
            libraries.push({
                path: file.path,
                name: file.name,
                title: metadata.title || file.name.replace(/\.(cbl|cbr)$/i, ""),
                author: metadata.author,
                description: metadata.description,
                estimatedRecords: estimateCblRecords(data),
                decompressedBytes: data.length,
                indexedGames: 0,
            });
        } catch {
            libraries.push({
                path: file.path,
                name: file.name,
                title: file.name.replace(/\.(cbl|cbr)$/i, ""),
                author: "",
                description: "",
                estimatedRecords: 0,
                decompressedBytes: 0,
                indexedGames: 0,
            });
        }
    }
    return libraries;
}

export function getXiangqiIndexedPositionStats(
    index: XiangqiDatabaseIndex,
    fen: string,
): XiangqiPositionMoveStats[] {
    return index.positionStats[positionKey(fen)] ?? [];
}

export function buildXiangqiPositionStats(
    games: XiangqiDatabaseGame[],
    fen: string,
): XiangqiPositionMoveStats[] {
    return buildXiangqiPositionIndex(games)[positionKey(fen)] ?? [];
}

function buildXiangqiPositionIndex(games: XiangqiDatabaseGame[]): XiangqiPositionIndex {
    const byPosition = new Map<string, Map<string, XiangqiPositionMoveStats>>();

    for (const game of games) {
        const line = traverseMainline(game.root);
        for (let index = 0; index < line.length - 1; index += 1) {
            const node = line[index];
            const child = line[index + 1];
            if (!child.move) continue;
            const key = positionKey(node.fen);
            const positionStats = getOrCreateMap(byPosition, key);
            const current = positionStats.get(child.move) ?? {
                move: child.move,
                notation: child.text || child.move,
                games: 0,
                redWins: 0,
                draws: 0,
                blackWins: 0,
                examples: [],
            };
            current.games += 1;
            if (game.result === "1-0") current.redWins += 1;
            if (game.result === "0-1") current.blackWins += 1;
            if (game.result === "1/2-1/2") current.draws += 1;
            if (current.examples.length < 3) current.examples.push(game);
            positionStats.set(child.move, current);
        }
    }

    return Object.fromEntries(
        [...byPosition.entries()].map(([key, moves]) => [
            key,
            [...moves.values()].sort((a, b) => b.games - a.games || a.move.localeCompare(b.move)),
        ]),
    );
}

async function readGamesFromFile(
    file: XiangqiDatabaseFile,
    limit: number,
): Promise<XiangqiDatabaseGame[]> {
    if (limit <= 0) return [];
    if (file.kind === "xqf") {
        return notationTextsToGames(file, [parseXqfMainline(await readFile(file.path))], limit);
    }

    if (file.kind === "cbl" || file.kind === "cbr") {
        return notationTextsToGames(file, await readCblNotationTexts(file), limit);
    }

    const text = await readText(file.path);
    return notationTextsToGames(file, splitNotationText(text), limit);
}

async function readCblNotationTexts(file: XiangqiDatabaseFile): Promise<string[]> {
    const bytes = await readFile(file.path);
    const texts: string[] = [];

    try {
        texts.push(decodeText(bytes));
    } catch {
        // Try decompressed content below.
    }

    try {
        const data = await maybeDecompressCbl(bytes);
        texts.push(decodeText(data));
    } catch {
        // Some CBL files are plain XML-like text or use a different container.
    }

    return uniqueStrings(texts.flatMap(splitNotationText));
}

function notationTextsToGames(
    file: XiangqiDatabaseFile,
    texts: string[],
    limit: number,
): XiangqiDatabaseGame[] {
    const games: XiangqiDatabaseGame[] = [];
    for (const [index, text] of texts.entries()) {
        if (games.length >= limit || index >= MAX_GAMES_PER_FILE) break;
        const game = notationTextToGame(file, text, index);
        if (game) games.push(game);
    }
    return games;
}

function notationTextToGame(
    file: XiangqiDatabaseFile,
    text: string,
    index: number,
): XiangqiDatabaseGame | null {
    try {
        const game = makeGameFromNotation(text);
        const nodes = traverseMainline(game.root);
        if (nodes.length <= 1) return null;
        const headers = parseHeaders(text);
        return {
            id: `${file.path}#${index}`,
            path: file.path,
            name: file.name,
            sourceKind: file.kind,
            event: headers.Game || headers.Event || game.event || file.name,
            red: game.red,
            black: game.black,
            result: game.result,
            date: headers.Date || headers.Round || "",
            moveCount: nodes.length - 1,
            preview: nodes
                .slice(1, 7)
                .map((node) => node.text || node.move || "")
                .filter(Boolean)
                .join(" "),
            notation: text,
            root: game.root,
        };
    } catch {
        return null;
    }
}

function splitNotationText(text: string): string[] {
    const normalized = text.replace(/\r\n/g, "\n").trim();
    if (!normalized) return [];

    if (/<\s*Move\b/i.test(normalized)) {
        return splitXmlLikeGames(normalized);
    }

    const eventStarts = [...normalized.matchAll(/(?=^\s*\[Event\s+"[^"]*"\]\s*$)/gm)].map(
        (match) => match.index ?? 0,
    );
    if (eventStarts.length > 1) {
        return eventStarts.map((start, index) =>
            normalized.slice(start, eventStarts[index + 1] ?? normalized.length).trim(),
        );
    }

    return [normalized];
}

function splitXmlLikeGames(text: string): string[] {
    const blocks = text.match(/<\s*ChineseChessRecord\b[\s\S]*?<\s*\/\s*ChineseChessRecord\s*>/gi);
    if (blocks?.length) return blocks;

    const moveCount = (text.match(/<\s*Move\b/gi) ?? []).length;
    return moveCount > 0 ? [text] : [];
}

async function scanDirectory(dir: string, files: XiangqiDatabaseFile[]) {
    if (files.length >= MAX_SCAN_FILES) return;
    let entries;
    try {
        entries = await readDir(dir);
    } catch {
        return;
    }

    for (const entry of entries) {
        if (files.length >= MAX_SCAN_FILES) break;
        const path = await join(dir, entry.name);
        if (entry.isDirectory) {
            await scanDirectory(path, files);
            continue;
        }
        const extension = extensionOf(entry.name);
        const kind = kindOfExtension(extension);
        if (kind === "other") continue;
        let size = 0;
        try {
            size = (await stat(path)).size ?? 0;
        } catch {
            // Leave size at zero.
        }
        files.push({
            path,
            name: await basename(path),
            extension,
            size,
            kind,
        });
    }
}

async function readText(path: string): Promise<string> {
    const bytes = await readFile(path);
    return decodeText(bytes);
}

async function maybeDecompressCbl(bytes: Uint8Array): Promise<Uint8Array> {
    const header = new TextDecoder("ascii").decode(bytes.slice(0, CBL_HEADER.length));
    if (header !== CBL_HEADER || bytes.length <= CBL_ZLIB_OFFSET) {
        return bytes;
    }
    const stream = new Blob([bytes.slice(CBL_ZLIB_OFFSET)]).stream();
    const decompressed = stream.pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(decompressed).arrayBuffer());
}

function parseCblMetadata(bytes: Uint8Array) {
    const strings = readCblInitialStrings(bytes);
    const longText = strings.find((item) => item.length > 40) ?? "";
    return {
        title: strings[0] ?? "",
        author: strings[1] ?? "",
        description: cleanupCblText(longText).slice(0, 260),
    };
}

function readCblInitialStrings(bytes: Uint8Array) {
    const strings: string[] = [];
    let offset = 0;
    for (let index = 0; index < 8 && offset + 4 <= bytes.length; index += 1) {
        const length = readUint32(bytes, offset);
        if (length <= 0 || length > 4096 || offset + 4 + length > bytes.length) break;
        offset += 4;
        strings.push(decodeText(bytes.slice(offset, offset + length)));
        offset += length;
        while (offset < bytes.length && bytes[offset] === 0) offset += 1;
    }
    return strings.map(cleanupCblText).filter(Boolean);
}

function estimateCblRecords(bytes: Uint8Array) {
    let count = 0;
    for (let index = 0; index < bytes.length - 48; index += 1) {
        if (!looksLikeDate(bytes, index)) continue;
        if (findNextDate(bytes, index + 8, index + 40) >= 0) {
            count += 1;
            index += 16;
        }
    }
    return count;
}

function looksLikeDate(bytes: Uint8Array, offset: number) {
    if (offset + 10 > bytes.length) return false;
    if (
        isAsciiDigit(bytes[offset]) &&
        isAsciiDigit(bytes[offset + 1]) &&
        isAsciiDigit(bytes[offset + 2]) &&
        isAsciiDigit(bytes[offset + 3]) &&
        (bytes[offset + 4] === 45 || bytes[offset + 4] === 47)
    ) {
        return true;
    }
    return (
        isAsciiDigit(bytes[offset]) &&
        isAsciiDigit(bytes[offset + 1]) &&
        (bytes[offset + 2] === 45 || bytes[offset + 2] === 47)
    );
}

function findNextDate(bytes: Uint8Array, start: number, end: number) {
    for (let index = start; index < Math.min(end, bytes.length - 10); index += 1) {
        if (looksLikeDate(bytes, index)) return index;
    }
    return -1;
}

function isAsciiDigit(value: number) {
    return value >= 48 && value <= 57;
}

function readUint32(bytes: Uint8Array, offset: number) {
    return (
        bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)
    );
}

function decodeText(bytes: Uint8Array) {
    for (const encoding of ["utf-8", "gb18030", "gbk"] as const) {
        try {
            return new TextDecoder(encoding, { fatal: true }).decode(bytes);
        } catch {
            // Try the next encoding.
        }
    }
    return new TextDecoder("utf-8").decode(bytes);
}

function cleanupCblText(text: string) {
    return text
        .replace(/\0/g, "")
        .replace(/\|\|/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function parseHeaders(text: string): Record<string, string> {
    const headers: Record<string, string> = {};
    const regex = /^\[([A-Za-z0-9_]+)\s+"((?:\\"|[^"])*)"\]\s*$/gm;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) {
        headers[match[1]] = match[2].replace(/\\"/g, '"');
    }
    return headers;
}

function extensionOf(name: string) {
    const match = /\.([^.]+)$/.exec(name);
    return match?.[1].toLowerCase() ?? "";
}

function kindOfExtension(extension: string): XiangqiDatabaseFileKind {
    if (extension === "cbl") return "cbl";
    if (extension === "cbr") return "cbr";
    if (extension === "pgn") return "pgn";
    if (extension === "xqf") return "xqf";
    if (extension === "txt") return "txt";
    if (extension === "wxf") return "wxf";
    if (extension === "obk") return "obk";
    return "other";
}

function isGameFile(file: XiangqiDatabaseFile) {
    return ["pgn", "xqf", "txt", "wxf", "cbl", "cbr"].includes(file.kind);
}


function makeDatabaseFingerprint(files: XiangqiDatabaseFile[]) {
    return files
        .map((file) => `${file.path}\0${file.kind}\0${file.size}`)
        .sort()
        .join("\n");
}

function countIndexedGamesByPath(games: XiangqiDatabaseGame[]) {
    const counts = new Map<string, number>();
    for (const game of games) {
        counts.set(game.path, (counts.get(game.path) ?? 0) + 1);
    }
    return counts;
}

function getOrCreateMap<K, V>(source: Map<K, Map<string, V>>, key: K) {
    let value = source.get(key);
    if (!value) {
        value = new Map<string, V>();
        source.set(key, value);
    }
    return value;
}

function uniqueStrings(values: string[]) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function readStoredDatabaseIndex(): Promise<XiangqiDatabaseIndex | null> {
    if (typeof indexedDB === "undefined") return null;
    try {
        const db = await openIndexDb();
        const tx = db.transaction(DATABASE_INDEX_STORE, "readonly");
        const record = await requestToPromise<{ key: string; index: XiangqiDatabaseIndex } | null>(
            tx.objectStore(DATABASE_INDEX_STORE).get(DATABASE_INDEX_KEY),
        );
        db.close();
        return record?.index ?? null;
    } catch {
        return null;
    }
}

async function writeStoredDatabaseIndex(index: XiangqiDatabaseIndex): Promise<void> {
    if (typeof indexedDB === "undefined") return;
    try {
        const db = await openIndexDb();
        const tx = db.transaction(DATABASE_INDEX_STORE, "readwrite");
        tx.objectStore(DATABASE_INDEX_STORE).put({ key: DATABASE_INDEX_KEY, index });
        await transactionDone(tx);
        db.close();
    } catch {
        // A failed persistent cache write should not block the database page.
    }
}

function openIndexDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_INDEX_DB, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(DATABASE_INDEX_STORE)) {
                db.createObjectStore(DATABASE_INDEX_STORE, { keyPath: "key" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}
