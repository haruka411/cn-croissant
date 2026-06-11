import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import { parseXqfMainline } from "./xqf";

export async function readXiangqiNotationFile(path: string): Promise<string> {
    if (/\.xqf$/i.test(path)) {
        return parseXqfMainline(await readFile(path));
    }
    return readTextFile(path);
}
