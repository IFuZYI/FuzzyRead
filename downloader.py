# -*- coding: utf-8 -*-
"""downloader.py: 具备 502 自愈重试与快照级断点记忆的下载引擎"""

import os
import time
import xml.etree.ElementTree as ET
from datetime import datetime
import requests
from tqdm import tqdm
import config
import utils


class BBCResourceDownloader:

    def __init__(self):
        self.seen_urls = set()
        # 定义历史快照扫描日志的存放路径 
        self.log_file = os.path.join(config.BASE_OUTPUT_DIR, "snapshot_history.log")
        self.processed_snapshots = self._load_snapshot_log()

    def _load_snapshot_log(self):
        """[前置防重] 启动时自动读取本地日志，加载过去所有已经成功扫描过的历史快照 """
        if os.path.exists(self.log_file):
            print(f"📦 正在加载本地断点记录，已检索到历史扫描日志...")
            with open(self.log_file, "r", encoding="utf-8") as f:
                return set(line.strip() for line in f if line.strip())
        return set()

    def _log_processed_snapshot(self, snapshot_url):
        """每当一个历史快照节点的内容被成功收割完毕，立即持久化打卡记录 """
        os.makedirs(config.BASE_OUTPUT_DIR, exist_ok=True)
        with open(self.log_file, "a", encoding="utf-8") as f:
            f.write(f"{snapshot_url}\n")
        self.processed_snapshots.add(snapshot_url)

    def _request_with_retry(self, url, max_retries=3, initial_delay=2):
        """【核心红利：502自愈防崩溃状态机】
        遇到档案馆 502/504 报错或网络抖动时，自动进行指数级退避重试（2s, 4s, 8s, 16s...）
        """
        delay = initial_delay
        for attempt in range(max_retries):
            try:
                response = requests.get(url, headers=config.HEADERS, timeout=20)

                # 如果遭遇 502 或者是 503/504 服务器崩溃状态码，主动触发重试机制
                if response.status_code in [502, 503, 504]:
                    tqdm.write(
                        f"⚠️ 档案馆服务器偶发性抛出 {response.status_code}，正在进行第 {attempt + 1}/{max_retries} 次顽强重试..."
                    )
                    time.sleep(delay)
                    delay *= 2  # 延迟时间指数级翻倍，避免高频请求加剧档案馆服务器负担
                    continue

                return response
            except (requests.exceptions.RequestException, Exception) as e:
                tqdm.write(f"⚠️ 网络边缘抖动: {e}，正在尝试自动重连...")
                time.sleep(delay)
                delay *= 2

        return None

    def _save_article(self, title, link, pub_date_str):
        """核心存储状态机：检测最新增量，若文章已落盘则秒跳过 """
        if not link or link in self.seen_urls:
            return False
        self.seen_urls.add(link)

        try:
            dt = datetime.strptime(pub_date_str, "%a, %d %b %Y %H:%M:%S %Z")
            date_str = dt.strftime("%Y%m%d")
            year_str = dt.strftime("%Y")
            month_str = dt.strftime("%m")
        except Exception:
            now = datetime.now()
            date_str, year_str, month_str = (
                now.strftime("%Y%m%d"),
                now.strftime("%Y"),
                "UNKNOWN",
            )

        dir_path = os.path.join(config.BASE_OUTPUT_DIR, year_str, month_str)
        safe_title = utils.clean_filename(title)
        filename = f"{date_str}_{safe_title}.txt"
        file_path = os.path.join(dir_path, filename)

        # 文本级防重（第二道防线） 
        if os.path.exists(file_path):
            return False

        full_text = utils.scrape_full_text(link)

        if len(full_text) > 150:
            os.makedirs(dir_path, exist_ok=True)
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(f"Title: {title}\n")
                f.write(f"Date: {date_str}\n")
                f.write(f"Url: {link}\n")
                f.write("-" * 50 + "\n\n")
                f.write(full_text)
            return True
        return False

    def sync_latest(self):
        """增量同步最新官方原生实时 RSS 流 [cite: 201, 205]"""
        print("\n📡 [增量同步] 正在扫描官方原生实时 RSS 订阅流...")
        total_downloaded = 0

        for name, url in config.RSS_FEEDS.items():
            try:
                response = requests.get(url, headers=config.HEADERS, timeout=15)
                if response.status_code != 200:
                    continue

                root = ET.fromstring(response.content)
                items = root.findall(".//item")

                for item in items:
                    title = (
                        item.find("title").text
                        if item.find("title") is not None
                        else "Untitled"
                    )
                    link = (
                        item.find("link").text if item.find("link") is not None else ""
                    )
                    pub_date_str = (
                        item.find("pubDate").text
                        if item.find("pubDate") is not None
                        else ""
                    )

                    if self._save_article(title, link, pub_date_str):
                        total_downloaded += 1

            except Exception as e:
                print(f"❌ 同步订阅源 [{name}] 发生异常: {e}")

        print(f"✅ 增量同步完成！成功检测并下载了 {total_downloaded} 篇全新外刊资产！")

    def download_history(self, start_year=2020, end_year=2026):
        """时间区间模式：全自动从断点处继续收割指定年份区间的全量历史大资产 """
        print(
            f"\n📜 [历史收割] 正在通过网络档案馆检索 {start_year} - {end_year} 历史备份线索..."
        )

        from_timestamp = f"{start_year}0101000000"
        to_timestamp = f"{end_year}1231235959"

        for name, rss_url in config.RSS_FEEDS.items():
            archive_api = (
                f"{config.WAYBACK_CDX_URL}?url={rss_url}&output=json"
                f"&from={from_timestamp}&to={to_timestamp}&collapse=digest&filter=statuscode%3A200"
            )

            # 使用升级后的自愈重试请求函数
            res = self._request_with_retry(archive_api)

            if res is None or res.status_code != 200:
                print(
                    f"❌ 档案馆接口彻底响应异常（多次尝试仍为 {res.status_code if res else '超时'}），该订阅源历史节点下载暂停，自动切换至下一订阅源..."
                )
                continue

            try:
                data = res.json()
                if len(data) <= 1:
                    continue

                snapshot_urls = [
                    f"http://web.archive.org/web/{row[1]}/{rss_url}"
                    for row in data[1:]
                ]
                print(
                    f"🎯 订阅源 [{name}] 成功锁定 {len(snapshot_urls)} 个历史广播流节点！"
                )

                # 开始带有“外层前置记忆”的深度收割 
                for snapshot_url in tqdm(
                    snapshot_urls, desc=f"扫描 [{name}] 历史节点"
                ):

                    # 0 毫秒无感秒级断点跳过 
                    if snapshot_url in self.processed_snapshots:
                        continue

                    try:
                        # 扫描每一个历史 XML 快照时，同样套用 502 自愈重试机制
                        xml_res = self._request_with_retry(snapshot_url)
                        if xml_res is None or xml_res.status_code != 200:
                            continue

                        root = ET.fromstring(xml_res.content)
                        items = root.findall(".//item")

                        for item in items:
                            title = (
                                item.find("title").text
                                if item.find("title") is not None
                                else "Untitled"
                            )
                            link = (
                                item.find("link").text
                                if item.find("link") is not None
                                else ""
                            )
                            pub_date_str = (
                                item.find("pubDate").text
                                if item.find("pubDate") is not None
                                else ""
                            )

                            self._save_article(title, link, pub_date_str)

                        # 对该快照节点做永久打卡记录 
                        self._log_processed_snapshot(snapshot_url)

                    except Exception:
                        continue
            except Exception as e:
                print(f"❌ 检索订阅源 [{name}] 历史大资产失败: {e}")

        print(f"\n🎉 指定区间 {start_year}-{end_year} 历史大资产全量收割合拢完毕！")