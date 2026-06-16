import {
  ActionIcon,
  Autocomplete,
  Button,
  createTheme,
  Input,
  localStorageColorSchemeManager,
  MantineProvider,
  Textarea,
  TextInput,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { listen } from "@tauri-apps/api/event";
import { attachConsole, info, warn } from "@tauri-apps/plugin-log";
import { getDefaultStore, useAtomValue, useSetAtom } from "jotai";
import { ContextMenuProvider } from "mantine-contextmenu";
import { useEffect, useRef } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import {
  databaseConversionStateAtom,
  enginesAtom,
  appFontFamilyAtom,
  type AppFontFamily,
  fontSizeAtom,
  primaryColorAtom,
  referenceDbAtom,
  spellCheckAtom,
  storedDatabasesDirAtom,
  storedDocumentDirAtom,
  storedEnginesDirAtom,
} from "./state/atoms";

import "@/styles/chessgroundBaseOverride.css";
import "@/styles/chessgroundColorsOverride.css";

import "@mantine/charts/styles.css";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/tiptap/styles.css";

import "mantine-contextmenu/styles.css";
import "mantine-datatable/styles.css";

import "@/styles/global.css";

import { commands } from "./bindings";

const colorSchemeManager = localStorageColorSchemeManager({
  key: "mantine-color-scheme",
});

import ErrorComponent from "@/components/ErrorComponent";
import { upsertBuiltinPikafish } from "@/utils/builtinEngine";
import { getDatabasesDir, getDocumentDir, getEnginesDir } from "@/utils/directories";
import { initUserAgent } from "@/utils/http";
import { routeTree } from "./routeTree.gen";

export type Dirs = {
  documentDir: string;
  databasesDir: string;
  enginesDir: string;
};

const router = createRouter({
  routeTree,
  defaultErrorComponent: ErrorComponent,
  context: {
    loadDirs: async () => {
      const store = getDefaultStore();

      const documentDir = await getDocumentDir();
      const databasesDir = await getDatabasesDir();
      const enginesDir = await getEnginesDir();

      if (shouldUseDefaultDir(store.get(storedDocumentDirAtom))) {
        store.set(storedDocumentDirAtom, documentDir);
      }

      if (shouldUseDefaultDir(store.get(storedDatabasesDirAtom))) {
        store.set(storedDatabasesDirAtom, databasesDir);
      }

      if (shouldUseDefaultDir(store.get(storedEnginesDirAtom))) {
        store.set(storedEnginesDirAtom, enginesDir);
      }

      return {
        documentDir,
        databasesDir,
        enginesDir,
      } as Dirs;
    },
  },
});

function shouldUseDefaultDir(path: string): boolean {
  if (!path) return true;
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  return (
    (normalized.includes("/appdata/") && normalized.includes("cn-croissant")) ||
    normalized.endsWith("/documents/encroissant") ||
    normalized.endsWith("/encroissant")
  );
}
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const preloadReferenceDb = async (store: ReturnType<typeof getDefaultStore>) => {
  const referenceDb = store.get(referenceDbAtom);
  if (referenceDb) {
    info(`Preloading reference database: ${referenceDb}`);
    commands.preloadReferenceDb(referenceDb).catch((e: unknown) => {
      info(`Failed to preload reference database: ${e}`);
    });
  }
};

function useAppStartup() {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const startupSequence = async () => {
      await commands.closeSplashscreen();
      await initUserAgent();

      const detach = await attachConsole();
      info("React app started successfully");

      const store = getDefaultStore();
      store.set(enginesAtom, async (prev) => {
        try {
          return await upsertBuiltinPikafish(await prev);
        } catch (e) {
          warn(`Failed to initialize bundled Pikafish: ${e}`);
          return (await prev).filter((engine) => engine.type === "local");
        }
      });

      await preloadReferenceDb(store);

      return detach;
    };

    let detachFn: (() => void) | undefined;
    startupSequence().then((fn) => {
      detachFn = fn;
    });

    return () => {
      if (detachFn) detachFn();
    };
  }, []);
}

export default function App() {
  const primaryColor = useAtomValue(primaryColorAtom);
  const appFontFamily = useAtomValue(appFontFamilyAtom);
  const fontSize = useAtomValue(fontSizeAtom);
  const spellCheck = useAtomValue(spellCheckAtom);
  const setDatabaseConversionState = useSetAtom(databaseConversionStateAtom);

  useAppStartup();

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}%`;
  }, [fontSize]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<[number, number, string | null]>("convert_progress", (event) => {
      const [totalGames, elapsedMs, sourceFileName] = event.payload;
      setDatabaseConversionState((prev) => ({
        ...prev,
        inProgress: true,
        totalGames,
        elapsedSeconds: elapsedMs / 1000,
        sourceFileName: sourceFileName ?? prev.sourceFileName,
      }));
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [setDatabaseConversionState]);

  const theme = createTheme({
    fontFamily: appFontFamilyToCss(appFontFamily),
    primaryColor,
    colors: {
      dark: [
        "#C1C2C5",
        "#A6A7AB",
        "#909296",
        "#5c5f66",
        "#373A40",
        "#2C2E33",
        "#25262b",
        "#1A1B1E",
        "#141517",
        "#101113",
      ],
    },
    components: {
      ActionIcon: ActionIcon.extend({
        defaultProps: {
          variant: "subtle",
        },
      }),
      Button: Button.extend({
        defaultProps: {
          color: primaryColor,
        },
      }),
      TextInput: TextInput.extend({ defaultProps: { spellCheck } }),
      Autocomplete: Autocomplete.extend({ defaultProps: { spellCheck } }),
      Textarea: Textarea.extend({ defaultProps: { spellCheck } }),
      Input: Input.extend({
        defaultProps: {
          // @ts-expect-error - Solve mantine input type check
          spellCheck,
        },
      }),
    },
  });

  return (
    <DndProvider backend={HTML5Backend}>
      <MantineProvider
        colorSchemeManager={colorSchemeManager}
        defaultColorScheme="dark"
        theme={theme}
      >
        <ContextMenuProvider>
          <Notifications />
          <RouterProvider router={router} />
        </ContextMenuProvider>
      </MantineProvider>
    </DndProvider>
  );
}

function appFontFamilyToCss(fontFamily: AppFontFamily): string {
  switch (fontFamily) {
    case "microsoft-yahei":
      return '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
    case "simhei":
      return '"SimHei", "Microsoft YaHei", sans-serif';
    case "simsun":
      return '"SimSun", "Songti SC", serif';
    case "kaiti":
      return '"KaiTi", "STKaiti", "Kaiti SC", serif';
    case "serif":
      return "serif";
    default:
      return '"Inter", "Segoe UI", "Microsoft YaHei", sans-serif';
  }
}
