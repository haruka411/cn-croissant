import { invoke } from "@tauri-apps/api/core";
import { commands } from "@/bindings";
import {
    type Engine,
    type LocalEngine,
    normalizeXiangqiEngineDefaults,
    requiredEngineSettings,
} from "@/utils/engines";
import { unwrap } from "@/utils/unwrap";

type BuiltinEngine = {
    name: string;
    path: string;
    protocol: "uci" | "ucci";
};

export async function detectBuiltinPikafish(): Promise<LocalEngine> {
    const builtin = await invoke<BuiltinEngine>("detect_builtin_engine");
    const config = await commands
        .getEngineConfig(builtin.path)
        .then((result) => unwrap(result))
        .catch(() => null);

    return {
        type: "local",
        id: "builtin-pikafish",
        name: config?.name || builtin.name || "Pikafish",
        version: "",
        path: builtin.path,
        protocol: builtin.protocol,
        image: "",
        loaded: true,
        go: { t: "Infinite" },
        settings: normalizeXiangqiEngineDefaults(
            config
                ? config.options
                      .filter((option) => requiredEngineSettings.includes(option.value.name))
                      .filter((option) => option.type !== "button")
                      .map((option) => ({
                          name: option.value.name,
                          value: option.value.default as string | number | boolean | null,
                      }))
                : null,
        ),
    };
}

export async function upsertBuiltinPikafish(engines: Engine[]): Promise<LocalEngine[]> {
    const localEngines = engines.filter((engine): engine is LocalEngine => engine.type === "local");
    const builtin = await detectBuiltinPikafish();
    const hasBuiltin = localEngines.some(
        (engine) => engine.id === builtin.id || engine.path === builtin.path,
    );

    if (hasBuiltin) {
        return localEngines.map((engine) =>
            engine.id === builtin.id || engine.path === builtin.path
                ? {
                      ...engine,
                      id: builtin.id,
                      path: builtin.path,
                      protocol: engine.protocol ?? builtin.protocol,
                      name: engine.name || builtin.name,
                      go: engine.go ?? builtin.go,
                      settings: normalizeXiangqiEngineDefaults(
                          engine.settings?.length ? engine.settings : builtin.settings,
                      ),
                      loaded: engine.loaded ?? true,
                  }
                : engine,
        );
    }

    return [builtin, ...localEngines];
}
