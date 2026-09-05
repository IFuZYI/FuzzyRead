# FuzyRead · 外刊精读平台

一套完整的英语精读工作流：Python 采集器抓取外刊 RSS 全文，Express 提供文章、翻译、词典、朗读 API，React 前端负责阅读，`/admin` 后台负责运维与定时更新。界面遵循 Apple 设计语言。

## 在线 Demo

访问：**[news.fuzy.site](https://news.fuzy.site)**

`news.fuzy.site` 是项目在线 Demo，用于展示 FuzyRead 的阅读端、采集后台和相关功能。Demo 的文章数据、服务可用性和自动采集状态可能随时变化，不作为生产服务 SLA 或数据备份来源。

---

## 目录

- [快速开始](#快速开始)
- [功能](#功能)
- [项目结构](#项目结构)
- [/admin 后台](#admin-后台)
- [采集器](#采集器)
- [扩充新闻源](#扩充新闻源)
- [环境变量](#环境变量)
- [API](#api)
- [测试](#测试)
- [Demo 部署说明](#demo-部署说明)
- [故障排查](#故障排查)

---

## 快速开始

```bash
# 1. 安装依赖
npm install
npm run harvester:install        # 用 uv 创建 .venv 并装 Python 依赖

# 2. 配置
cp .env.example .env
# 编辑 .env，至少设置 ADMIN_PASSWORD（不设则 /admin 无法登录）

# 3. 启动开发服务器
npm run dev
```

| 地址 | 说明 |
| --- | --- |
| http://localhost:3000 | 阅读端 |
| http://localhost:3000/admin | 采集后台 |

首次运行 `data/articles/` 若为空，去 `/admin` 点「最新增量」抓一批文章即可。

### 前置条件

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 22.5 | 需要内置 `node:sqlite`、`node --test` 与全局 `fetch` |
| Python | ≥ 3.10 | 采集器运行时 |
| uv | 最新 | Python 包管理（本项目不用 pip） |

---

## 功能

### 阅读端

- 双语对照：段落级中英切换，译文用左侧蓝线标注，不打断阅读节奏
- 划词查词：音标、释义、考试标签、词性，支持单词发音
- 段落朗读：浏览器 TTS 或云端 TTS（Azure / OpenAI / ElevenLabs / Google Cloud / 有道）
- 多翻译引擎：免费引擎（Bing / Azure）或自带 Key 的 OpenAI / Gemini / DeepSeek / 自定义端点
- 频道 · 日期 · 关键词筛选，分页浏览
- 阅读偏好持久化：字号、字体、发音口音、朗读音色

### 采集端

- RSS 增量同步：只抓新文章，URL 级去重
- Wayback 历史回溯：从 Web Archive 快照补齐任意年份区间
- 失败重试：损坏快照单独记账，可定点重跑
- 数据驱动的正文清洗：选择器与噪声规则全在 `harvester/settings/parsers.json`，加站点不用改代码
- 富媒体拦截：正文含 `table` / `iframe` / `video` 的页面直接跳过，只保留适合精读的图文长文

### 运维端（`/admin`）

- 定时自动更新：每日定点或固定间隔，支持重启后补跑错过的计划
- 手动采集：三种模式 + 订阅源多选 + 历史年份自定义
- 订阅源管理：增删、保存前测试连通性
- 频道名称自定义：中英文双语显示名可改，可恢复默认
- 任务历史：状态、耗时、退出码、完整输出，运行中 3 秒轮询
- 日志查看与过期清理
- 登录限流：同 IP 15 分钟内 10 次失败即锁定

---

## 项目结构

```
.
├── server.ts                  Express 入口：文章 API、翻译、TTS、词典
├── src/
│   ├── App.tsx                阅读端
│   ├── AdminApp.tsx           /admin 后台
│   ├── main.tsx               路径路由：/admin* → AdminApp，其余 → App
│   ├── index.css              Apple 设计系统（Tailwind v4 @theme）
│   ├── types.ts               共享类型
│   ├── components/            ArticleCard · ArticleImage · WordPopup · SettingsPanel
│   ├── server/
│   │   ├── admin.ts           后台 API + 鉴权 + 限流
│   │   ├── jobs.ts            采集任务生命周期
│   │   ├── scheduler.ts       定时调度
│   │   ├── channels.ts        频道显示名解析
│   │   └── store.ts           原子 JSON 存储 + 路径解析
│   └── utils/api.ts
├── harvester/
│   ├── runner.py              非交互入口（后台调用这个，stdout 输出 JSON）
│   ├── main.py                交互菜单 + CLI
│   ├── downloader.py          RSS / Wayback 抓取与落盘
│   ├── utils.py               正文提取与清洗
│   ├── config.py              路径与配置加载
│   ├── settings/
│   │   ├── feeds.json         订阅源清单
│   │   ├── parsers.json       站点解析档案 + 全局拦截规则
│   │   └── TEMPLATE_SPEC.md   配置字段说明
│   └── tests/
├── tests/                     Node API、调度器、前端工具、SQLite 索引
├── data/
│   ├── articles/              文章唯一存储：<频道>/<年>/<月>/*.md
│   ├── logs/                  采集日志
│   └── state/                 任务、调度、频道名、SQLite 文章索引（运行时生成）
├── archive/                   历史遗留文件
└── .venv/                     Python 环境（在项目根，不在 harvester/ 下）
```

设计约定：`data/articles/` 是文章的唯一存储位置，采集器写、Express 读，两侧都通过环境变量解析路径，不存在第二份副本。`data/state/articles.sqlite` 只保存文章元数据索引，不保存正文；正文仍以 Markdown 文件为准。

---

## /admin 后台

`ADMIN_PASSWORD` 未设置时后台完全禁用（登录接口返回 503）。

会话是 HttpOnly Cookie，`SameSite=Strict`，12 小时过期。`NODE_ENV=production` 时带 `Secure` 标记——也就是说生产环境必须走 HTTPS，否则浏览器不会回传 Cookie。

### 自动更新

| 配置项 | 取值 | 说明 |
| --- | --- | --- |
| 调度方式 | 每日定点 / 固定间隔 | |
| 执行时间 | `HH:MM` | 服务器本地时区 |
| 间隔 | 15–10080 分钟 | 下限 15 分钟，避免高频打扰源站 |
| 采集模式 | 最新增量 / 失败重试 | 历史模式禁止自动运行——耗时且会密集访问 Wayback |
| 订阅源 | 全选或子集 | |
| 补跑 | 开 / 关 | 开启时，服务重启发现错过的计划会立刻补跑一次 |

调度状态存在 `data/state/schedule.json`，进程重启后恢复。ticker 每 30 秒检查一次，手动任务运行中时自动跳过本轮，下一轮再试。任务结束后终态（完成 / 失败 / 超时）回写到调度状态，后台可见。

### 手动采集

同一时刻只允许一个采集任务（并发请求返回 409）。任务超时上限由 `JOB_TIMEOUT_MS` 控制，默认 1 小时，超时会被终止并记为 `timeout`。任务历史保留最近 60 条，写在 `data/state/jobs.json`。

---

## 采集器

```bash
.venv/bin/python harvester/main.py                    # 交互菜单
.venv/bin/python harvester/main.py --mode latest      # 最新增量
.venv/bin/python harvester/main.py --mode retry       # 失败重试
.venv/bin/python harvester/main.py --mode history --start 2020 --end 2024
.venv/bin/python harvester/main.py --mode latest --feeds bbc_english_top time_english_top
```

`runner.py` 是给后台用的非交互版本，参数相同，最后在 stdout 打印一行 JSON 摘要。

### 文章索引

服务首次启动或首次请求文章列表时，会在 `data/state/articles.sqlite` 创建元数据索引。索引只保存标题、日期、频道、来源链接、文件路径和文件 mtime/size，正文与图片仍保存在 `data/articles/`。后续请求只遍历文件名并比较 mtime/size：未改变的 Markdown 不再解析，新增/修改文件增量更新，删除文件同步移除。升级解析规则后删除 `data/state/articles.sqlite`，下次请求会自动重建。

SQLite 使用 Node.js 内置 `node:sqlite`，不需要 `better-sqlite3` 或编译原生模块，因此生产环境 Node.js 最低版本为 22.5。

### 三种模式

| 模式 | 数据源 | 用途 |
| --- | --- | --- |
| `latest` | RSS 当前内容 | 日常增量，配合定时任务 |
| `history` | Wayback Machine 快照 | 补齐历史区间；耗时长，国内网络需代理 |
| `retry` | `snapshot_failed.log` | 重跑历史模式失败的快照 |

### 落盘结构

```
data/articles/bbc_english_top_articles/
├── 2026/06/20260614_Article_Title.md
├── snapshot_history.log      已处理的快照 URL
├── snapshot_failed.log       失败的快照 URL（retry 模式读它）
└── downloaded_urls.log       已落盘的文章 URL（去重账本）
```

---

## 扩充新闻源

### 只加订阅源

`/admin` → 订阅源 → 填标识和 RSS 地址 → 点「测试」确认连通 → 添加。

标识格式 `<站点>_<语言>_<版块>`，它决定文章存储的文件夹名（`<标识>_articles`）。

新增源立刻可用：解析用通用档案，前端显示名由标识自动推导（`guardian_world` → `Guardian World`），之后可在「频道名称」里改成正式中英文名。

### 加专属解析档案

通用档案抓不干净时，在 `harvester/settings/parsers.json` 的 `site_configs` 里加一段：

```json
"guardian": {
  "match": ["guardian", "theguardian.com"],
  "core_selectors": ["#maincontent", ".article-body-commercial-selector"],
  "paragraph_class_pattern": "dcr-|article-body",
  "bad_sub_selectors": [".submeta", ".site-message", "aside"]
}
```

| 字段 | 作用 |
| --- | --- |
| `match` | 命中订阅源标识或 URL 中的关键词即启用该档案 |
| `core_selectors` | 正文容器，按顺序瀑布式匹配，先命中先用 |
| `paragraph_class_pattern` | 容器没匹配上时，用这个正则找段落类名反推容器 |
| `bad_sub_selectors` | 正文内需要删除的噪声节点 |

未命中任何 `match` 的源走 `generic` 档案（由 `default_site_profile` 指定）。字段完整说明见 `harvester/settings/TEMPLATE_SPEC.md`。

JSON 里写正则要双写反斜杠：`\\.gif`。

---

## 环境变量

```bash
cp .env.example .env
```

### 必填

| 变量 | 说明 |
| --- | --- |
| `ADMIN_PASSWORD` | 不设则 `/admin` 完全禁用 |

### 服务

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | |
| `NODE_ENV` | `development` | `production` 时启用静态服务 + Secure Cookie |
| `APP_URL` | `http://localhost:3000` | 分享链接用的公开地址 |
| `TRUST_PROXY` | 空 | 反代后设为 `1`，否则登录限流会把所有访客算作同一 IP |
| `JOB_TIMEOUT_MS` | `3600000` | 采集任务超时上限 |

### 路径

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DATA_DIR` | `data` | |
| `ARTICLES_DIR` | `data/articles` | |
| `HARVESTER_DIR` | `harvester` | |
| `PYTHON_BIN` | `.venv/bin/python` | 相对路径按 cwd 解析 |

Python 侧另有 `NEWS_DATA_DIR` / `NEWS_ARTICLES_DIR` / `NEWS_LOG_DIR` / `NEWS_FEEDS_PATH` / `NEWS_PARSERS_PATH`。`config.py` 从 `__file__` 解析路径，所以采集器在任何工作目录下都能跑。

### 可选服务商 Key

| 变量 | 用途 |
| --- | --- |
| `GEMINI_API_KEY` | Gemini 翻译 |
| `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` | Azure TTS |
| `AZURE_TRANSLATOR_KEY` / `AZURE_TRANSLATOR_REGION` | Azure 翻译 |
| `FASTAPI_DICT_URL` | 自建词典服务 |

服务端 Key 的开放范围由四个开关控制，默认只把词典和单词发音开放给访客，段落翻译和段落朗读需要访客自带 Key：

```
ALLOW_SERVER_KEY_DICTIONARY=true
ALLOW_SERVER_KEY_WORD_TTS=true
ALLOW_SERVER_KEY_PARAGRAPH_TRANSLATE=false
ALLOW_SERVER_KEY_PARAGRAPH_TTS=false
```

访客在设置面板里填的 Key 只存在浏览器 localStorage，不上服务器。

---

## API

### 公开

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查：运行时长、文章目录、后台是否启用 |
| GET | `/api/config` | 前端启动配置与 Key 开放策略 |
| GET | `/api/articles` | 文章列表（带缓存，目录变更自动失效） |
| GET | `/api/articles/:id` | 文章详情，正文已切分为段落 |
| POST | `/api/translate` | 翻译代理 |
| GET | `/api/tts/{azure,google,google-cloud,openai,elevenlabs}` | TTS 代理 |
| GET | `/api/dict/lookup` · `/api/dict/fallback` | 词典查询 |

### 后台（除 login / logout / session 外都需要会话）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/session` | 登录状态与密码是否已配置 |
| POST | `/api/admin/login` · `/logout` | 登录 / 登出 |
| GET | `/api/admin/stats` | 文章数、订阅源数、任务状态、存储占用 |
| GET · POST · DELETE | `/api/admin/feeds` · `/feeds/:key` | 订阅源增删查 |
| POST | `/api/admin/feeds/test` | 测试 RSS 连通性 |
| GET · PUT | `/api/admin/channels` · `/channels/:folder` | 频道显示名 |
| GET · POST | `/api/admin/jobs` · `/jobs/:id` | 任务列表 / 详情 / 启动 |
| POST | `/api/admin/jobs/:id/cancel` | 取消运行中的任务 |
| GET · PUT | `/api/admin/schedule` | 定时配置 |
| GET | `/api/admin/logs` · `/logs/:file` | 日志列表 / 尾部内容 |
| POST | `/api/admin/logs/prune` | 清理过期日志 |

错误语义：`400` 请求参数不合法，`401` 未登录，`409` 状态冲突（已有任务在跑、缺 Python 解释器），`429` 登录被限流，`502` 外部源不可达。

---

## 测试

```bash
npm test              # 类型检查 + Node API 测试 + Vitest 前端测试 + Python 测试
npm run lint          # 仅类型检查
npm run test:server   # 仅 Node API 测试
npm run test:client   # 仅 Vitest 前端测试
npm run harvester:test
```

| 套件 | 数量 | 覆盖 |
| --- | --- | --- |
| `tests/admin-api.test.ts` | 45 | 鉴权、限流、订阅源 CRUD、频道名、任务校验、日志路径安全 |
| `tests/scheduler.test.ts` | 25 | 下次运行时间计算、补跑语义、参数校验、持久化与损坏恢复 |
| `tests/reader-utils.test.ts` | 7 | 文章筛选、分页、设置持久化 |
| `tests/article-index.test.ts` | 4 | SQLite 索引创建、增量更新、删除同步、频道隔离 |
| `harvester/tests/` | 17 | CLI 入口、路径解析、站点档案匹配、文章 ID 唯一性 |

Node 测试用内置 `node --test`，前端工具测试用 Vitest + jsdom，Python 测试用标准库 `unittest`，都不需要 pytest。

---

## Demo 部署说明

当前线上站点为 Demo：

```text
https://news.fuzy.site
```

Demo 通过 HTTPS 和反向代理访问，主要用于功能演示。Demo 环境中的文章、日志、任务状态和调度配置均属于运行时数据，不纳入代码仓库，也不保证长期保留。

如需在自己的服务器部署 Demo 或自建实例：

```bash
npm install
npm run harvester:install
cp .env.example .env
# 编辑 .env，设置 ADMIN_PASSWORD、APP_URL 和必要的服务商 Key
npm run build
NODE_ENV=production npm start
```

建议使用 Nginx 或其他 HTTPS 反向代理转发到 Node 的 3000 端口，并设置：

- **HTTPS**：生产模式的管理员 Cookie 带 `Secure`
- **`TRUST_PROXY=1`**：部署在一层反向代理后时，恢复真实客户端 IP，保证登录限流按用户生效
- **强 `ADMIN_PASSWORD`**：后台可以启动采集任务、修改订阅源和调度配置

Nginx 参考配置：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

需要备份的只有 `data/`：`articles/` 是内容本体，`state/` 是任务与调度配置。`logs/` 可丢，后台能按保留天数自行清理。

---

## 故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| Demo 访问后登录不了 `/admin` | Demo 可能未开放管理操作，或管理员密码未配置 | 仅在自部署实例中配置 `.env` 的 `ADMIN_PASSWORD`；不要在 README 或公开仓库中写入真实密码 |
| 生产环境登录后立刻掉登录态 | 走的是 HTTP，Secure Cookie 未回传 | 配置 HTTPS |
| 登录返回 429 | 触发限流 | 等 15 分钟，或重启进程清空计数 |
| 启动任务返回 409 | 已有任务在跑，或找不到 Python 解释器 | 看错误详情；检查 `PYTHON_BIN` |
| 文章抓下来正文为空 | 站点解析档案没命中 | 在 `parsers.json` 加专属档案 |
| history 模式一直超时 | Wayback 访问受限 | 配代理，或缩小年份区间 |
| 前端不显示新频道 | 文章列表缓存 | 缓存按目录 mtime 失效，重启服务可强制刷新 |
| `newspaper3k` 报 lxml 相关错误 | 缺 `lxml_html_clean` | `npm run harvester:install` 重装依赖 |

采集器的详细日志在 `data/logs/harvest_YYYY-MM-DD.log`，后台「日志」区可直接看尾部内容。
