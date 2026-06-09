import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime
import requests
from newspaper import Article
from tqdm import tqdm

# ==================== 核心配置区域 ====================
# 目标 BBC 官方原生 RSS 链接（利用互联网档案馆捞取其自2020年起的历史快照）
BBC_RSS_URL = "https://feeds.bbci.co.uk/news/rss.xml"

# 本地文章资产存放根目录
OUTPUT_DIR = "bbc_history_articles"
# ====================================================

# 统一伪装标准浏览器 Headers，防止被外刊防御机制拦截
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}


def clean_filename(text):
    """过滤非法字符，确保文件名合法"""
    text = re.sub(r"[\\/:*?\"<>|]", "", text)
    return text.strip().replace(" ", "_")


def get_rss_history_snapshots():
    """依托系统代理，直接从网络档案馆检索自 2020 年起 BBC 官方 RSS 的全量备份快照"""
    print(f"📡 正在从网络档案馆检索 {BBC_RSS_URL} 自 2020 年起的历史备份线索...")

    # 构建 Wayback Machine CDX API 请求，抓取 2020 年至今、状态码为 200 的 XML 快照
    archive_url = (
        f"http://web.archive.org/cdx/search/cdx?url={BBC_RSS_URL}"
        f"&output=json&from=20200101000000&collapse=digest&filter=statuscode%3A200"
    )

    try:
        # 纯净直连请求，系统代理会自动接管网络并翻墙
        response = requests.get(archive_url, headers=HEADERS, timeout=20)
        if response.status_code != 200:
            print(f"❌ 档案馆接口响应异常，状态码: {response.status_code}")
            return []

        data = response.json()
        if len(data) <= 1:
            print("📭 未找到相关的历史快照。")
            return []

        snapshot_urls = []
        for row in data[1:]:  # 跳过第一行 JSON 表头
            timestamp = row[1]  # 时间戳：例如 20201231120000
            # 拼接成能够强行读取当时 XML 内容的绝对路径
            snapshot_link = f"http://web.archive.org/web/{timestamp}/{BBC_RSS_URL}"
            snapshot_urls.append(snapshot_link)

        print(f"✅ 成功锁定 {len(snapshot_urls)} 个历史 RSS 广播流节点！")
        return snapshot_urls
    except Exception as e:
        print(f"❌ 检索档案馆发生异常（请确认系统代理已开启）: {e}")
        return []


def parse_history_xml_and_scrape(snapshot_urls):
    """遍历历史 XML 广播节点，剥离出文章线索并全自动下载正文"""
    print("🚀 依赖系统代理环境，开始多级目录自动化深度收割...")

    # 用于防重，确保整套大资产中相同的 URL 链接只会被下载一次
    seen_urls = set()

    for snapshot_url in tqdm(snapshot_urls, desc="历史节点扫描进度"):
        try:
            # 1. 抓取历史某天的 RSS XML 快照数据
            res = requests.get(snapshot_url, headers=HEADERS, timeout=15)
            if res.status_code != 200:
                continue

            root = ET.fromstring(res.content)
            items = root.findall(".//item")

            for item in items:
                title = item.find("title").text if item.find("title") is not None else "Untitled"
                link = item.find("link").text if item.find("link") is not None else ""
                pub_date_str = item.find("pubDate").text if item.find("pubDate") is not None else ""

                if not link or link in seen_urls:
                    continue
                seen_urls.add(link)

                # 2. 解析时间字段，以满足“时间+文件名”的规范目录需求
                try:
                    dt = datetime.strptime(pub_date_str, "%a, %d %b %Y %H:%M:%S %Z")
                    date_str = dt.strftime("%Y%m%d")
                    year_str = dt.strftime("%Y")
                    month_str = dt.strftime("%m")
                except Exception:
                    # 容错降级：若时间无法解析，归入未知区
                    date_str, year_str, month_str = "UNKNOWN", "UNKNOWN", "UNKNOWN"

                # 3. 自动构建 年/月 多级分层目录资产树
                dir_path = os.path.join(OUTPUT_DIR, year_str, month_str)
                os.makedirs(dir_path, exist_ok=True)

                safe_title = clean_filename(title)
                filename = f"{date_str}_{safe_title}.txt"
                file_path = os.path.join(dir_path, filename)

                # 商业级断点续爬：本地若已经有该文件，直接秒跳过，不重复请求
                if os.path.exists(file_path):
                    continue

                # 4. 实时提取完整的正文内容
                try:
                    article = Article(link, language="en")
                    article_res = requests.get(link, headers=HEADERS, timeout=12)
                    if article_res.status_code == 200:
                        article.set_html(article_res.text)
                        article.parse()
                        full_text = article.text

                        # 字数门槛过滤，剔除破损页面或报错文本
                        if len(full_text) > 200:
                            with open(file_path, "w", encoding="utf-8") as f:
                                f.write(f"Title: {title}\n")
                                f.write(f"Date: {date_str}\n")
                                f.write(f"Url: {link}\n")
                                f.write("-" * 50 + "\n\n")
                                f.write(full_text)
                except Exception:
                    continue  # 单篇抓取失败静默容错，保护整个大管道不断裂
        except Exception:
            continue


def main():
    # 第一步：依靠系统代理打通网络，全量捞回历史 RSS 广播流线索
    snapshot_urls = get_rss_history_snapshots()
    if not snapshot_urls:
        print("📭 未成功建立历史数据流，管道终止。")
        return

    # 第二步：多轨合并，开始将全量文章砸进本地
    parse_history_xml_and_scrape(snapshot_urls)
    print(f"\n🎉 2020 年历史大资产归档全部合拢！资产已保存在 '{OUTPUT_DIR}' 文件夹中！")


if __name__ == "__main__":
    main()