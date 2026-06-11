import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import i18n from "i18next";
import { createRoot } from "react-dom/client";
import { initReactI18next } from "react-i18next";
import App from "./App";

import en_US from "./translation/en-US.json";
import zh_CN from "./translation/zh-CN.json";
import zh_TW from "./translation/zh-TW.json";
import { setAutoFreeze } from "immer";
import LanguageDetector from "i18next-browser-languagedetector";

function normalizeLanguage(language: string | readonly string[] | undefined): string {
  const value = Array.isArray(language) ? language[0] : language;
  const normalized = (value || "").replace("_", "-").toLowerCase();

  if (
    normalized === "zh-tw" ||
    normalized === "zh-hk" ||
    normalized === "zh-mo" ||
    normalized === "zh-hant"
  ) {
    return "zh-TW";
  }

  if (
    normalized === "zh-cn" ||
    normalized === "zh-sg" ||
    normalized === "zh-hans" ||
    normalized === "zh"
  ) {
    return "zh-CN";
  }

  if (normalized === "en" || normalized.startsWith("en-")) {
    return "en-US";
  }

  return "zh-CN";
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      "en-US": en_US,
      "zh-CN": zh_CN,
      "zh-TW": zh_TW,
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      convertDetectedLanguage: normalizeLanguage,
    },
    supportedLngs: ["en-US", "zh-CN", "zh-TW"],
    fallbackLng: "zh-CN",
    returnEmptyString: false,
  });

dayjs.extend(customParseFormat);

setAutoFreeze(false);

const container = document.getElementById("app");
const root = createRoot(container!);
root.render(<App />);
