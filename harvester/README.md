# Multi-Source Foreign News Harvester 

本项目是一款专门为英语精读学习、学术文献归档、中英文外刊教学网站量身定制的商业级分布式内容收割系统。系统采用纯静态“数据驱动（Data-Driven）”架构设计，全面解耦核心业务逻辑与各外刊特异性规则，通过高韧性泛实体流式迭代解析与强类型对象卡尺，实现对全球优质外刊（如 BBC、TIME 等）纯净图文资产的长效稳健打捞。

---

## 项目核心功能特征

1. 极致轻量与零磁盘开销：程序彻底移除本地图片下载与高压图像矩阵缩放依赖，直接穿透图片占位符提取原厂公网绝对超链接，无缝码入 Markdown 语法树。文章落盘表现为极简的单纯文本 .md 资产。
2. 双轨属性高精定位雷达：深度对齐 BBC (data-block="text") 与《时代周刊》 (data-testid="paragraph-content/element") 官方特异性数据属性，彻底击穿任何复杂的 Martech 埋点深层嵌套。
3. 强类型多媒体实体拦截：放弃脆弱的模糊单词匹配，直接清算 HTML5 实体标签对象（table, iframe, video, embed）。一旦锁定正文核心出现上述非标交互元素，上游第一时间柔性熔断抛弃，确保归库留存的 100% 都是完美适合中国学生精读的标准长篇图文。
4. 商业级去噪与脱敏：全自动物理销毁（Decompose）正文内部中插的 Inline 广告流、社交分享面板与 Advertisement 占位字样，智能平铺重组句内混合加粗（b/strong）重点词，杜绝任何漏字、重字或排版塌陷。
5. 工业级运维透视：引入高诊断颗粒度日志系统，全自动按天动态归档切割独立日志文件（如 harvest_2026-06-14.log），详细记录选择器命中足迹与富媒体拦截原因，极大方便宝塔面板后台盘查与监控。

---

## 项目物理解析树状图

项目根目录采用高内聚、低耦合的模块化布局，具体骨架划分如下：

    FOREIGN_NEWS_HARVESTER/
    │
    ├── main.py                               # 综合控制面板入口（支持控制台菜单与 CLI 命令行多维分发）
    ├── downloader.py                         # 分布式归档状态机（管理生命周期调度、历史打卡与物理落盘）
    ├── utils.py                              # 立体资产清洗转换引擎（泛实体检索雷达、句内流式重组器）
    ├── config.py                             # 中央参数中转站（管理 JSON 账本动态加载、会话池与基础环境）
    │
    ├── settings/                             # 数据驱动配置中心
    │   ├── TEMPLATE_SPEC.md                  # 配置模版与字段定义规范白皮书
    │   ├── feeds.json                        # 全球媒体实时订阅源集群（网络网络打卡账本）
    │   └── parsers.json                      # 媒体 CSS 选择器卡尺、死图指纹与强拦截对象（规则账本）
    │
    ├── logs/                                 # 自动化动态归档日志夹（由系统按天动态生成与切割）
    │   ├── harvest_2026-06-14.log            # 详细包含指纹触发描述的高颗粒度追踪流水账
    │   └── harvest_2026-06-15.log            # 次日高颗粒度追踪流水账
    │
    └── articles/                             # 纯净单文件大资产归档大本营路径（全自动按 专栏/年/月 分流）
        ├── bbc_english_top_articles/
        │   ├── downloaded_urls.log           # 频道持久化 URL 资产查重黑名单账本（确保 O(1) 极速过滤）
        │   ├── snapshot_history.log          # 互联网档案馆网络快照打卡成功账本
        │   ├── snapshot_failed.log           # 损毁快照节点异常登记账本（用于 Retry 模式修复坏账）
        │   └── 2026/
        │       └── 06/
        │           └── 20260614_Has_Vinicius_Jr_brilliance.md # 完全体出版级纯净精读 Markdown 文件
        │
        └── time_english_top_articles/
            └── 2026/
                └── 06/
                    └── 20260613_Why_Brexit_Still_Haunts.md    # 时代周刊完美图文交织长文成果

---

## 配置文件配置（热插拔扩展规约）

系统运行所需的所有环境和规则特征全部存放在 `settings/` 目录下。当你需要扩展或者变更业务时，**严禁修改业务逻辑代码**，直接对照以下标准填空修改 JSON：

### 1. 扩充订阅流：`settings/feeds.json`
在 JSON 字典中追加新媒体频道的唯一标识符与 RSS XML 链接。
```json
{
  "bbc_english_top": "[http://feeds.bbci.co.uk/news/rss.xml](http://feeds.bbci.co.uk/news/rss.xml)",
  "time_english_top": "[https://time.com/feed/](https://time.com/feed/)",
  "新外刊_新版块": "[https://www.example.com/rss.xml](https://www.example.com/rss.xml)"
}

```

### 2. 扩充清洗特征：`settings/parsers.json`

在 `site_configs` 内部，新增一个与上述外刊超链接域名关键字完全对齐的清洗特征树。系统内部的状态机会在拉取链接的一瞬间自动识别、热加载挂载以下规则：

```json
{
  "site_configs": {
    "新媒体特征关键字": {
      "core_selectors": [".main-article-body", "article"],
      "paragraph_class_pattern": "BodyText|Content",
      "bad_sub_selectors": [".ad-banner", ".newsletter-rail"]
    }
  }
}

```

---

## 🚀 系统部署与使用方法

系统具备极高的运行灵活性，完美支持宝塔自定义周期性计划任务（非交互自动化）与本地手动精细化收割（交互菜单模式）。

### 环境初始化

```bash
# 克隆仓库并进入根目录
cd FOREIGN_NEWS_HARVESTER

# 安装工业级图文清洗依赖组件
pip install -r requirements.txt

```

### 运行运行模式一：直接运行（可视化图形/手动精细交互模式）

直接在终端或宝塔终端中拉起主入口，不带任何附加参数。系统会自动打印出美观的图形控制台，引导你完成选品、时间卡尺设定与大任务扫描：

```bash
python main.py

```

控制台交互向导动作流示例：

1. 键入 `1` 触发实时最新增量分类同步，或者键入 `2` 切入全量历史大资产收割；
2. 若选择了历史模式，根据提示输入时间门限，如起始年份 `2020`，结束年份 `2026`；
3. 系统将秒级扫描可用矩阵，键入对应的序列号（如 `3 10`）定点合拢专栏，或者键入 `0` 直接全选所有媒体发起全量冲锋。

### 运行模式二：使用参数运行（宝塔 Cron 计划任务 / 自动化脚本模式）

当你需要通过宝塔面板配置自动化的“每晚凌晨 2 点定时增量同步”或者无人值守的自动化大数据跑批时，应采用标准的 CLI 命令行长参数分发。

#### 1. 实时增量全量自动扫描收割（推荐每日执行）

```bash
# 全选所有 JSON 字典里配置的外刊专栏，全速打捞最新的增量线索
python main.py --mode latest

# 指定特定的媒体专栏（如仅同步 BBC English Top 与 TIME 综合源）
python main.py --mode latest --feeds bbc_english_top time_english_top

```

#### 2. 指定历史时间跨度大资产全量收割（推荐初次部署或周末跑批）

```bash
# 自动向互联网档案馆 Wayback 机器调取 2022 年至 2026 年之间全矩阵的时间胶囊快照进行高精提取
python main.py --mode history --start 2022 --end 2026

# 指定特定的媒体专栏进行指定历史大跨度区间全量收割
python main.py --mode history --feeds bbc_english_technology time_english_top --start 2023 --end 2026

```

#### 3. 坏账及损毁快照节点定点重试与断点续传

历史同步由于上游档案馆并发风控，极大概率会产生网络抖动导致的 502/504 破损快照。系统全自动在 `snapshot_failed.log` 记录了这些坏账。执行以下命令，系统会以指数退避重试机制定点攻克突围这些损毁节点，并将大捷成果补记入账：

```bash
python main.py --mode retry

```

---

## ⚠️ 生产环境宝塔运维防错铁律

1. 全局系统代理对齐：历史收割模式会密集请求国际互联网档案馆 API，必须确保你本地或宝塔服务器上常驻的 Clash Verge 等系统代理处于开启或全局（Global）放行状态。
2. 权限完整度把关：在宝塔面板添加定时脚本任务时，请确保执行用户选择为 `www` 或 `root`，以保障系统具有在 `articles/` 文件夹下按年/月深度自动创建多层物理级隔离目录的写盘权限。
3. JSON 格式严苛检验：JSON 文件严格禁止任何中文全角标点。除大括号末尾行外，任何新增的键值对尾部必须强制补齐英文半角逗号 `,`。若修改配置后 config.py 报错，请使用 JSON 在线校验器进行格式对齐。

```

---

这一版 `README.md` 从项目特色、核心参数白皮书、无状态扩展战略以及具体双模命令操作，为你建立了极为稳固和职业化的 GitHub 开源/商业级文档门面。直接在项目根目录下创建并写入即可！

```