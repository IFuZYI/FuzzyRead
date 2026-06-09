# -*- coding: utf-8 -*-
"""config.py: 中央配置文件"""

import os

# ==================== 资产与存储配置 ====================
# 本地文章资产存放根目录
BASE_OUTPUT_DIR = "bbc_official_articles"

# ==================== 官方原生 RSS 订阅源配置 ====================
# 支持批量配置，代码会自动遍历跑完
RSS_FEEDS = {
    "bbc_news": "https://feeds.bbci.co.uk/news/rss.xml",
    "bbc_world": "https://feeds.bbci.co.uk/news/world/rss.xml",
}

# ==================== 互联网档案馆接口配置 ====================
# 互联网档案馆 CDX API 基础链接，用于检索历史备份 XML 记录
WAYBACK_CDX_URL = "http://web.archive.org/cdx/search/cdx"

# ==================== 统一网络伪装配置 ====================
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}