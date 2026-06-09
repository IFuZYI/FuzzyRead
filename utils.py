# -*- coding: utf-8 -*-
"""
utils.py: 核心清洗与网络请求工具包
安全过滤非法字符，并依托系统全局代理自动识别中英文进行正文剥离
"""

import re
import requests
from newspaper import Article
import config


def clean_filename(text):
    """过滤 Windows/Linux 下的非法字符，确保文件名合法"""
    text = re.sub(r"[\\/:*?\"<>|]", "", text)
    return text.strip().replace(" ", "_")


def scrape_full_text(url, feed_key):
    """依托系统全局代理，在线清洗并抓取 BBC 纯净的中英文文章全文"""
    try:
        # 自动识别语种卡尺：若为中文网订阅源则切入中文分词模式，英文源则切入英文模式
        lang = "zh" if "chinese" in feed_key else "en"
        article = Article(url, language=lang)
        
        # 纯净直连请求，系统底层代理会自动接管网络进行安全握手
        response = requests.get(url, headers=config.HEADERS, timeout=12)
        if response.status_code == 200:
            article.set_html(response.text)
            article.parse()
            return article.text
        return ""
    except Exception:
        # 单篇提取异常时静默容错，保护整个大任务管线不断裂
        return ""