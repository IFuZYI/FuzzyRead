# -*- coding: utf-8 -*-
"""
downloader.py: BBC 数据归档与断点续爬状态机引擎
实现分刊分类隔离文件夹落盘、独立成功/失败双账本打卡记录
"""

import os
import re
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

    def _get_feed_dir(self, feed_key):
        """根据 BBC 订阅源名称动态生成独立根目录 (如 bbc_english_technology_articles)"""
        return f"{feed_key}_articles"

    def _get_log_paths(self, feed_key):
        """获取当前 BBC 版块专属的成功/失败隔离账本路径"""
        base_dir = self._get_feed_dir(feed_key)
        success_log = os.path.join(base_dir, "snapshot_history.log")
        failed_log = os.path.join(base_dir, "snapshot_failed.log")
        return success_log, failed_log

    def _load_log(self, log_path):
        """加载本地隔离日志账本"""
        if os.path.exists(log_path):
            with open(log_path, "r", encoding="utf-8") as f:
                return set(line.strip() for line in f if line.strip())
        return set()

    def _write_log(self, log_path, url):
        """写入本地隔离日志账本"""
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"{url}\n")

    def _remove_from_failed_log(self, failed_log, url):
        """重试成功后，将快照从失败账本中洗刷剔除销号"""
        if os.path.exists(failed_log):
            with open(failed_log, "r", encoding="utf-8") as f:
                lines = f.readlines()
            with open(failed_log, "w", encoding="utf-8") as f:
                for line in lines:
                    if line.strip() != url:
                        f.write(line)

    def _request_with_retry(self, url, max_retries=3, initial_delay=2):
        """针对 502/503/504 错误引入指数级退避自愈重试机制"""
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
        """多轨自适应时间解析状态机，完美对齐 BBC 官方所有时区与格式变体"""
        if not pub_date_str:
            now = datetime.now()
            return now.strftime("%Y%m%d"), now.strftime("%Y"), now.strftime("%m")

        pub_date_clean = pub_date_str.strip()
        pub_date_clean = re.sub(r"\s[+-]\d{4}$", " GMT", pub_date_clean)
        pub_date_clean = re.sub(r"\s(EDT|EST|PDT|PST|CDT|CST)$", " GMT", pub_date_clean)

        # 轨一：标准 BBC 广播时间通讯规范格式 (Mon, 08 Jun 2026 16:08:15 GMT)
        try:
            dt = datetime.strptime(pub_date_clean, "%a, %d %b %Y %H:%M:%S %Z")
            return dt.strftime("%Y%m%d"), dt.strftime("%Y"), dt.strftime("%m")
        except Exception:
            pass

        # 轨二：尝试精简无时区标准格式 (08 Jun 2026 16:08:15)
        try:
            dt = datetime.strptime(pub_date_clean.split(" GMT")[0], "%a, %d %b %Y %H:%M:%S")
            return dt.strftime("%Y%m%d"), dt.strftime("%Y"), dt.strftime("%m")
        except Exception:
            pass

        # 轨三：仅抓取核心日期字段进行退避强制解析
        try:
            match = re.search(r"\d{1,2}\s[A-Za-z]{3}\s\d{4}", pub_date_clean)
            if match:
                dt = datetime.strptime(match.group(), "%d %b %Y")
                return dt.strftime("%Y%m%d"), dt.strftime("%Y"), dt.strftime("%m")
        except Exception:
            pass

        # 终极安全避险兜底
        now = datetime.now()
        return now.strftime("%Y%m%d"), now.strftime("%Y"), now.strftime("%m")

    def _save_article(self, feed_key, title, link, pub_date_str):
        """核心存储状态机：在对应的隔离文件夹下全自动部署 年/月/时间_文件名.txt"""
        if not link or link in self.seen_urls:
            return "duplicate"
        self.seen_urls.add(link)

        date_str, year_str, month_str = self._parse_pub_date(pub_date_str)

        # 精确隔离归档至各版块自己的独立目录下
        feed_base_dir = self._get_feed_dir(feed_key)
        dir_path = os.path.join(feed_base_dir, year_str, month_str)
        
        safe_title = utils.clean_filename(title)
        filename = f"{date_str}_{safe_title}.txt"
        file_path = os.path.join(dir_path, filename)

        # 内层文件级防重：本地若已存在该文章，秒跳过，绝不重复请求
        if os.path.exists(file_path):
            return "duplicate"

        # 跨越长城提取无广告正文
        full_text = utils.scrape_full_text(link, feed_key)

        # 严格拦截字数过短的异常或破损页面 (中英文采取不同的长度门槛控制)
        length_threshold = 50 if "chinese" in feed_key else 150
        if len(full_text) > length_threshold:
            os.makedirs(dir_path, exist_ok=True)
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(f"Title: {title}\n")
                f.write(f"Date: {date_str}\n")
                f.write(f"Url: {link}\n")
                f.write("-" * 50 + "\n\n")
                f.write(full_text)
            return "success"
        return "failed"

    def process_single_snapshot(self, feed_key, snapshot_url):
        """单历史 XML 快照节点解析流"""
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

                if link:
                    status = self._save_article(feed_key, title, link, pub_date_str)
                    if status == "success":
                        snapshot_download_count += 1
                    elif status == "duplicate":
                        snapshot_duplicate_count += 1

            # 只要节点内含的文章是成功下到本地的或者以前全部下全了的，该快照节点即宣布大功告成
            if snapshot_download_count > 0 or snapshot_duplicate_count > 0:
                return True
            return False
        except Exception:
            return False

    def sync_latest(self, target_keys=None):
        """主任务 1 最新日常同步：扫描 BBC 原生实时 RSS，进行分类增量落盘"""
        print("[增量同步模式] 开始扫描官方原生实时 RSS 订阅流...")
        total_downloaded = 0
        target_keys = target_keys or config.RSS_FEEDS.keys()

        for name in target_keys:
            if name not in config.RSS_FEEDS:
                continue
            url = config.RSS_FEEDS[name]
            dest_dir = self._get_feed_dir(name)
            print(f"正在同步最新内容至根目录: {dest_dir}")
            
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

                    status = self._save_article(name, title, link, pub_date_str)
                    if status == "success":
                        total_downloaded += 1
            except Exception as e:
                print(f"同步订阅源 [{name}] 发生异常: {e}")

        print(f"增量同步完成，成功隔离落盘 {total_downloaded} 篇全新文章")

    def download_history(self, target_keys=None, start_year=2020, end_year=None):
        """主任务 2 指定区间收割：提取自 2020 年起历史快照，实现外层日志断点秒闪过"""
        if end_year is None:
            end_year = datetime.now().year
        print(f"[历史收割模式] 正在检索历史快照线索 (时间卡尺: {start_year} - {end_year})...")
        from_timestamp = f"{start_year}0101000000"
        to_timestamp = f"{end_year}1231235959"

        target_keys = target_keys or config.RSS_FEEDS.keys()

        for name in target_keys:
            if name not in config.RSS_FEEDS:
                continue
            
            rss_url = config.RSS_FEEDS[name]
            dest_dir = self._get_feed_dir(name)
            success_log, failed_log = self._get_log_paths(name)
            
            # 外层快照级防重拦截：读取属于当前版块的独立账本进度
            processed_snapshots = self._load_log(success_log)
            print(f"当前收割版块: [{name}] -> 存储阵地: {dest_dir}")

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
                    # 如果该历史节点在日志中已成功通过，0毫秒无感跳过，实现精准从50%断点继续
                    if snapshot_url in processed_snapshots:
                        continue

                    success = self.process_single_snapshot(name, snapshot_url)

                    if success:
                        # 成功则录入独立成功账本
                        self._write_log(success_log, snapshot_url)
                        processed_snapshots.add(snapshot_url)
                    else:
                        # 502/网络受限损坏则挂号录入失败账本
                        failed_list = self._load_log(failed_log)
                        if snapshot_url not in failed_list:
                            self._write_log(failed_log, snapshot_url)

            except Exception as e:
                print(f"检索 [{name}] 历史大资产发生异常: {e}")

    def retry_failed_snapshots(self, target_keys=None):
        """主任务 3 修复定点重试：提取独立失败账本，清洗过去因 502 残存的残缺快照"""
        print("[失败节点修复主任务启动] 开始遍历各版块历史损毁节点...")
        target_keys = target_keys or config.RSS_FEEDS.keys()

        for name in target_keys:
            if name not in config.RSS_FEEDS:
                continue
            
            success_log, failed_log = self._get_log_paths(name)
            failed_snapshots = self._load_log(failed_log)

            if not failed_snapshots:
                continue

            print(f"版块 [{name}] 账本内存在 {len(failed_snapshots)} 个损毁快照，开始定点修复...")
            processed_snapshots = self._load_log(success_log)

            for snapshot_url in tqdm(list(failed_snapshots), desc=f"修复进度 [{name}]"):
                success = self.process_single_snapshot(name, snapshot_url)

                if success:
                    # 修复成功则双向流转：录入成功账本，并从失败账本中销号
                    self._write_log(success_log, snapshot_url)
                    processed_snapshots.add(snapshot_url)
                    self._remove_from_failed_log(failed_log, snapshot_url)

        print("失败节点重试主任务执行完毕")