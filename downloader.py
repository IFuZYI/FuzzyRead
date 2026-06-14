# -*- coding: utf-8 -*-
"""
downloader.py: 多站通用大资产分布式 Markdown 归档收割状态机
全面重构全生命周期颗粒度诊断日志，打通增量同步、历史打卡账本、去重过滤雷达的每一处诊断足迹
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
import config
import utils

# 初始化中央全局运维日志系统
logger = logging.getLogger("multi_harvest")
logger.setLevel(logging.DEBUG)

if not logger.handlers:
    log_base = os.path.abspath(config.DOWNLOAD_BASE_DIR)
    os.makedirs(log_base, exist_ok=True)
    
    # 配置文件日志落盘物理路径
    file_handler = logging.FileHandler(os.path.join(log_base, "harvest_run.log"), encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    file_formatter = logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s", "%Y-%m-%d %H:%M:%S")
    file_formatter.datefmt = "%Y-%m-%d %H:%M:%S"
    file_handler.setFormatter(file_formatter)
    logger.addHandler(file_handler)

    # 配置控制台实时数据流流水账
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO) # 生产环境控制台默认仅吐出INFO以上级别，保持终端整洁，详细DEBUG沉淀在日志文件
    console_formatter = logging.Formatter("[%(levelname)s] %(message)s")
    console_handler.setFormatter(console_formatter)
    logger.addHandler(console_handler)


class BBCResourceDownloader:

    def __init__(self):
        self.seen_urls = set()
        os.makedirs(os.path.abspath(config.DOWNLOAD_BASE_DIR), exist_ok=True)
        logger.info(f"工业级收割管理底座就绪 -> 大资产大本营绝对路径: {os.path.abspath(config.DOWNLOAD_BASE_DIR)}")

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
        """高透视账本载入器"""
        if os.path.exists(log_path):
            try:
                with open(log_path, "r", encoding="utf-8") as f:
                    lines = set(line.strip() for line in f if line.strip())
                logger.debug(f"持久化账本同步载入成功, 规整提取历史痕迹 {len(lines)} 条 -> 账本路径: {log_path}")
                return lines
            except Exception as e:
                logger.error(f"读取物理去重账本时遭遇意外硬盘损坏异常: {e} -> 异常路径: {log_path}")
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
        """带高细粒度重试痕迹的网络请求包装机"""
        delay = initial_delay
        for attempt in range(max_retries):
            try:
                logger.debug(f"发起底层网络请求 (尝试第 {attempt+1}/{max_retries} 次) -> URL: {url}")
                response = requests.get(url, headers=config.HEADERS, timeout=15)
                if response.status_code in [502, 503, 504]:
                    logger.warning(f"服务器返回瞬时崩溃状态码 {response.status_code}, 触发退避机制休眠 {delay} 秒...")
                    time.sleep(delay)
                    delay *= 2
                    continue
                return response
            except Exception as e:
                logger.warning(f"网络套接字物理握手意外中断原因: {e}, 正在触发自愈重连...")
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

    def _save_article(self, feed_key, title, link, pub_date_str, url_log_path):
        """全量状态追踪落盘引擎"""
        if not link:
            logger.debug(f"拦截：该item节点内Original Link超链接文字完全缺失，直接丢弃")
            return "failed"
            
        if link in self.seen_urls:
            # 🎯【高级新增诊断点】：明确将查重过滤器的动作吐出，方便观察系统是不是在全速过滤
            logger.debug(f"去重雷达拦截成功 -> 该超链接完美命中持久化去重黑名单缓存，安全跳过: {link}")
            return "duplicate"

        link_lower = link.lower()
        if any(blocked_kw in link_lower for blocked_kw in config.GLOBAL_URL_BLOCK_KEYWORDS):
            logger.warning(f"最前端路由拦截 -> 嗅探到纯视音频、播客等无文字外刊节点，强行切断放行: {link}")
            return "duplicate"

        date_str, year_str, month_str = self._parse_pub_date(pub_date_str)

        feed_base_dir = self._get_feed_dir(feed_key)
        dir_path = os.path.join(feed_base_dir, year_str, month_str)
        
        safe_title = utils.clean_filename(title)
        filename = f"{date_str}_{safe_title}.md"
        file_path = os.path.join(dir_path, filename)

        if os.path.exists(file_path):
            logger.debug(f"物理文件双向对齐拦截 -> 检测到本地物理硬盘已存在相同名称的.md文件，自动记账并补齐账本: {filename}")
            self.seen_urls.add(link)
            self._write_log(url_log_path, link)
            return "duplicate"

        # 调度自适应解密引擎提取绝对文本
        logger.debug(f"正在调取自适应策略流拉取并清洗该网页核心容器内容 -> Title: {title}")
        full_text = utils.scrape_full_text(link, feed_key)

        # 如果被 utils.py 内部的 HARD_MELTDOWN_SELECTORS 实体拦截返回了空
        if not full_text:
            logger.debug(f"utils清洗阶段返回空，该链接已被富媒体精确拦截器不予考虑，或者请求失败: {link}")
            return "failed"

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
            logger.info(f"纯净 Markdown 新资产成功分类入库: {filename} [专栏: {feed_key}]")
            return "success"
        else:
            # 🎯【高级新增诊断点】：字数不够时的定点爆破警告日志
            logger.warning(f"图文净化卡尺拦截 -> 该网页清洗后的真实字数仅为 {len(full_text)} 字符，未达到精读标准线阈值({length_threshold})，不予落盘生成文件: {link}")
            return "failed"

    def process_single_snapshot(self, feed_key, snapshot_url, url_log_path):
        """单快照数据节点打捞诊断流"""
        logger.debug(f"正在发起快照全量解析任务 -> Snapshot: {snapshot_url}")
        xml_res = self._request_with_retry(snapshot_url)
        if xml_res is None or xml_res.status_code != 200:
            status_code = xml_res.status_code if xml_res else "Timeout"
            logger.warning(f"历史档案馆节点拒绝响应, 状态码: {status_code} -> 快照URL: {snapshot_url}")
            return False

        try:
            root = ET.fromstring(xml_res.content)
            items = root.findall(".//item")
            logger.debug(f"快照 XML 流结构合法，成功解析出 {len(items)} 个待审计的新闻 item 节点流")
            
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

            logger.debug(f"该历史快照流打捞扫描审计完毕 -> 净斩获全新文章: {snapshot_download_count} 篇，过滤重复: {snapshot_duplicate_count} 篇")
            if snapshot_download_count > 0 or snapshot_duplicate_count > 0:
                return True
            return False
        except Exception as e:
            logger.error(f"解析历史快照 XML 核心树时发生严重语法破损崩溃: {e} -> 异常快照: {snapshot_url}")
            return False

    def sync_latest(self, target_keys=None):
        logger.info("======= 触发多站最新实时增量同步任务 =======")
        print("[增量同步模式] 开始扫描多站官方原生实时 RSS 订阅流...")
        total_downloaded = 0
        target_keys = target_keys or config.RSS_FEEDS.keys()

        for name in target_keys:
            if name not in config.RSS_FEEDS:
                logger.warning(f"选品页过滤 -> 输入了不在全站订阅矩阵中的非标频道键名，自动略过: {name}")
                continue
            
            url = config.RSS_FEEDS[name]
            success_log, failed_log, url_log = self._get_log_paths(name)
            
            # 安全对齐查重缓存
            channel_urls = self._load_log(url_log)
            self.seen_urls.update(channel_urls)
            
            dest_dir = self._get_feed_dir(name)
            print(f"正在读取历史已载记录 {len(channel_urls)} 条，同步最新内容至根目录: {dest_dir}")
            logger.debug(f"正在连通原生实时 RSS 订阅网关 -> 频道: {name} -> 订阅源: {url}")
            
            try:
                response = requests.get(url, headers=config.HEADERS, timeout=15)
                if response.status_code != 200:
                    logger.error(f"无法同步频道 [{name}], 官方服务器网关拒绝响应, 状态码: {response.status_code}")
                    continue

                root = ET.fromstring(response.content)
                items = root.findall(".//item")
                logger.debug(f"最新官方实时 RSS 树提取完毕，在内存中发现 {len(items)} 条突发增量线索，启动流水线逐个对比...")

                channel_download_count = 0
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
                        channel_download_count += 1
                        total_downloaded += 1
                
                logger.info(f"频道 [{name}] 增量周期扫描任务圆满大合拢，本轮实际斩获全新资产 {channel_download_count} 篇")
            except Exception as e:
                logger.error(f"多站实时增量同步出现致命异常 [故障频道: {name}]: {e}")

        print(f"增量同步完成，成功隔离落盘 {total_downloaded} 篇全新文章")

    def download_history(self, target_keys=None, start_year=2020, end_year=None):
        if end_year is None:
            end_year = datetime.now().year
        logger.info(f"======= 触发多站历史区间全量收割 (卡尺: {start_year} - {end_year}) =======")
        print(f"[历史收割模式] 正在检索历史快照线留存 (时间卡尺: {start_year} - {end_year})...")
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
            logger.debug(f"正在向互联网档案馆 CDX 接口查询专栏历史脉络 -> 专栏: {name}")

            archive_api = (
                f"{config.WAYBACK_CDX_URL}?url={rss_url}&output=json"
                f"&from={from_timestamp}&to={to_timestamp}&collapse=digest&filter=statuscode%3A200"
            )

            res = self._request_with_retry(archive_api)
            if res is None or res.status_code != 200:
                status_code = res.status_code if res else "Timeout"
                logger.error(f"档案馆大区数据返回限制错误: {status_code}，专栏线索中断，自动切入下一版块: {name}")
                print(f"档案馆接口响应限制，版块 [{name}] 检索中断，自动切入下一版块")
                continue

            try:
                data = res.json()
                if len(data) <= 1:
                    logger.warning(f"档案馆反馈此专栏在 {start_year}-{end_year} 区间内没有留下任何时间胶囊快照: {name}")
                    continue

                snapshot_urls = [
                    f"http://web.archive.org/web/{row[1]}/{rss_url}"
                    for row in data[1:]
                ]
                logger.info(f"订阅源 [{name}] 成功在档案馆图纸中锁定历史快照流节点 {len(snapshot_urls)} 个，开始拉取状态机...")

                for snapshot_url in tqdm(snapshot_urls, desc=f"扫描进度 [{name}]"):
                    if snapshot_url in processed_snapshots:
                        logger.debug(f"快照对齐账目：检测到该快照节点已在历史大任务中成功打卡处理过，安全跳过: {snapshot_url}")
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
                logger.error(f"多站历史归档清洗发生突发性异常崩溃: {e} -> 故障版块: {name}")

        print("多站指定历史大资产区间收割大任务安全合拢")

    def retry_failed_snapshots(self, target_keys=None):
        logger.info("======= 触发损毁节点定点重试修复主任务 =======")
        print("[失败节点修复主任务启动] 开始跨模块遍历损毁快照账本...")
        target_keys = target_keys or config.RSS_FEEDS.keys()

        for name in target_keys:
            if name not in config.RSS_FEEDS:
                continue
            
            success_log, failed_log, url_log = self._get_log_paths(name)
            failed_snapshots = self._load_log(failed_log)

            if not failed_snapshots:
                logger.debug(f"版块 [{name}] 的坏账本 snapshot_failed.log 盘点完毕：完全清白，无任何历史损毁节点")
                continue

            print(f"版块 [{name}] 账本内存在 {len(failed_snapshots)} 个损毁快照，开始定点修复...")
            logger.info(f"定点账本重修复流激活 -> 版块 [{name}] -> 抓到历史损毁打卡点 {len(failed_snapshots)} 个，准备全力强攻...")
            
            processed_snapshots = self._load_log(success_log)
            channel_urls = self._load_log(url_log)
            self.seen_urls.update(channel_urls)

            for snapshot_url in tqdm(list(failed_snapshots), desc=f"修复进度 [{name}]"):
                success = self.process_single_snapshot(name, snapshot_url, url_log)

                if success:
                    self._write_log(success_log, snapshot_url)
                    processed_snapshots.add(snapshot_url)
                    self._remove_from_failed_log(failed_log, snapshot_url)
                    logger.info(f"修复大捷！损毁节点定点攻克突围成功，账本已安全复原：{snapshot_url}")

        print("失败节点定点重试任务执行完毕")