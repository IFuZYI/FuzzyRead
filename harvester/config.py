# -*- coding: utf-8 -*-
"""
config.py: 中央配置文件
全自动对接并动态加载 settings 文件夹下的 JSON 静态参数盘
已确保代码、注释中无任何非标准特殊表情符号
"""

import os
import json
import logging

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
DATA_DIR = os.environ.get("NEWS_DATA_DIR", os.path.join(PROJECT_ROOT, "data"))

logger = logging.getLogger("multi_harvest")

# 1. 资产物理归档根目录路径
DOWNLOAD_BASE_DIR = os.environ.get("NEWS_ARTICLES_DIR", os.path.join(DATA_DIR, "articles"))
LOG_DIR = os.environ.get("NEWS_LOG_DIR", os.path.join(DATA_DIR, "logs"))
WAYBACK_CDX_URL = "http://web.archive.org/cdx/search/cdx"

# 全球标准伪装浏览器 Headers
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
    "Cache-Control": "max-age=0",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1"
}

# 2. 动态加载静态 JSON 数据资产结构
FEEDS_JSON_PATH = os.environ.get("NEWS_FEEDS_PATH", os.path.join(BASE_DIR, "settings", "feeds.json"))
PARSERS_JSON_PATH = os.environ.get("NEWS_PARSERS_PATH", os.path.join(BASE_DIR, "settings", "parsers.json"))

# 初始化全局默认空实体，防范空指针崩溃
RSS_FEEDS = {}
SITE_PARSER_CONFIGS = {}
DEFAULT_SITE_PROFILE = "generic"
HARD_MELTDOWN_TAGS = []
GHOST_IMAGE_PATTERNS = []
GLOBAL_URL_BLOCK_KEYWORDS = []

try:
    if os.path.exists(FEEDS_JSON_PATH):
        with open(FEEDS_JSON_PATH, "r", encoding="utf-8") as f:
            RSS_FEEDS = json.load(f)
            
    if os.path.exists(PARSERS_JSON_PATH):
        with open(PARSERS_JSON_PATH, "r", encoding="utf-8") as f:
            parser_data = json.load(f)
            SITE_PARSER_CONFIGS = parser_data.get("site_configs", {})
            DEFAULT_SITE_PROFILE = parser_data.get("default_site_profile", "generic")
            HARD_MELTDOWN_TAGS = parser_data.get("hard_meltdown_tags", [])
            GHOST_IMAGE_PATTERNS = parser_data.get("ghost_image_patterns", [])
            GLOBAL_URL_BLOCK_KEYWORDS = parser_data.get("global_url_block_keywords", [])
except Exception as e:
    print(f"致命错误：读取 settings 文件夹下的 JSON 配置文件破损，请检查语法格式。原因: {e}")