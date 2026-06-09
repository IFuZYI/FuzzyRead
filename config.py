# -*- coding: utf-8 -*-
"""
config.py: 中央配置文件
集中管理 BBC 官方中英文原生 RSS 订阅矩阵与网络档案馆核心 API
"""

# BBC 官方原生 RSS 订阅源矩阵（作为本地隔离文件夹命名的绝对基准）
RSS_FEEDS = {
    # BBC 中文网
    "bbc_chinese_simp": "https://feeds.bbci.co.uk/zhongwen/simp/rss.xml",
    "bbc_chinese_trad": "https://feeds.bbci.co.uk/zhongwen/trad/rss.xml",
    # BBC 英文网
    "bbc_english_top": "http://feeds.bbci.co.uk/news/rss.xml",
    "bbc_english_world": "http://feeds.bbci.co.uk/news/world/rss.xml",
    "bbc_english_business": "http://feeds.bbci.co.uk/news/business/rss.xml",
    "bbc_english_technology": "http://feeds.bbci.co.uk/news/technology/rss.xml",
    "bbc_english_science": "http://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
    "bbc_english_health": "http://feeds.bbci.co.uk/news/health/rss.xml",
    "bbc_english_arts": "http://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
}

# 互联网档案馆 CDX API 基础链接
WAYBACK_CDX_URL = "http://web.archive.org/cdx/search/cdx"

# 统一伪装标准浏览器 Headers
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}