# -*- coding: utf-8 -*-
"""
config.py: 中央配置文件
集中管理下载根路径变量、多站 RSS 订阅矩阵、全局伪装头及各媒体 CSS 核心容器白名单
"""

import datetime

# 🎯【新增全局路径控制卡尺】：支持相对路径（如 "articles"）或绝对路径（如 "E:/外刊资产库"）
# 系统会自动创建该文件夹，并将各媒体专栏隔离存放在其下方
DOWNLOAD_BASE_DIR = "articles"


# 1. 全站原生 RSS 订阅源矩阵
RSS_FEEDS = {
    "bbc_chinese_simp": "https://feeds.bbci.co.uk/zhongwen/simp/rss.xml",
    "bbc_chinese_trad": "https://feeds.bbci.co.uk/zhongwen/trad/rss.xml",
    "bbc_english_top": "http://feeds.bbci.co.uk/news/rss.xml",
    "bbc_english_world": "http://feeds.bbci.co.uk/news/world/rss.xml",
    "bbc_english_business": "http://feeds.bbci.co.uk/news/business/rss.xml",
    "bbc_english_technology": "http://feeds.bbci.co.uk/news/technology/rss.xml",
    "bbc_english_science": "http://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
    "bbc_english_health": "http://feeds.bbci.co.uk/news/health/rss.xml",
    "bbc_english_arts": "http://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
    
    # 时代周刊 (TIME) 官方全局综合源
    "time_english_top": "https://time.com/feed/"
}

# 2. 多站自适应 CSS 正文黄金容器选择器配置盘
SITE_PARSER_CONFIGS = {
    "bbc": {
        "core_selectors": ["article", '[data-component="text-block"]'],
        "paragraph_class_pattern": r'StyledParagraph|Paragraph',
        "bad_sub_selectors": [
            '[data-testid="links-grid"]', '[data-testid="links-container"]',
            '[data-testid="chester-card"]', '[data-testid="promo-box"]',
            '[class*="links-grid"]', 'aside', '.advert', '.commercial'
        ],
        "video_signals": ['toucan-player', 'bbcMediaPlayer', 'media-player-container', 'smp-video-layout', 'smpVideoElement']
    },
    "time": {
        "core_selectors": ["article", ".article-content", "#article-body", ".body-copy", "#main-content"],
        "paragraph_class_pattern": r'paragraph|components|rich-text',
        "bad_sub_selectors": [
            '.newsletter-signup', '.inline-sidebar', '.branded-wrapper',
            '.outbrain-wrapper', '.social-share', '.video-player-embed',
            '.marketing-blurb', 'aside', 'script', 'style', '.advertisement',
            '.rail-advertinement', '.inline-article-advertinement'
        ],
        "video_signals": ['jwplayer', 'video-player', 'brightcove', 'embed/video']
    }
}

# 3. 通用上游视音频/直播无文本 URL 物理阻断黑名单
GLOBAL_URL_BLOCK_KEYWORDS = [
    '/videos/', '/audio/', 'sounds/play/', '/live/', 
    '/video/', '/podcasts/', '/audio-clips/'
]

# 互联网档案馆 CDX API 基础链接
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