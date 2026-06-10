# -*- coding: utf-8 -*-
"""
downloader.py: 高性能 BBC Markdown 资产收割引擎
深度融入视频/音频节点上游强力拦截卡尺，彻底清除纯视觉、纯声音等无正文垃圾流
"""

import os
import re
import time
import logging
import xml.etree.ElementTree as ET
from datetime import datetime
import requests
from tqdm import tqdm
import config
import utils

# 初始化全局标准中央日志系统
logger = logging.getLogger("bbc_harvest")
logger.setLevel(logging.DEBUG)

if not logger.handlers:
    file_handler = logging.FileHandler("bbc_harvest_run.log", encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    file_formatter = logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s", "%Y-%m-%d %H:%M:%S")
    file_handler.setFormatter(file_formatter)
    logger.addHandler(file_handler)

    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.WARNING)
    console_formatter = logging.Formatter("[%(levelname)s] %(message)s")
    console_handler.setFormatter(console_formatter)
    logger.addHandler(console_handler)


class BBCResourceDownloader:

    def __init__(self):
        self.seen_urls = set()
        logger.info("BBC 自动化数据收割分发底座初始化完毕")

    def _get_feed_dir(self, feed_key):
        return f"{feed_key}_articles"

    def _get_log_paths(self, feed_key):
        base_dir = self._get_feed_dir(feed_key)
        success_log = os.path.join(base_dir, "snapshot_history.log")
        failed_log = os.path.join(base_dir, "snapshot_failed.log")
        url_log = os.path.join(base_dir, "downloaded_urls.log")
        return success_log, failed_log, url_log

    def _load_log(self, log_path):
        if os.path.exists(log_path):
            with open(log_path, "r", encoding="utf-8") as f:
                return set(line.strip() for line in f if line.strip())
        return set()

    def _write_log(self, log_path, data_str):
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"{data_str}\n")

    def _remove_from_failed_log(self, failed_log, url):
        if os.path.exists(failed_log):
            with open(failed_log, "r", encoding="utf-8") as f:
                lines = f.readlines()
            with open(failed_log, "w", encoding="utf-8") as f:
                for line in lines:
                    if line.strip() != url:
                        f.write(line)

    def _request_with_retry(self, url, max_retries=3, initial_delay=2):
        delay = initial_delay
        for attempt in range(max_retries):
            try:
                response = requests.get(url, headers=config.HEADERS, timeout=15)
                if response.status_code in [502, 503, 504]:
                    time.sleep(delay)
                    delay *= 2
                    continue
                return response
            except Exception:
                time.sleep(delay)
                delay *= 2
        return None

    def _parse_pub_date(self, pub_date_str):
        if not pub_date_str:
            now = datetime.now()
            return now.strftime("%Y%m%d"), now.strftime("%Y"), now.strftime("%m")

        pub_date_clean = pub_date_str.strip()
        pub_date_clean = re.sub(r"\s[+-]\d{4}$", " GMT", pub_date_clean)
        pub_date_clean = re.sub(r"\s(EDT|EST|PDT|PST|CDT|CST)$", " GMT", pub_date_clean)

        try:
            dt = datetime.strptime(pub_date_clean, "%a, %d %b %Y %H:%M:%S %Z")
            return dt.strftime("%Y%m%d"), dt.strftime("%Y"), dt.strftime("%m")
        except Exception:
            pass

        try:
            dt = datetime.strptime(pub_date_clean.split(" GMT")[0], "%a, %d %b %Y %H:%M:%S")
            return dt.strftime("%Y%m%d"), dt.strftime("%Y"), dt.strftime("%m")
        except Exception:
            pass

        now = datetime.now()
        return now.strftime("%Y%m%d"), now.strftime("%Y"), now.strftime("%m")

    def _save_article(self, feed_key, title, link, pub_date_str, url_log_path):
        """核心存储状态机：上游拦截纯视频/纯音频页面，放行真正的图文 Articles"""
        if not link or link in self.seen_urls:
            return "duplicate"

        # 🎯【核心卡尺】：在发起任何请求、任何清洗前，发现为纯视频或音频页面，在上游瞬间切断，禁止放行
        link_lower = link.lower()
        if any(x in link_lower for x in ['/videos/', '/audio/', 'sounds/play/', '/live/']):
            logger.debug(f"成功在上游拦截并抛弃纯视音频/直播无文本节点: {link}")
            return "duplicate"

        date_str, year_str, month_str = self._parse_pub_date(pub_date_str)

        feed_base_dir = self._get_feed_dir(feed_key)
        dir_path = os.path.join(feed_base_dir, year_str, month_str)
        
        safe_title = utils.clean_filename(title)
        filename = f"{date_str}_{safe_title}.md"
        file_path = os.path.join(dir_path, filename)

        if os.path.exists(file_path):
            self.seen_urls.add(link)
            self._write_log(url_log_path, link)
            return "duplicate"

        full_text = utils.scrape_full_text(link, feed_key)

        length_threshold = 50 if "chinese" in feed_key else 150
        if len(full_text) > length_threshold:
            os.makedirs(dir_path, exist_ok=True)
            
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(f"# {title}\n\n")
                f.write(f"**Date:** {date_str}  \n")
                f.write(f"**Source Channel:** {feed_key}  \n")
                f.write(f"**Original Link:** [{link}]({link})  \n\n")
                f.write("---\n\n")
                f.write(full_text)
            
            self.seen_urls.add(link)
            self._write_log(url_log_path, link)
            logger.info(f"文章落盘成功: {filename} [频道: {feed_key}]")
            return "success"
            
        return "failed"

    def process_single_snapshot(self, feed_key, snapshot_url, url_log_path):
        xml_res = self._request_with_retry(snapshot_url)
        if xml_res is None or xml_res.status_code != 200:
            return False

        try:
            root = ET.fromstring(xml_res.content)
            items = root.findall(".//item")
            
            snapshot_download_count = 0
            snapshot_duplicate_count = 0
            snapshot_failed_count = 0

            for item in items:
                title = item.find("title").text if item.find("title") is not None else "Untitled"
                link = item.find("link").text if item.find("link") is not None else ""
                pub_date_str = item.find("pubDate").text if item.find("pubDate") is not None else ""

                if link:
                    status = self._save_article(feed_key, title, link, pub_date_str, url_log_path)
                    if status == "success":
                        snapshot_download_count += 1
                    elif status == "duplicate":
                        snapshot_duplicate_count += 1
                    elif status == "failed":
                        snapshot_failed_count += 1

            if snapshot_download_count > 0 or snapshot_duplicate_count > 0:
                return True
            return False
        except Exception as e:
            logger.error(f"解析 XML 快照崩溃: {e}")
            return False

    def sync_latest(self, target_keys=None):
        logger.info("======= 触发最新实时增量同步任务 =======")
        print("[增量同步模式] 开始扫描官方原生实时 RSS 订阅流...")
        total_downloaded = 0
        target_keys = target_keys or config.RSS_FEEDS.keys()

        for name in target_keys:
            if name not in config.RSS_FEEDS:
                continue
            
            url = config.RSS_FEEDS[name]
            success_log, failed_log, url_log = self._get_log_paths(name)
            
            channel_urls = self._load_log(url_log)
            self.seen_urls.update(channel_urls)
            
            dest_dir = self._get_feed_dir(name)
            print(f"正在读取历史已载记录 {len(channel_urls)} 条，同步最新内容至根目录: {dest_dir}")
            
            try:
                response = requests.get(url, headers=config.HEADERS, timeout=15)
                if response.status_code != 200:
                    continue

                root = ET.fromstring(response.content)
                items = root.findall(".//item")

                for item in items:
                    title = item.find("title").text if item.find("title") is not None else "Untitled"
                    link = item.find("link").text if item.find("link") is not None else ""
                    pub_date_str = item.find("pubDate").text if item.find("pubDate") is not None else ""

                    status = self._save_article(name, title, link, pub_date_str, url_log)
                    if status == "success":
                        total_downloaded += 1
            except Exception as e:
                logger.error(f"实时增量同步异常 [频道: {name}]: {e}")

        print(f"增量同步完成，成功隔离落盘 {total_downloaded} 篇全新文章")

    def download_history(self, target_keys=None, start_year=2020, end_year=None):
        if end_year is None:
            end_year = datetime.now().year
        logger.info(f"======= 触发历史全量收割任务 (卡尺: {start_year} - {end_year}) =======")
        print(f"[历史收割模式] 正在检索历史快照线索 (时间卡尺: {start_year} - {end_year})...")
        from_timestamp = f"{start_year}0101000000"
        to_timestamp = f"{end_year}1231235959"

        target_keys = target_keys or config.RSS_FEEDS.keys()

        for name in target_keys:
            if name not in config.RSS_FEEDS:
                continue
            
            rss_url = config.RSS_FEEDS[name]
            dest_dir = self._get_feed_dir(name)
            success_log, failed_log, url_log = self._get_log_paths(name)
            
            channel_urls = self._load_log(url_log)
            self.seen_urls.update(channel_urls)
            processed_snapshots = self._load_log(success_log)
            
            print(f"载入已下载文章 URL 记录 {len(channel_urls)} 条。当前收割版块: [{name}] -> 存储阵地: {dest_dir}")

            archive_api = (
                f"{config.WAYBACK_CDX_URL}?url={rss_url}&output=json"
                f"&from={from_timestamp}&to={to_timestamp}&collapse=digest&filter=statuscode%3A200"
            )

            res = self._request_with_retry(archive_api)
            if res is None or res.status_code != 200:
                print(f"档案馆接口响应限制，版块 [{name}] 检索中断，自动切入下一版块")
                continue

            try:
                data = res.json()
                if len(data) <= 1:
                    continue

                snapshot_urls = [
                    f"http://web.archive.org/web/{row[1]}/{rss_url}"
                    for row in data[1:]
                ]
                print(f"订阅源 [{name}] 成功锁定 {len(snapshot_urls)} 个历史快照流节点")

                for snapshot_url in tqdm(snapshot_urls, desc=f"扫描进度 [{name}]"):
                    if snapshot_url in processed_snapshots:
                        continue

                    success = self.process_single_snapshot(name, snapshot_url, url_log)

                    if success:
                        self._write_log(success_log, snapshot_url)
                        processed_snapshots.add(snapshot_url)
                    else:
                        failed_list = self._load_log(failed_log)
                        if snapshot_url not in failed_list:
                            self._write_log(failed_log, snapshot_url)

            except Exception as e:
                logger.error(f"版块历史清洗出现致命崩溃: {e}")

        logger.info("指定区间历史全量收割大任务安全合拢")

    def retry_failed_snapshots(self, target_keys=None):
        logger.info("======= 触发损坏节点定点重试修复主任务 =======")
        print("[失败节点修复主任务启动] 开始遍历各版块历史损毁节点...")
        target_keys = target_keys or config.RSS_FEEDS.keys()

        for name in target_keys:
            if name not in config.RSS_FEEDS:
                continue
            
            success_log, failed_log, url_log = self._get_log_paths(name)
            failed_snapshots = self._load_log(failed_log)

            if not failed_snapshots:
                continue

            print(f"版块 [{name}] 账本内存在 {len(failed_snapshots)} 个损毁快照，开始定点修复...")
            processed_snapshots = self._load_log(success_log)
            
            channel_urls = self._load_log(url_log)
            self.seen_urls.update(channel_urls)

            for snapshot_url in tqdm(list(failed_snapshots), desc=f"修复进度 [{name}]"):
                success = self.process_single_snapshot(name, snapshot_url, url_log)

                if success:
                    self._write_log(success_log, snapshot_url)
                    processed_snapshots.add(snapshot_url)
                    self._remove_from_failed_log(failed_log, snapshot_url)

        print("失败节点重试主任务执行完毕")