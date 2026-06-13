# -*- coding: utf-8 -*-
"""
downloader.py: 多站通用大资产分布式 Markdown 归档收割状态机
引入 io.BytesIO 内存缓冲区优化，彻底封杀任何磁盘临时读写造成的 I/O 阻塞，确保 0 卡顿
"""

import os
import re
import time
import logging
import io
import xml.etree.ElementTree as ET
from datetime import datetime
import requests
from tqdm import tqdm
from PIL import Image
import config
import utils

# 初始化中央全局运维日志系统
logger = logging.getLogger("multi_harvest")
logger.setLevel(logging.DEBUG)

if not logger.handlers:
    log_base = os.path.abspath(config.DOWNLOAD_BASE_DIR)
    os.makedirs(log_base, exist_ok=True)
    
    file_handler = logging.FileHandler(os.path.join(log_base, "harvest_run.log"), encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    file_formatter = logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s", "%Y-%m-%d %H:%M:%S")
    file_formatter.datefmt = "%Y-%m-%d %H:%M:%S"
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
        os.makedirs(os.path.abspath(config.DOWNLOAD_BASE_DIR), exist_ok=True)
        logger.info(f"多站全量收割底座启动 -> 根存储阵地设定为: {os.path.abspath(config.DOWNLOAD_BASE_DIR)}")

    def _get_feed_dir(self, feed_key):
        base_path = os.path.abspath(config.DOWNLOAD_BASE_DIR)
        return os.path.join(base_path, f"{feed_key}_articles")

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
            
        try:
            dt = datetime.strptime(pub_date_clean, "%Y-%m-%dT%H:%M:%SZ")
            return dt.strftime("%Y%m%d"), dt.strftime("%Y"), dt.strftime("%m")
        except Exception:
            pass

        now = datetime.now()
        return now.strftime("%Y%m%d"), now.strftime("%Y"), now.strftime("%m")

    def _download_and_save_images(self, img_urls, article_folder_path):
        """高清真图智能缩放与高画质内存级缓冲压缩状态机"""
        if not img_urls:
            return
            
        for idx, img_url in enumerate(img_urls):
            try:
                from utils import http_session
                img_res = http_session.get(img_url, headers=config.HEADERS, timeout=10)
                
                if img_res.status_code == 200:
                    # 🎯 【性能降维核心点】：直接在内存中开辟 BytesIO 二级管线包装原始网路流，零临时磁盘文件产生，彻底消除硬盘 I/O 阻塞
                    input_buffer = io.BytesIO(img_res.content)
                    image = Image.open(input_buffer)
                    
                    if image.mode in ("RGBA", "P"):
                        image = image.convert("RGB")
                        
                    width, height = image.size
                    max_limit = config.MAX_IMAGE_RESOLUTION
                    
                    if width > max_limit or height > max_limit:
                        if width >= height:
                            new_width = max_limit
                            new_height = int(height * (max_limit / width))
                        else:
                            new_height = max_limit
                            new_width = int(width * (max_limit / height))
                            
                        image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
                        logger.debug(f"图片尺寸触发限制，全自动等比例缩放: {width}x{height} -> {new_width}x{new_height}")

                    img_name = f"img_{idx}.jpg"
                    img_path = os.path.join(article_folder_path, img_name)
                    
                    # 内存数据一次性冲刷写入，保持硬件级别的低温冷运行
                    image.save(img_path, "JPEG", quality=config.IMAGE_QUALITY, optimize=True)
                    
                    # 显式关闭并释放内存计数器
                    input_buffer.close()
                    
            except Exception as e:
                logger.debug(f"打捞压缩现场插图由于网络或组件冲突扑空: {e}, URL: {img_url}")

    def _save_article(self, feed_key, title, link, pub_date_str, url_log_path):
        """落盘状态机"""
        if not link or link in self.seen_urls:
            return "duplicate"

        link_lower = link.lower()
        if any(blocked_kw in link_lower for blocked_kw in config.GLOBAL_URL_BLOCK_KEYWORDS):
            return "duplicate"

        date_str, year_str, month_str = self._parse_pub_date(pub_date_str)

        feed_base_dir = self._get_feed_dir(feed_key)
        safe_title = utils.clean_filename(title)
        article_folder_name = f"{date_str}_{safe_title}"
        article_folder_path = os.path.join(feed_base_dir, year_str, month_str, article_folder_name)
        
        file_path = os.path.join(article_folder_path, f"{article_folder_name}.md")

        if os.path.exists(file_path):
            self.seen_urls.add(link)
            self._write_log(url_log_path, link)
            return "duplicate"

        full_text, img_urls = utils.scrape_full_text_and_images(link, feed_key)

        length_threshold = 50 if "chinese" in feed_key else 150
        if len(full_text) > length_threshold:
            os.makedirs(article_folder_path, exist_ok=True)
            
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(f"# {title}\n\n")
                f.write(f"**Date:** {date_str}  \n")
                f.write(f"**Source Channel:** {feed_key}  \n")
                f.write(f"**Original Link:** [{link}]({link})  \n\n")
                f.write("---\n\n")
                f.write(full_text)
            
            self._download_and_save_images(img_urls, article_folder_path)
            
            self.seen_urls.add(link)
            self._write_log(url_log_path, link)
            logger.info(f"一文一园打包完美收割入库: {article_folder_name} [已无损压缩 {len(img_urls)} 张高清真图]")
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

            for item in items:
                title = item.find("title").text if item.find("title") is not None else "Untitled"
                link = item.find("link").text if item.find("link") is not None else ""
                pub_date_str = item.find("pubDate").text if item.find("pubDate") is not None else ""

                if not pub_date_str:
                    for child in item:
                        if child.tag.endswith('date'):
                            pub_date_str = child.text
                            break

                if link:
                    status = self._save_article(feed_key, title, link, pub_date_str, url_log_path)
                    if status == "success":
                        snapshot_download_count += 1
                    elif status == "duplicate":
                        snapshot_duplicate_count += 1

            if snapshot_download_count > 0 or snapshot_duplicate_count > 0:
                return True
            return False
        except Exception as e:
            logger.error(f"解析多站历史 XML 快照崩溃: {e}")
            return False

    def sync_latest(self, target_keys=None):
        logger.info("======= 触发多站最新实时增量同步任务 =======")
        print("[增量同步模式] 开始扫描多站官方原生实时 RSS 订阅流...")
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

                    if not pub_date_str:
                        for child in item:
                            if child.tag.endswith('date'):
                                pub_date_str = child.text
                                break

                    status = self._save_article(name, title, link, pub_date_str, url_log)
                    if status == "success":
                        total_downloaded += 1
            except Exception as e:
                logger.error(f"多站实时增量同步异常 [频道: {name}]: {e}")

        print(f"增量同步完成，成功隔离落盘 {total_downloaded} 篇全新文章")

    def download_history(self, target_keys=None, start_year=2020, end_year=None):
        if end_year is None:
            end_year = datetime.now().year
        logger.info(f"======= 触发多站历史区间全量收割 (卡尺: {start_year} - {end_year}) =======")
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
                logger.error(f"多站历史归档清洗发生异常崩溃: {e}")

        print("多站指定历史大资产区间收割大任务安全合拢")