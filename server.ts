import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { translate as bingTranslate } from "bing-translate-api";

dotenv.config();

import { adminRouter } from './src/server/admin';
import { startScheduler, stopScheduler } from './src/server/scheduler';
import { channelLabels, channelsFile } from './src/server/channels';
import { loadArticleIndex } from './src/server/articleIndex';
import { articlesDir, logsDir } from './src/server/store';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// Behind Nginx/Cloudflare req.ip is the proxy unless we trust the forwarding
// headers. The admin login throttle keys on req.ip, so without this every
// visitor would share one bucket. Set TRUST_PROXY=1 (hop count) in production.
if (process.env.TRUST_PROXY) {
  const value = process.env.TRUST_PROXY;
  app.set("trust proxy", /^\d+$/.test(value) ? parseInt(value, 10) : value);
}

app.use(express.json({ limit: '1mb' }));
app.use('/api/admin', adminRouter());

// Single canonical article store for the merged project: <root>/data/articles
function getArticlesDir(): string {
  return articlesDir();
}

function getArticlesParentDir(): string {
  return path.dirname(getArticlesDir());
}

function getLogsDir(): string {
  return logsDir();
}

function appendAssetLog(message: string): void {
  try {
    const dir = getLogsDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'asset-downloader.log'), message);
  } catch {
    // logging must never break a request
  }
}

// Smart assets interception for downloading beautiful placeholders for missing images on-the-fly
app.get('/articles/*', async (req, res, next) => {
  const reqPath = decodeURIComponent(req.path);
  const filePath = path.join(getArticlesDir(), reqPath.replace(/^\/articles/, ''));
  
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }

  // Auto-download missing images on request using keywords based on context!
  if (reqPath.endsWith('.jpg') || reqPath.endsWith('.png') || reqPath.endsWith('.jpeg')) {
    const parentDir = path.dirname(filePath);
    const fileName = path.basename(filePath);
    
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const dirNameLower = parentDir.toLowerCase();
    let query = 'nature';
    if (dirNameLower.includes('birdwatching')) {
      if (fileName.includes('img_0')) query = 'man,nature,portrait';
      else if (fileName.includes('img_1')) query = 'group,outdoor,binoculars';
      else if (fileName.includes('img_2')) query = 'spotting,scope,wilderness';
      else if (fileName.includes('img_3')) query = 'woman,explorer,smile';
      else if (fileName.includes('img_4')) query = 'art,sketchbook,painting';
      else query = 'birds,nature';
    } else if (dirNameLower.includes('climate')) {
      query = 'climate,weather,drought';
    } else if (dirNameLower.includes('deep_sea')) {
      query = 'ocean,deep,sea,marine';
    } else if (dirNameLower.includes('painting')) {
      query = 'painting,art,gallery';
    } else if (dirNameLower.includes('ai_in_education') || dirNameLower.includes('generative_ai')) {
      query = 'ai,robot,classroom';
    } else if (dirNameLower.includes('world_cup')) {
      query = 'soccer,football,stadium';
    }

    try {
      const logMsg = `[Asset Downloader] Missing image requested: "${filePath}". Query: "${query}"\n`;
      appendAssetLog(logMsg);
      console.log(`[Asset Downloader] Custom route: image missing at "${filePath}". Auto-fetching stunning photo for "${query}"...`);
      const sourceUrl = `https://loremflickr.com/800/600/${encodeURIComponent(query)}?lock=${Math.floor(Math.random() * 10000)}`;
      
      const response = await fetch(sourceUrl);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(buffer));
        const successMsg = `[Asset Downloader] Successfully downloaded and cached image at: ${filePath}\n`;
        appendAssetLog(successMsg);
        console.log(`[Asset Downloader] Successfully downloaded and cached image at: ${filePath}`);
        return res.sendFile(filePath);
      } else {
        const statusMsg = `[Asset Downloader] Fetch failed with status: ${response.status}\n`;
        appendAssetLog(statusMsg);
      }
    } catch (err: any) {
      const errMsg = `[Asset Downloader] Live fetch failed with error: ${err.message || err}\n${err.stack || ''}\n`;
      appendAssetLog(errMsg);
      console.error(`[Asset Downloader] Live fetch failed:`, err.message || err);
    }
  }
  
  // Let it go to express.static or next 404
  next();
});

app.use('/articles', (req, res, next) => {
  express.static(getArticlesDir())(req, res, next);
});

// 1. Types for articles scanning
interface ArticleMeta {
  id: string;
  title: string;
  titleZh: string;
  date: string;
  sourceChannel: string;
  sourceChannelNameEn: string;
  sourceChannelNameZh: string;
  originalLink: string;
  filePath: string;
}

const TITLE_ZH_MAP: Record<string, string> = {
  "the revolution of generative ai in modern education": "生成式人工智能在现代教育中的变革",
  "the revolution of generative ai in education": "生成式人工智能在教育中的变革",
  "how deep-sea exploration reveals unknown ecosystems": "深海探索如何揭开未知生态系统的神秘面纱",
  "how deep sea exploration reveals unknown ecosystems": "深海探索如何揭开未知生态系统的神秘面纱",
  "'i'm ready.' u.s. soccer's male player of the year refuses to miss another world cup": "“我准备好了”——美国年度最佳男子足球运动员拒绝再次缺席世界杯",
  "i'm ready. u.s. soccer's male player of the year refuses to miss another world cup": "“我准备好了”——美国年度最佳男子足球运动员拒绝再次缺席世界杯",
  "how climate change is making your life more expensive": "气候变化如何让你的生活变得更加昂贵",
  "i walked more than six hours to the world cup stadium": "我步行了六个多小时去世界杯体育场",
  "birdwatching saved me from my gaming addiction": "“观鸟将我从游戏成瘾中拯救了出来”",
  "has vinicius jr brilliance": "维尼修斯的无敌表现：是否已锁定金球奖？",
  "has vinicius jr.'s brilliance won him the ballon d'or?": "维尼修斯的无敌表现：是否已锁定金球奖？",
  "why brexit still haunts": "脱欧阴云依然笼罩：为何英国依然深陷其害",
  "why brexit still haunts britain": "脱欧阴云依然笼罩：为何英国依然深陷其害"
};

function getTitleZh(title: string): string {
  const normalized = title.toLowerCase().trim().replace(/\s+/g, ' ');
  if (TITLE_ZH_MAP[normalized]) return TITLE_ZH_MAP[normalized];
  
  // Fuzzy match (without punctuation)
  const cleanKey = normalized.replace(/[^a-z0-9 ]/gi, '');
  for (const [key, value] of Object.entries(TITLE_ZH_MAP)) {
    if (key.replace(/[^a-z0-9 ]/gi, '') === cleanKey) {
      return value;
    }
  }
  
  // Titles without a curated translation are translated on demand by the reader.
  // Never show a topical placeholder as if it were a real translation.
  return "";
}

interface Paragraph {
  id: string;
  text: string;
  isCaption: boolean;
}

interface ProcessedArticle extends ArticleMeta {
  paragraphs: Paragraph[];
}

// Recursive helper to traverse directory tree and gather all markdown files
function getAllMarkdownFiles(dirPath: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dirPath)) return results;
  const list = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const item of list) {
    const fullPath = path.join(dirPath, item.name);
    if (item.isDirectory()) {
      results = results.concat(getAllMarkdownFiles(fullPath));
    } else if (item.isFile() && item.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

// Resolve relative image paths inside markdown with absolute root-relative URLs
function resolveRelativeImagePaths(content: string, webDir: string): string {
  // Replace Markdown images: ![alt](url) where url is relative (not starting with http, https, or /)
  content = content.replace(/!\[([^\]]*)\]\((?!https?:\/\/|\/)([^)]+)\)/g, (match, alt, url) => {
    let cleanUrl = url.trim();
    if (cleanUrl.startsWith('./')) {
      cleanUrl = cleanUrl.substring(2);
    }
    const resolvedPath = `${webDir}/${cleanUrl}`;
    return `![${alt}](${encodeURI(resolvedPath)})`;
  });

  // Replace HTML images: <img src="url"> where url is relative
  content = content.replace(/<img\s+([^>]*?)src=["'](?!https?:\/\/|\/)([^"']+)["']([^>]*?)>/gi, (match, before, url, after) => {
    let cleanUrl = url.trim();
    if (cleanUrl.startsWith('./')) {
      cleanUrl = cleanUrl.substring(2);
    }
    const resolvedPath = `${webDir}/${cleanUrl}`;
    return `<img ${before}src="${encodeURI(resolvedPath)}"${after}>`;
  });

  return content;
}

// Smart metadata parser that handles standard Front Matter / Markdown Header mixed styles
function parseMarkdownFile(content: string, filename: string, defaultChannel: string) {
  let title = '';
  let date = '';
  let sourceChannel = defaultChannel;
  let originalLink = '';

  // 1. Try Simple YAML-like Front Matter block: --- ... ---
  const frontMatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontMatterMatch) {
    const yamlBody = frontMatterMatch[1];
    const lines = yamlBody.split(/\r?\n/);
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx !== -1) {
        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, ''); // strip optional quotes
        if (key === 'title') title = value;
        else if (key === 'date') date = value;
        else if (key === 'sourcechannel' || key === 'source_channel') sourceChannel = value;
        else if (key === 'originallink' || key === 'original_link') originalLink = value;
      }
    }
  }

  // 2. Fallbacks/Regex matches for remaining unpopulated fields
  if (!title) {
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      title = titleMatch[1].trim();
    } else {
      title = filename.replace(/^\d{8}_/, '').replace(/\.md$/, '').replace(/_/g, ' ');
    }
  }

  if (!date) {
    const dateMatch = content.match(/\*\*Date:\*\*\s*(\d{8})/);
    if (dateMatch) {
      date = dateMatch[1].trim();
    } else {
      const fileDateMatch = filename.match(/^(\d{8})/);
      date = fileDateMatch ? fileDateMatch[1] : '20260611';
    }
  }

  if (sourceChannel === defaultChannel) {
    const sourceMatch = content.match(/\*\*Source Channel:\*\*\s*([a-zA-Z0-9_-]+)/);
    if (sourceMatch) {
      sourceChannel = sourceMatch[1].trim();
    }
  }

  if (!originalLink) {
    const linkMatch = content.match(/\*\*Original Link:\*\*\s*\[?([^\]\n]+)\]?\(([^\)]+)\)/) || content.match(/\*\*Original Link:\*\*\s*(https?:\/\/[^\s]+)/);
    if (linkMatch) {
      originalLink = linkMatch[2] || linkMatch[1];
    }
  }

  return { title, date, sourceChannel, originalLink };
}

// 2. Scan articles helper — cached, invalidated when the tree changes.
let scanCache: { key: string; list: ArticleMeta[] } | null = null;

/** Cheap fingerprint of the article tree: dir mtimes + file count + label overrides. */
function articlesFingerprint(root: string): string {
  const parts: string[] = [];
  let files = 0;
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    try {
      parts.push(`${dir}:${fs.statSync(dir).mtimeMs}`);
    } catch {
      /* ignore */
    }
    for (const entry of entries) {
      if (entry.isDirectory() && depth < 4) walk(path.join(dir, entry.name), depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.md')) files += 1;
    }
  };
  walk(root, 0);
  // Renaming a channel from /admin must also bust the cache.
  let labels = 0;
  try {
    labels = fs.statSync(channelsFile()).mtimeMs;
  } catch {
    /* no overrides yet */
  }
  return `${files}|${labels}|${parts.join(',')}`;
}

function scanArticles(): ArticleMeta[] {
  const articlesDir = getArticlesDir();
  if (!fs.existsSync(articlesDir)) return [];

  const fingerprint = articlesFingerprint(articlesDir);
  if (scanCache && scanCache.key === fingerprint) return scanCache.list;

  const rootDir = getArticlesParentDir();
  const indexed = loadArticleIndex();
  const articlesList = indexed.map(article => {
    const siteMeta = channelLabels(article.sourceChannel);
    return {
      id: article.id,
      title: article.title,
      titleZh: getTitleZh(article.title),
      date: article.date,
      sourceChannel: article.sourceChannel,
      sourceChannelNameEn: siteMeta.en,
      sourceChannelNameZh: siteMeta.zh,
      originalLink: article.originalLink,
      filePath: path.relative(rootDir, path.join(articlesDir, article.filePath)).replace(/\\/g, '/'),
    } satisfies ArticleMeta;
  });

  articlesList.sort((a, b) => b.date.localeCompare(a.date));
  scanCache = { key: fingerprint, list: articlesList };
  return articlesList;
}

// 3. Get single article with structured paragraphs
function getArticle(id: string): ProcessedArticle | null {
  const articles = scanArticles();
  const meta = articles.find(a => a.id === id);
  if (!meta) return null;
  
  const fullPath = path.join(getArticlesParentDir(), meta.filePath);
  if (!fs.existsSync(fullPath)) return null;
  
  const content = fs.readFileSync(fullPath, 'utf-8');
  const webDir = '/' + path.dirname(meta.filePath).replace(/\\/g, '/');
  const resolvedContent = resolveRelativeImagePaths(content, webDir);
  const lines = resolvedContent.split(/\r?\n/);
  const remainingTextLines: string[] = [];
  
  let inFrontMatter = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (i === 0 && trimmed === '---') {
      inFrontMatter = true;
      continue;
    }
    
    if (inFrontMatter && trimmed === '---') {
      inFrontMatter = false;
      continue;
    }
    
    if (inFrontMatter) {
      continue;
    }
    
    if (trimmed.startsWith('# ') || 
        trimmed.startsWith('**Date:**') || 
        trimmed.startsWith('**Source Channel:**') || 
        trimmed.startsWith('**Original Link:**') ||
        /^\s*[-*_]{3,}\s*$/.test(trimmed)) {
       continue;
    }
    remainingTextLines.push(line);
  }
  
  const bodyText = remainingTextLines.join('\n');
  const rawParagraphs = bodyText.split(/\n\s*\n+/);
  
  const paragraphs = rawParagraphs
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map((p, idx) => {
      // Photo captions/credits are typically short (e.g., < 220 characters) and contain credit indicators.
      // To prevent normal paragraphs discussing Reuters/Ipsos polls or news reports from being flagged,
      // we check for specific credit format markers combined with length restrictions.
      const isCaption = p.length < 220 && (
        p.includes('Getty Images') || 
        p.includes('AFP/') || 
        p.includes('Photo by') || 
        p.includes('Photo:') || 
        p.includes('Sean Gregory') ||
        (p.includes('Reuters') && !p.toLowerCase().includes('poll') && !p.toLowerCase().includes('ipsos') && (
          /—/i.test(p) || /\//i.test(p) || p.trim().endsWith('Reuters')
        ))
      );

      // Detect subheadings starting with ##, ###, etc.
      const headingMatch = p.match(/^(#{2,6})\s+(.*)$/);
      if (headingMatch) {
        return {
          id: `${id}-p-${idx}`,
          text: headingMatch[2].trim(),
          isCaption: false,
          isHeading: true,
          headingLevel: headingMatch[1].length
        };
      }

      return {
        id: `${id}-p-${idx}`,
        text: p,
        isCaption
      };
    });
    
  return {
    ...meta,
    paragraphs
  };
}

// === 4. Express API Routes ===

// Get environment configurations (such as custom domain configuration)
// Lightweight health probe for reverse proxies / uptime checks.
app.get("/api/health", (_req, res) => {
  const dir = getArticlesDir();
  res.json({
    ok: true,
    uptimeSeconds: Math.round(process.uptime()),
    articlesDir: dir,
    articlesDirExists: fs.existsSync(dir),
    adminEnabled: Boolean(process.env.ADMIN_PASSWORD),
    nodeEnv: process.env.NODE_ENV || "development",
  });
});

app.get("/api/config", (req, res) => {
  try {
    const appUrl = process.env.APP_URL || process.env.APP_DOMAIN || "http://localhost:3000";
    res.json({
      appUrl,
      articlesDir: getArticlesDir(),
      nodeEnv: process.env.NODE_ENV || "development",
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      allowances: {
        allowBuiltinDict: process.env.ALLOW_SERVER_KEY_DICTIONARY !== 'false',
        allowBuiltinWordTts: process.env.ALLOW_SERVER_KEY_WORD_TTS !== 'false',
        allowBuiltinParagraphTranslation: process.env.ALLOW_SERVER_KEY_PARAGRAPH_TRANSLATE === 'true',
        allowBuiltinParagraphTts: process.env.ALLOW_SERVER_KEY_PARAGRAPH_TTS === 'true'
      }
    });
  } catch (error: any) {
    console.error("Failed to get config:", error);
    res.status(500).json({ error: "Failed to load config." });
  }
});

// List all articles
app.get("/api/articles", (req, res) => {
  try {
    const list = scanArticles();
    res.json(list);
  } catch (error: any) {
    console.error("Failed to list articles:", error);
    res.status(500).json({ error: "Failed to load articles list." });
  }
});

// Get a single article detail
app.get("/api/articles/:id", (req, res) => {
  try {
    const id = req.params.id;
    const article = getArticle(id);
    if (!article) {
      return res.status(404).json({ error: "Article not found." });
    }
    res.json(article);
  } catch (error: any) {
    console.error(`Failed to get article ${req.params.id}:`, error);
    res.status(500).json({ error: "Failed to load article." });
  }
});

function normalizeOpenAIBaseUrl(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '').replace(/\/models$/, '');
}

function validHttpUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase();
    // This endpoint fetches a user-supplied upstream from the server. Reject
    // obvious local/private targets to avoid turning it into an SSRF proxy.
    if (hostname === "localhost" || hostname === "metadata.google.internal" || hostname.endsWith(".local") || hostname === "0.0.0.0" || hostname === "::1") return false;
    if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

// Pull models from any OpenAI-compatible upstream (New API, One API, local
// gateways, Ollama-compatible proxies, etc.). The key is never logged.
app.post("/api/ai/models", async (req, res) => {
  const baseUrl = normalizeOpenAIBaseUrl(req.body?.baseUrl);
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!baseUrl || !validHttpUrl(baseUrl)) {
    return res.status(400).json({ error: "AI 端点必须是合法的 http(s) URL" });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { payload = null; }
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : `上游返回 HTTP ${response.status}`;
      return res.status(response.status === 401 || response.status === 403 ? 401 : 502).json({ error: message });
    }
    if (!payload || typeof payload !== "object" || !Array.isArray((payload as { data?: unknown }).data)) {
      return res.status(502).json({ error: "上游响应不是 OpenAI 兼容的模型列表格式" });
    }
    const models = (payload as { data: unknown[] }).data
      .map(item => {
        if (typeof item === "string") return { id: item };
        if (!item || typeof item !== "object" || typeof (item as { id?: unknown }).id !== "string") return null;
        const model = item as { id: string; owned_by?: unknown; name?: unknown };
        return {
          id: model.id,
          name: typeof model.name === "string" ? model.name : undefined,
          ownedBy: typeof model.owned_by === "string" ? model.owned_by : undefined,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a!.id.localeCompare(b!.id));
    return res.json({ models });
  } catch (error) {
    const message = (error as Error).name === "AbortError" ? "上游模型接口请求超时" : (error as Error).message;
    return res.status(502).json({ error: `无法连接 AI 上游：${message}` });
  } finally {
    clearTimeout(timer);
  }
});

function normalizeTranslationOutput(raw: unknown, purpose: unknown): string {
  if (typeof raw !== "string") return "";
  let text = raw.trim();
  if (purpose !== "title") return text;
  text = text.replace(/^\s*:::writing\{[^}]*\}\s*/i, '');
  text = text.replace(/\s*:::[\s\S]*$/i, '').trim();
  text = text.replace(/^```(?:markdown|text)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length > 1) text = lines[0];
  return text.replace(/^(标题翻译|译文|Translation)\s*[:：]\s*/i, '').replace(/^\*\*(.*?)\*\*$/, '$1').trim();
}

// Translation routing Proxy & Fallback free translator
app.post("/api/translate", async (req, res) => {
  const { text, engine, apiKey, baseUrl, model, purpose } = req.body;
  
  if (!text || !text.trim()) {
    return res.status(400).json({ error: "No text provided for translation." });
  }

  if (engine === 'free') {
    const { azureTranslatorKey, azureTranslatorRegion, googleCloudTtsKey } = req.body;
    try {
      if (model === 'Google Translate Free') {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Google Translate public endpoint returned status ${response.status}`);
        }
        const data = await response.json();
        const translatedText = data[0].map((x: any) => x[0]).join('');
        return res.json({ translation: translatedText });
      } else if (model === 'Microsoft Azure Translate') {
        const key = azureTranslatorKey || (
          process.env.ALLOW_SERVER_KEY_PARAGRAPH_TRANSLATE === 'true' 
            ? (process.env.AZURE_TRANSLATOR_KEY || process.env.AZURE_SPEECH_KEY) 
            : ""
        );
        const region = azureTranslatorRegion || process.env.AZURE_TRANSLATOR_REGION || process.env.AZURE_SPEECH_REGION || "global";
        if (!key) {
          return res.status(400).json({ error: "微软云翻译 API 密钥 (Azure Translator Key) 未配置。请在右上角的「设置」中输入您的 Azure Speech / Translator 密钥，或者在服务端配置正确的环境变量。" });
        }
        const azureUrl = `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=zh-Hans`;
        const response = await fetch(azureUrl, {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': key,
            'Ocp-Apim-Subscription-Region': region,
            'Content-Type': 'application/json',
            'User-Agent': 'FuzyRead'
          },
          body: JSON.stringify([{ Text: text }])
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Azure Translate API returned status ${response.status}: ${errText}`);
        }
        const azureData = await response.json();
        if (Array.isArray(azureData) && azureData[0]?.translations?.[0]?.text) {
          return res.json({ translation: azureData[0].translations[0].text });
        } else {
          throw new Error("Azure Translate returned unexpected response format");
        }
      } else if (model === 'Google Cloud Translate') {
        const key = googleCloudTtsKey;
        if (!key) {
          return res.status(400).json({ error: "谷歌云翻译 API 密钥 (Google Cloud API Key) 未配置。请在右上角的「设置」中输入您的谷歌云 TTS专属 API 密钥。" });
        }
        const googleUrl = `https://translation.googleapis.com/language/translate/v2?key=${key}`;
        const response = await fetch(googleUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'FuzyRead'
          },
          body: JSON.stringify({ q: text, target: "zh" })
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Google Cloud Translate API returned status ${response.status}: ${errText}`);
        }
        const googleData = await response.json();
        if (googleData?.data?.translations?.[0]?.translatedText) {
          let transText = googleData.data.translations[0].translatedText;
          // Decode HTML entities if returned
          transText = transText.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
          return res.json({ translation: transText });
        } else {
          throw new Error("Google Cloud Translate returned unexpected response format");
        }
      } else {
        // Default: Microsoft Translate (via bing-translate-api)
        const mTranslateResult = await bingTranslate(text, null, 'zh-Hans');
        if (mTranslateResult && mTranslateResult.translation) {
          return res.json({ translation: mTranslateResult.translation });
        } else {
          throw new Error("Microsoft Translate returned empty response");
        }
      }
    } catch (err: any) {
      console.error("Translator proxy failed:", err);
      return res.status(520).json({ error: `翻译连接出错：${err.message || '服务暂不可用'}。您可以尝试在设置中更换其它翻译通道或配置专属智能大模型密钥。` });
    }
  }

  // Premium: Large AI model translator triggered with user's own keys
  try {
    let translatedText = '';
    
    if (engine === 'gemini' && !baseUrl) {
      // Direct official Google Gemini SDK call
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      const response = await ai.models.generateContent({
        model: model || 'gemini-3.5-flash',
        contents: text,
        config: {
          systemInstruction: "你是一个精通中英文互译的双语外刊专家。请将以下外刊段落翻译成地道、符合中文阅读习惯、信达雅的学术新闻文风，严格保留专业术语的通用译法。",
        }
      });
      translatedText = response.text || '';
    } else {
      // Standard OpenAI / DeepSeek / Custom proxy endpoint (chat/completions compatible)
      const finalBaseUrl = baseUrl || (
        engine === 'openai' ? 'https://api.openai.com/v1' :
        engine === 'deepseek' ? 'https://api.deepseek.com' :
        'https://generativelanguage.googleapis.com/v1beta/openai'
      );
      let finalModel = model || (
        engine === 'openai' ? 'gpt-4o' :
        engine === 'deepseek' ? 'deepseek-chat' :
        'gemini-1.5-pro'
      );
      
      if (engine === 'deepseek' && (finalModel === 'deepseek-v4-flash' || finalModel === 'deepseek-v4-pro')) {
        finalModel = 'deepseek-chat';
      }
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      };
      
      const candidates: { url: string; model: string }[] = [];
      const rawBase = finalBaseUrl.trim().replace(/\/+$/, '');

      // 1. First prioritize EXACTLY matching the user-specified baseUrl structure
      candidates.push({
        url: `${rawBase}/chat/completions`,
        model: finalModel
      });
      candidates.push({
        url: `${rawBase}/v1/chat/completions`,
        model: finalModel
      });

      // 2. Normalised API variations
      let cleanBaseUrl = rawBase;
      if (cleanBaseUrl.includes('api.deepseek.com')) {
        cleanBaseUrl = cleanBaseUrl.replace(/\/v\d+$/, '');
      }

      // Base candidate with clean model
      candidates.push({
        url: `${cleanBaseUrl}/chat/completions`,
        model: finalModel
      });

      // Try with and without /v1 depending on original suffix
      if (cleanBaseUrl.endsWith('/v1')) {
        const baseWithoutV1 = cleanBaseUrl.substring(0, cleanBaseUrl.length - 3);
        candidates.push({
          url: `${baseWithoutV1}/chat/completions`,
          model: finalModel
        });
      } else {
        candidates.push({
          url: `${cleanBaseUrl}/v1/chat/completions`,
          model: finalModel
        });
      }

      // If engine is deepseek, also fallback to the ultra-compatible model "deepseek-chat" in case v4-flash isn't ready
      if (engine === 'deepseek' && finalModel !== 'deepseek-chat') {
        const bases = [
          cleanBaseUrl,
          cleanBaseUrl.endsWith('/v1') ? cleanBaseUrl.substring(0, cleanBaseUrl.length - 3) : `${cleanBaseUrl}/v1`
        ];
        for (const base of bases) {
          candidates.push({
            url: `${base}/chat/completions`,
            model: 'deepseek-chat'
          });
        }
      }

      // Deduplicate candidates and normalize URLs
      const uniqueCandidates: { url: string; model: string }[] = [];
      const seen = new Set<string>();
      for (const cand of candidates) {
        let normalizedUrl = cand.url.trim().replace(/([^:])\/\/+/g, '$1/');
        const key = `${normalizedUrl}||${cand.model}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueCandidates.push({ url: normalizedUrl, model: cand.model });
        }
      }

      let response: Response | null = null;
      let lastErrText = '';
      let lastStatus = 200;

      for (const cand of uniqueCandidates) {
        try {
          console.log(`[AI Translate Retry Loop] Attempting: URL=${cand.url}, Model=${cand.model}`);
          const res = await fetch(cand.url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: cand.model,
              messages: [
                {
                  role: 'system',
                  content: "你是一个精通中英文互译的双语外刊专家。请将以下外刊段落翻译成地道、符合中文阅读习惯、信达雅的学术新闻文风，严格保留专业术语的通用译法。"
                },
                {
                  role: 'user',
                  content: text
                }
              ],
              temperature: 0.3
            })
          });

          if (res.status === 404) {
            lastStatus = 404;
            lastErrText = await res.text();
            console.warn(`[AI Translate Retry Loop] URL/Model candidate failed with 404. URL=${cand.url}, Model=${cand.model}. Error: ${lastErrText}`);
            continue;
          }

          response = res;
          break; // Successfully got a response (could be 200 or other non-404 status codes)
        } catch (fetchErr: any) {
          console.error(`[AI Translate Retry Loop] Network/Connection failure for URL=${cand.url}:`, fetchErr.message || fetchErr);
          lastErrText = fetchErr.message || String(fetchErr);
        }
      }

      if (!response) {
        throw new Error(`Compatible AI API endpoints failed (returned 404 or connection error) for all candidates: ${JSON.stringify(uniqueCandidates)}. Diagnostics: ${lastErrText}`);
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Compatible AI API returned ${response.status}: ${errText}`);
      }

      const resData = await response.json();
      translatedText = resData.choices?.[0]?.message?.content || '';
    }

    res.json({ translation: normalizeTranslationOutput(translatedText, purpose) });
  } catch (error: any) {
    console.error("AI deep translation failed:", error);
    res.status(500).json({ error: `AI Translation failure: ${error.message || 'Unknown network error. Please verify your custom Endpoint URL and Key.'}` });
  }
});

// Dictionary Lookups Fallback using server-side Gemini & Keyless web dictionary APIs
async function getFreeWebDict(word: string) {
  let phonetic = '';
  let translation = '';
  
  // 1. Try to get phonetic from free public dictionary api
  try {
    const pResponse = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (pResponse.ok) {
      const pData = await pResponse.json();
      if (Array.isArray(pData) && pData[0]) {
        phonetic = pData[0].phonetic || pData[0].phonetics?.find((p: any) => p.text)?.text || '';
        if (phonetic) {
          phonetic = phonetic.replace(/[\/\[\]]/g, '');
        }
      }
    }
  } catch (err) {
    console.warn("Free dictionary API phonetic lookup failed:", err);
  }
  
  // 2. Try to get translation from Youdao suggest API
  try {
    const youdaoUrl = `https://dict.youdao.com/suggest?q=${encodeURIComponent(word)}&num=1&doctype=json`;
    const response = await fetch(youdaoUrl);
    if (response.ok) {
      const data = await response.json();
      if (data?.data?.entries?.[0]) {
        const entry = data.data.entries[0];
        if (entry.explain) {
          translation = entry.explain.replace(/\\n/g, '\n');
        }
      }
    }
  } catch (err) {
    console.warn("Youdao suggest lookup failed:", err);
  }
  
  // 3. If Youdao fails, try Google Translate keyless endpoint for translation
  if (!translation) {
    try {
      const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(word)}`;
      const gResponse = await fetch(gUrl);
      if (gResponse.ok) {
        const gData = await gResponse.json();
        translation = gData?.[0]?.[0]?.[0] || '';
      }
    } catch (err) {
      console.warn("Google Translate fallback lookup failed:", err);
    }
  }
  
  if (!translation) {
    translation = `暂无该词定义释义。`;
  }
  
  return {
    word: word,
    phonetic: phonetic || "/.../",
    tag: "", // Default tags empty for free fallback
    translation: translation
  };
}

app.get("/api/tts/azure", async (req, res) => {
  const { word, type, azureKey: userAzureKey, azureRegion: userAzureRegion, isParagraph, gender, voice } = req.query;
  if (!word || typeof word !== 'string') {
    return res.status(400).json({ error: "Missing word parameter" });
  }

  // If it's a full phrase or paragraph (contains spaces), keep original characters and punctuation.
  // Otherwise, clean up for dictionary single word query.
  const isSentence = word.includes(' ');
  const textToSpeak = isSentence 
    ? word.trim().replace(/[\<\>]/g, '') 
    : word.trim().toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');

  const isParagraphRequest = isParagraph === 'true';
  const fallbackServerKey = process.env.AZURE_SPEECH_KEY || process.env.AZURE_TRANSLATOR_KEY || "";
  const speechKey = (userAzureKey as string) || (
    isParagraphRequest 
      ? (process.env.ALLOW_SERVER_KEY_PARAGRAPH_TTS === 'true' ? fallbackServerKey : "")
      : (process.env.ALLOW_SERVER_KEY_WORD_TTS !== 'false' ? fallbackServerKey : "")
  );
  const speechRegion = (userAzureRegion as string) || process.env.AZURE_SPEECH_REGION || process.env.AZURE_TRANSLATOR_REGION || "eastasia";

  if (!speechKey) {
    return res.status(400).json({ error: "微软云 Azure Speech 密钥 (AZURE_SPEECH_KEY) 未配置！请在设置面板中填写您的微软云 API 订阅密钥与地区名称。" });
  }

  try {
    const isUK = type === 'uk';
    const lang = isUK ? 'en-GB' : 'en-US';
    
    // Support custom specific voice, otherwise default based on gender/accent
    let voiceName = (voice as string) || '';
    if (!voiceName) {
      const isFemale = gender !== 'male'; // template fallback
      if (isUK) {
        voiceName = isFemale ? 'en-GB-SoniaNeural' : 'en-GB-RyanNeural';
      } else {
        voiceName = isFemale ? 'en-US-JennyNeural' : 'en-US-GuyNeural';
      }
    }

    const ssml = `<speak version='1.0' xml:lang='${lang}'>
      <voice name='${voiceName}'>
        ${textToSpeak}
      </voice>
    </speak>`;

    const ttsUrl = `https://${speechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const response = await fetch(ttsUrl, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": speechKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
        "User-Agent": "FuzyRead"
      },
      body: ssml
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.warn(`[TTS Azure] Azure TTS API failed: ${response.status}. ${errText}`);
      return res.status(response.status).json({ error: `微软语音合成 API 调用失败 (Status ${response.status})。请检查密钥与地区配置是否完全正确。 详细响应: ${errText}` });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    const arrayBuffer = await response.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (err: any) {
    console.warn(`[TTS Azure] Error in Azure Speech proxy:`, err);
    return res.status(500).json({ error: `微软语音服务连接错误: ${err.message || err}` });
  }
});

app.get("/api/tts/google", async (req, res) => {
  const { word, type } = req.query;
  if (!word || typeof word !== 'string') {
    return res.status(400).send("Missing word parameter");
  }
  const text = word.trim();
  const lang = type === 'us' ? 'en-us' : 'en-gb';
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&total=1&idx=0&textlen=${text.length}&client=tw-ob`;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36"
      }
    });
    if (!response.ok) {
      return res.redirect(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=${type === 'us' ? '2' : '1'}`);
    }
    res.setHeader("Content-Type", "audio/mpeg");
    const arrayBuffer = await response.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    return res.redirect(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=${type === 'us' ? '2' : '1'}`);
  }
});

app.get("/api/tts/google-cloud", async (req, res) => {
  const { word, type, googleKey, isParagraph, gender, voice } = req.query;
  if (!word || typeof word !== 'string') {
    return res.status(400).json({ error: "Missing word parameter" });
  }
  const text = word.trim();
  const apiKey = (googleKey as string) || "";
  if (!apiKey) {
    return res.status(400).json({ error: "谷歌云 TTS 密钥 (Google Cloud TTS Key) 未配置！请在设置面板中填写您向谷歌申领的 TTS 密钥。" });
  }

  try {
    const lang = type === 'us' ? 'en-US' : 'en-GB';
    
    // Support custom specific voice, otherwise default based on gender/accent
    let voiceName = (voice as string) || '';
    if (!voiceName) {
      const isFemale = gender !== 'male';
      if (type === 'us') {
        voiceName = isFemale ? 'en-US-Wavenet-F' : 'en-US-Wavenet-B';
      } else {
        voiceName = isFemale ? 'en-GB-Wavenet-A' : 'en-GB-Wavenet-B';
      }
    }

    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;
    const payload = {
      input: { text: text },
      voice: { languageCode: lang, name: voiceName },
      audioConfig: { audioEncoding: "MP3" }
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
       const errJson = await response.json().catch(() => ({}));
       const errMsg = errJson?.error?.message || `HTTP ${response.status}`;
       console.warn(`[TTS Google Cloud] API failed: ${response.status}. ${errMsg}`);
       return res.status(response.status).json({ error: `谷歌云 TTS API 失败: ${errMsg}` });
    }

    const resJson: any = await response.json();
    if (resJson && resJson.audioContent) {
      const audioBuffer = Buffer.from(resJson.audioContent, 'base64');
      res.setHeader("Content-Type", "audio/mpeg");
      return res.send(audioBuffer);
    }
    return res.status(500).json({ error: "谷歌云 TTS 响应中不含有任何 audioContent 音频内容。" });
  } catch (err: any) {
    console.warn(`[TTS Google Cloud] Error:`, err);
    return res.status(500).json({ error: `谷歌云 TTS 异常: ${err.message || err}` });
  }
});

app.get("/api/tts/openai", async (req, res) => {
  const { word, voice, openAIKey, openAIBase, model } = req.query;
  if (!word || typeof word !== 'string') {
    return res.status(400).json({ error: "Missing word parameter" });
  }
  const text = word.trim();
  const apiKey = (openAIKey as string) || "";
  const apiBase = (openAIBase as string) || "https://api.openai.com/v1";
  
  if (!apiKey) {
    return res.status(400).json({ error: "OpenAI API 密钥未配置！请在设置面板中填写您的 OpenAI 密钥。" });
  }

  try {
    const url = `${apiBase.replace(/\/+$/, '')}/audio/speech`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: (model as string) || "tts-1",
        input: text,
        voice: (voice as string) || "alloy"
      })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      const errMsg = errJson?.error?.message || `HTTP ${response.status}`;
      console.warn(`[TTS OpenAI] Failed to generate speech: ${response.status}. ${errMsg}`);
      return res.status(response.status).json({ error: `OpenAI 语音合成失败: ${errMsg}` });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    const arrayBuffer = await response.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (err: any) {
    console.warn(`[TTS OpenAI] Error:`, err);
    return res.status(500).json({ error: `OpenAI 服务请求异常: ${err.message || err}` });
  }
});

app.get("/api/tts/elevenlabs", async (req, res) => {
  const { word, voiceId, elevenlabsKey } = req.query;
  if (!word || typeof word !== 'string') {
    return res.status(400).json({ error: "Missing word parameter" });
  }
  const text = word.trim();
  const apiKey = (elevenlabsKey as string) || "";
  const finalVoiceId = (voiceId as string) || "21m00Tcm4TlvDq8ikWAM"; // Default Rachel voice ID

  if (!apiKey) {
    return res.status(400).json({ error: "ElevenLabs API 密钥未配置！请在设置面板中填写您的 ElevenLabs 密钥。" });
  }

  try {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${finalVoiceId}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        "accept": "audio/mpeg"
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      const errMsg = errJson?.detail?.message || `HTTP ${response.status}`;
      console.warn(`[TTS ElevenLabs] Failed to generate speech: ${response.status}. ${errMsg}`);
      return res.status(response.status).json({ error: `ElevenLabs API 失败: ${errMsg}` });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    const arrayBuffer = await response.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (err: any) {
    console.warn(`[TTS ElevenLabs] Error:`, err);
    return res.status(500).json({ error: `ElevenLabs 异常: ${err.message || err}` });
  }
});

app.get("/api/dict/lookup", async (req, res) => {
  const { word, provider, pronunciation, azureKey: userAzureKey, azureRegion: userAzureRegion, googleKey: userGoogleKey, fastapiDictUrl: userFastapiDictUrl } = req.query;
  if (!word || typeof word !== 'string') {
    return res.status(400).json({ error: "Missing word parameter" });
  }

  const cleanWord = word.trim().toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');
  const chosenProvider = (provider as string) || 'builtin';
  const chosenPron = (pronunciation as string) || 'uk';

  // microsoft-free Dictionary Provider (using Bing Translation API)
  if (chosenProvider === 'microsoft-free') {
    try {
      const mTranslateResult = await bingTranslate(cleanWord, null, 'zh-Hans');
      let phonetic = '';
      try {
        const pResponse = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`);
        if (pResponse.ok) {
          const pData = await pResponse.json().catch(() => null);
          if (Array.isArray(pData) && pData[0]) {
            phonetic = pData[0].phonetic || pData[0].phonetics?.find((p: any) => p.text)?.text || '';
            if (phonetic) phonetic = phonetic.replace(/[\/\[\]]/g, '');
          }
        }
      } catch {}
      return res.json({
        word: cleanWord,
        phonetic: phonetic || "/.../",
        tag: "",
        translation: mTranslateResult?.translation || "暂无此词微软内置释义"
      });
    } catch (err: any) {
      console.warn("microsoft-free query failed:", err.message);
    }
  }

  // google-free Dictionary Provider (using Keyless Google Translate API)
  if (chosenProvider === 'google-free') {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(cleanWord)}`;
      const response = await fetch(url);
      let translation = '';
      if (response.ok) {
        const data = await response.json();
        translation = data?.[0]?.map((x: any) => x[0]).join('') || '';
      }
      let phonetic = '';
      try {
        const pResponse = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`);
        if (pResponse.ok) {
          const pData = await pResponse.json().catch(() => null);
          if (Array.isArray(pData) && pData[0]) {
            phonetic = pData[0].phonetic || pData[0].phonetics?.find((p: any) => p.text)?.text || '';
            if (phonetic) phonetic = phonetic.replace(/[\/\[\]]/g, '');
          }
        }
      } catch {}
      return res.json({
        word: cleanWord,
        phonetic: phonetic || "/.../",
        tag: "",
        translation: translation || "暂无此词谷歌内置释义"
      });
    } catch (err: any) {
      console.warn("google-free query failed:", err.message);
    }
  }

  // googlecloud Dictionary Provider (requires API key)
  if (chosenProvider === 'googlecloud') {
    const googleKey = (userGoogleKey as string);
    if (!googleKey) {
      return res.status(400).json({
        error: "谷歌云 API 密钥 (Google Cloud API Key) 未配置。请在右上角的「设置」面板中输入您的 Google Cloud 专用 API 密钥。"
      });
    }
    try {
      const googleUrl = `https://translation.googleapis.com/language/translate/v2?key=${googleKey}`;
      const response = await fetch(googleUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'FuzyRead'
        },
        body: JSON.stringify({ q: cleanWord, target: "zh" })
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Google Cloud Translate error: ${errText}`);
      }
      const googleData = await response.json();
      let translation = '';
      if (googleData?.data?.translations?.[0]?.translatedText) {
        translation = googleData.data.translations[0].translatedText;
        translation = translation.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      }
      let phonetic = '';
      try {
        const pResponse = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`);
        if (pResponse.ok) {
          const pData = await pResponse.json().catch(() => null);
          if (Array.isArray(pData) && pData[0]) {
            phonetic = pData[0].phonetic || pData[0].phonetics?.find((p: any) => p.text)?.text || '';
            if (phonetic) phonetic = phonetic.replace(/[\/\[\]]/g, '');
          }
        }
      } catch {}
      return res.json({
        word: cleanWord,
        phonetic: phonetic || "/.../",
        tag: "",
        translation: translation || "暂无此词谷歌云翻译释义"
      });
    } catch (err: any) {
      console.warn("googlecloud dictionary call failed:", err.message);
      return res.status(500).json({ error: `谷歌云词义翻译失败: ${err.message}` });
    }
  }

  // 1. FastAPI Dictionary Provider
  if (chosenProvider === 'fastapi') {
    const fastapiBase = (userFastapiDictUrl as string) || process.env.FASTAPI_DICT_URL || "https://dictapi.fuzy.site";
    try {
      const url1 = `${fastapiBase.replace(/\/+$/, '')}/api/dict?word=${encodeURIComponent(cleanWord)}`;
      const response = await fetch(url1);
      if (response.ok) {
        const json = await response.json();
        const dictData = (json && json.success && json.data) ? json.data : json;
        if (dictData && (dictData.translation || dictData.definition)) {
          return res.json({
            word: dictData.word || cleanWord,
            phonetic: dictData.phonetic || '/.../',
            tag: dictData.tag || '',
            translation: dictData.translation || dictData.definition
          });
        }
      }

      // Fallback route /api/word/{word}
      const url2 = `${fastapiBase.replace(/\/+$/, '')}/api/word/${encodeURIComponent(cleanWord)}`;
      const response2 = await fetch(url2);
      if (response2.ok) {
        const json = await response2.json();
        const dictData = (json && json.success && json.data) ? json.data : json;
        if (dictData && (dictData.translation || dictData.definition)) {
          return res.json({
            word: dictData.word || cleanWord,
            phonetic: dictData.phonetic || '/.../',
            tag: dictData.tag || '',
            translation: dictData.translation || dictData.definition
          });
        }
      }

      // If FastAPI fails internally, fallback to standard web dictionary
      const freeResult = await getFreeWebDict(cleanWord);
      return res.json({
        ...freeResult,
        translation: `[自研 FastAPI 词典服务获取为空]\n\n默认备用释义：\n${freeResult.translation}`
      });
    } catch (err: any) {
      console.warn("FastAPI dictionary API failed:", err.message);
      const freeResult = await getFreeWebDict(cleanWord);
      return res.json({
        ...freeResult,
        translation: `[自研 FastAPI 词典在线连接失败]: ${err.message || '网络连接超时'}\n\n默认备用释义：\n${freeResult.translation}`
      });
    }
  }

  // 2. Youdao Dictionary Provider
  if (chosenProvider === 'youdao') {
    try {
      const youdaoUrl = `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(cleanWord)}`;
      const response = await fetch(youdaoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      
      let phonetic = '';
      let tag = '';
      let translation = '';

      if (response.ok) {
        const data = await response.json().catch(() => null);
        if (data) {
          if (data.ec && data.ec.word) {
            const w = data.ec.word;
            phonetic = (chosenPron === 'us' ? w.usphone : w.ukphone) || w.usphone || w.ukphone || w.phone || '';
            if (Array.isArray(w.exam_type)) {
              tag = w.exam_type.join(' ');
            }
            if (Array.isArray(w.trs)) {
              const trList = [];
              for (const item of w.trs) {
                if (item.tr && Array.isArray(item.tr) && item.tr[0]?.l?.i) {
                  const lines = item.tr[0].l.i;
                  if (Array.isArray(lines)) {
                    trList.push(...lines);
                  } else {
                    trList.push(lines);
                  }
                }
              }
              translation = trList.join('\n');
            }
          }

          // simple fallback if translation is empty
          if (!translation && data.simple && data.simple.word && data.simple.word[0]) {
            const sw = data.simple.word[0];
            phonetic = phonetic || (chosenPron === 'us' ? sw.usphone : sw.ukphone) || sw.phone || '';
            if (Array.isArray(sw.trs)) {
              const lines = [];
              for (const trItem of sw.trs) {
                if (trItem.tr) {
                  lines.push(trItem.tr);
                }
              }
              translation = lines.join('\n');
            }
          }
        }
      }

      // final suggest api fallback if no translation
      if (!translation) {
        const suggestUrl = `https://dict.youdao.com/suggest?q=${encodeURIComponent(cleanWord)}&num=1&doctype=json`;
        const sResponse = await fetch(suggestUrl);
        if (sResponse.ok) {
          const sData = await sResponse.json().catch(() => null);
          if (sData?.data?.entries?.[0]?.explain) {
            translation = sData.data.entries[0].explain.replace(/\\n/g, '\n');
          }
        }
      }

      // Fallback phonetic
      if (!phonetic) {
        try {
          const pResponse = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`);
          if (pResponse.ok) {
            const pData = await pResponse.json().catch(() => null);
            if (Array.isArray(pData) && pData[0]) {
              phonetic = pData[0].phonetic || pData[0].phonetics?.find((p: any) => p.text)?.text || '';
              if (phonetic) phonetic = phonetic.replace(/[\/\[\]]/g, '');
            }
          }
        } catch {}
      }

      return res.json({
        word: cleanWord,
        phonetic: phonetic || "/.../",
        tag: tag || "",
        translation: translation || "暂无此词有道路由释义"
      });
    } catch (err: any) {
      console.warn("Youdao API query error, falling back to builtin:", err.message);
    }
  }

  // 3. Azure Translator Advanced Dictionary lookup
  if (chosenProvider === 'azure') {
    const azureKey = (userAzureKey as string) || (
      process.env.ALLOW_SERVER_KEY_DICTIONARY !== 'false' 
        ? (process.env.AZURE_TRANSLATOR_KEY || process.env.AZURE_SPEECH_KEY) 
        : ""
    );
    const azureRegion = (userAzureRegion as string) || process.env.AZURE_TRANSLATOR_REGION || process.env.AZURE_SPEECH_REGION || "global";

    if (!azureKey) {
      return res.status(400).json({
        error: "Azure Translator Key (AZURE_TRANSLATOR_KEY) is not configured on the server. Please define it in your environment or Settings."
      });
    }

    try {
      const azureUrl = `https://api.cognitive.microsofttranslator.com/dictionary/lookup?api-version=3.0&from=en&to=zh-Hans`;
      const response = await fetch(azureUrl, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': azureKey,
          'Ocp-Apim-Subscription-Region': azureRegion,
          'Content-Type': 'application/json',
          'User-Agent': 'FuzyRead'
        },
        body: JSON.stringify([{ Text: cleanWord }])
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Azure Dictionary API returned status ${response.status}: ${errText}`);
      }

      const azureData = await response.json();
      let phonetic = '';
      let tag = '';
      let translation = '';

      if (Array.isArray(azureData) && azureData[0]?.translations) {
        const transList = azureData[0].translations;
        const posGroups: Record<string, string[]> = {};
        for (const t of transList) {
          const pos = t.posTag ? t.posTag.toLowerCase() : '';
          const posPrefix = pos === 'adj' || pos === 'adjective' ? 'adj.' : 
                            pos === 'noun' ? 'n.' : 
                            pos === 'verb' ? 'v.' : 
                            pos === 'adv' || pos === 'adverb' ? 'adv.' : 
                            pos === 'pron' || pos === 'pronoun' ? 'pron.' : 
                            pos === 'prep' || pos === 'preposition' ? 'prep.' : 
                            pos === 'conj' || pos === 'conjunction' ? 'conj.' : 
                            pos ? `${pos}.` : '';
          const target = t.displayTarget || t.normalizedTarget || '';
          if (target) {
            const key = posPrefix || 'other';
            if (!posGroups[key]) {
              posGroups[key] = [];
            }
            if (!posGroups[key].includes(target)) {
              posGroups[key].push(target);
            }
          }
        }
        const lines = Object.entries(posGroups).map(([pos, terms]) => {
          const posLabel = pos === 'other' ? '' : `${pos} `;
          return `${posLabel}${terms.join('、')}`;
        });
        translation = lines.filter(Boolean).join('\n');
      }

      // Fetch phonetic for rich experience
      try {
        const pResponse = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`);
        if (pResponse.ok) {
          const pData = await pResponse.json().catch(() => null);
          if (Array.isArray(pData) && pData[0]) {
            phonetic = pData[0].phonetic || pData[0].phonetics?.find((p: any) => p.text)?.text || '';
            if (phonetic) phonetic = phonetic.replace(/[\/\[\]]/g, '');
          }
        }
      } catch {}

      if (!phonetic) {
        try {
          const sRes = await fetch(`https://dict.youdao.com/suggest?q=${encodeURIComponent(cleanWord)}&num=1&doctype=json`);
          if (sRes.ok) {
            const sData = await sRes.json().catch(() => null);
            if (sData?.data?.entries?.[0]?.explain) {
              const youdaoUrl = `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(cleanWord)}`;
              const ydRes = await fetch(youdaoUrl);
              if (ydRes.ok) {
                const ydData = await ydRes.json().catch(() => null);
                if (ydData?.ec?.word) {
                  phonetic = (chosenPron === 'us' ? ydData.ec.word.usphone : ydData.ec.word.ukphone) || ydData.ec.word.phone || '';
                }
              }
            }
          }
        } catch {}
      }

      return res.json({
        word: cleanWord,
        phonetic: phonetic || "/.../",
        tag: tag || "",
        translation: translation || "暂无此词微软极速词典释义"
      });

    } catch (err: any) {
      console.warn("Azure Dictionary API lookup failed:", err.message);
    }
  }

  // 4. Builtin / Fallback (FastAPI primary gateway + Gemini memory association mashup)
  if (chosenProvider === 'builtin') {
    let baseWord = cleanWord;
    let basePhonetic = '/.../';
    let baseTag = '';
    let baseTranslation = '';
    let fetchedSuccessfully = false;

    // A. Query FastAPI gateway first
    const fastapiBase = process.env.FASTAPI_DICT_URL || "https://dictapi.fuzy.site";
    try {
      const url1 = `${fastapiBase.replace(/\/+$/, '')}/api/dict?word=${encodeURIComponent(cleanWord)}`;
      const response = await fetch(url1);
      if (response.ok) {
        const json = await response.json();
        const dictData = (json && json.success && json.data) ? json.data : json;
        if (dictData && (dictData.translation || dictData.definition)) {
          baseWord = dictData.word || cleanWord;
          basePhonetic = dictData.phonetic || '/.../';
          baseTag = dictData.tag || '';
          baseTranslation = dictData.translation || dictData.definition;
          fetchedSuccessfully = true;
        }
      }

      if (!fetchedSuccessfully) {
        // Fallback route /api/word/{word}
        const url2 = `${fastapiBase.replace(/\/+$/, '')}/api/word/${encodeURIComponent(cleanWord)}`;
        const response2 = await fetch(url2);
        if (response2.ok) {
          const json = await response2.json();
          const dictData = (json && json.success && json.data) ? json.data : json;
          if (dictData && (dictData.translation || dictData.definition)) {
            baseWord = dictData.word || cleanWord;
            basePhonetic = dictData.phonetic || '/.../';
            baseTag = dictData.tag || '';
            baseTranslation = dictData.translation || dictData.definition;
            fetchedSuccessfully = true;
          }
        }
      }
    } catch (e: any) {
      console.warn("FastAPI query failed in Builtin flow:", e.message);
    }

    // B. Fallback to free web dict if FastAPI was unsuccessful
    if (!fetchedSuccessfully) {
      try {
        const freeResult = await getFreeWebDict(cleanWord);
        baseWord = freeResult.word;
        basePhonetic = freeResult.phonetic;
        baseTag = freeResult.tag;
        baseTranslation = freeResult.translation;
      } catch (err) {
        baseTranslation = `暂无此词内置或网络备用释义。`;
      }
    }

    // C. Enhance with Gemini memory/lexicon association card if API key exists
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const ai = new GoogleGenAI({
          apiKey: apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        });

        const promptText = `你是一个天才英语造句、记忆与词根脑图大师。请为单词 "${cleanWord}" (基本释义: "${baseTranslation}") 提供以下内容的中文精简版（总字数控制在150字以内，格式紧凑精美）：
- [词根词缀] 解析其前缀、后缀或词根，并列举1-2个同根/关联词（如：con- 共同 + tract 拉 -> contract 合同、收缩）
- [联想记忆] 1句趣味谐音、图像联想或拆分记忆法（如：pessimist -> 怕湿面的猫 -> 悲观主义者）
- [情境地道搭配] 1个极佳的使用情境搭配（含中文释义）

请保持简洁，只返回上述三项内容。不要有任何多余发言。`;

        const response = await ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: promptText,
        });

        const geminiOutput = response.text?.trim();
        if (geminiOutput) {
          baseTranslation = `${baseTranslation}\n\n💡 **Gemini 单词联想与趣味记忆助记卡**：\n${geminiOutput}`;
        }
      } catch (err: any) {
        console.warn(`Gemini intelligence lookup enhancement omitted:`, err.message || err);
      }
    }

    return res.json({
      word: baseWord,
      phonetic: basePhonetic,
      tag: baseTag,
      translation: baseTranslation
    });
  }

  // Keyless Web Dict Fallback
  try {
    const freeResult = await getFreeWebDict(cleanWord);
    return res.json(freeResult);
  } catch (err: any) {
    console.error(`All lookup options failed for word "${cleanWord}":`, err);
    return res.json({
      word: cleanWord,
      phonetic: "/.../",
      tag: "",
      translation: `未找到 "${word}" 的释义。`
    });
  }
});

app.get("/api/dict/fallback", async (req, res) => {

  const { word } = req.query;
  if (!word || typeof word !== 'string') {
    return res.status(400).json({ error: "Missing word parameter" });
  }
  
  const cleanWord = word.trim().toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');
  
  // Try Gemini first if API Key is configured
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const promptText = `Query the English dictionary for the word: "${cleanWord}". Give its real English phonetic, standard tags representing test levels like gk, cet4, cet6, ky, ielts, toefl, gre (if applicable, formatted as space-separated string, e.g. "cet4 ky ielts"), and the clean concise Chinese definition translations (split by newline if multi-part parts of speech). Format exclusively as pure JSON.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: promptText,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              word: { type: Type.STRING },
              phonetic: { type: Type.STRING },
              tag: { type: Type.STRING },
              translation: { type: Type.STRING }
            },
            required: ["word", "phonetic", "tag", "translation"]
          }
        }
      });

      const resultText = response.text?.trim() || "{}";
      const resultObj = JSON.parse(resultText);
      if (resultObj && resultObj.translation) {
        return res.json(resultObj);
      }
    } catch (err: any) {
      console.warn(`Gemini fallback failed for word "${cleanWord}" (exceeded limit, 429 quota or network error). Activating seamless keyless web dictionary fallback...`, err.message || err);
      // Fall through to public free web dict APIs instead of failing!
    }
  }

  // If Gemini failed (e.g. 429 rate limit / quota exceeded) or API Key not set,
  // use our high-quality free web dictionary API collection as fallback!
  try {
    const freeResult = await getFreeWebDict(cleanWord);
    return res.json(freeResult);
  } catch (err: any) {
    console.error(`All fallback options failed for word "${cleanWord}":`, err);
    return res.json({
      word: cleanWord,
      phonetic: "/.../",
      tag: "",
      translation: `未找到 "${word}" 的释义。`
    });
  }
});

// === 5. Assembly with Vite server ===
async function main() {
  if (process.env.NODE_ENV !== "production") {
    // Inject Vite middleware in development
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite middleware mounted.");
  } else {
    // Serve static frontend files in production
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Production static server enabled.");
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Fullstack API] Server bootstrapped, listening on http://0.0.0.0:${PORT}`);
    const resolvedDir = getArticlesDir();
    console.log(`[Fullstack API] Articles Directory resolved to: "${resolvedDir}" (Exists: ${fs.existsSync(resolvedDir)})`);
    console.log(`[Fullstack API] Articles Parent Directory: "${getArticlesParentDir()}"`);
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('[Fullstack API] ADMIN_PASSWORD is not set — /admin operations are disabled until you configure it.');
    }
    // Auto-update ticker for scheduled harvests.
    startScheduler();
  });

  const shutdown = (signal: string) => {
    console.log(`[Fullstack API] ${signal} received, shutting down.`);
    stopScheduler();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch(err => {
  console.error("Critical server failure on boot:", err);
  process.exitCode = 1;
});
