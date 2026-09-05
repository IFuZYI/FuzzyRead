import path from "node:path";

import { channelsPath, readJson, writeJson } from "./store";

/** Bilingual display names for one article channel folder. */
export interface ChannelLabel {
  en: string;
  zh: string;
}

/**
 * Curated labels for the channels that ship with the project. Admin overrides in
 * data/state/channels.json win; anything still unknown falls back to a readable
 * name derived from the folder, so a feed added at runtime shows up immediately.
 */
const BUILTIN: Record<string, ChannelLabel> = {
  bbc_english_top_articles: { en: "BBC News", zh: "BBC 新闻" },
  bbc_english_world_articles: { en: "BBC World", zh: "BBC 国际" },
  bbc_english_business_articles: { en: "BBC Business", zh: "BBC 商业" },
  bbc_english_technology_articles: { en: "BBC Technology", zh: "BBC 科技" },
  bbc_english_science_articles: { en: "BBC Science", zh: "BBC 科学" },
  bbc_english_health_articles: { en: "BBC Health", zh: "BBC 健康" },
  bbc_english_arts_articles: { en: "BBC Arts", zh: "BBC 文艺" },
  bbc_chinese_simp_articles: { en: "BBC Chinese (Simplified)", zh: "BBC 中文（简体）" },
  bbc_chinese_trad_articles: { en: "BBC Chinese (Traditional)", zh: "BBC 中文（繁體）" },
  time_english_top_articles: { en: "TIME", zh: "时代周刊" },
  nyt_english_articles: { en: "The New York Times", zh: "纽约时报" },
};

/** Turn `guardian_world_articles` into `Guardian World`. */
function humanize(folder: string): string {
  const pretty = folder
    .replace(/_articles$/, "")
    .split("_")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return pretty || folder;
}

function readOverrides(): Record<string, ChannelLabel> {
  const raw = readJson<Record<string, unknown>>(channelsPath(), {});
  const clean: Record<string, ChannelLabel> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const { en, zh } = value as Partial<ChannelLabel>;
    if (typeof en === "string" && typeof zh === "string" && en.trim() && zh.trim()) {
      clean[key] = { en: en.trim(), zh: zh.trim() };
    }
  }
  return clean;
}

/** Resolve display names for a channel folder: override → builtin → derived. */
export function channelLabels(folder: string): ChannelLabel {
  const override = readOverrides()[folder];
  if (override) return override;
  const builtin = BUILTIN[folder];
  if (builtin) return builtin;
  const pretty = humanize(folder);
  return { en: pretty, zh: pretty };
}

/** Every channel the admin may rename, with its effective labels and origin. */
export function listChannels(folders: string[]): {
  folder: string;
  en: string;
  zh: string;
  source: "custom" | "builtin" | "derived";
}[] {
  const overrides = readOverrides();
  return folders
    .slice()
    .sort()
    .map(folder => {
      if (overrides[folder]) return { folder, ...overrides[folder], source: "custom" as const };
      if (BUILTIN[folder]) return { folder, ...BUILTIN[folder], source: "builtin" as const };
      const pretty = humanize(folder);
      return { folder, en: pretty, zh: pretty, source: "derived" as const };
    });
}

/**
 * Store or clear one channel's labels. Passing null for both names removes the
 * override so the builtin/derived name applies again.
 */
export function setChannelLabel(folder: string, en: string | null, zh: string | null): ChannelLabel | null {
  const overrides = readOverrides();
  if (en === null && zh === null) {
    delete overrides[folder];
    writeJson(channelsPath(), overrides);
    return null;
  }
  const label: ChannelLabel = {
    en: (en ?? "").trim(),
    zh: (zh ?? "").trim(),
  };
  if (!label.en || !label.zh) throw new Error("中英文名称都不能为空");
  if (label.en.length > 80 || label.zh.length > 80) throw new Error("名称长度不能超过 80 个字符");
  overrides[folder] = label;
  writeJson(channelsPath(), overrides);
  return label;
}

/** Path helper re-exported for tests/diagnostics. */
export function channelsFile(): string {
  return path.resolve(channelsPath());
}
