# -*- coding: utf-8 -*-
"""utils.py: 核心清洗与网络请求工具包"""

import re
import requests
from newspaper import Article
import config


def clean_filename(text):
    """过滤非法字符，确保文件名在 Windows/Linux 下安全合法"""
    text = re.sub(r"[\\/:*?\"<>|]", "", text)
    return text.strip().replace(" ", "_")


def scrape_full_text(url):
    """利用系统代理，自力更生跨越网络长城强行抠出最干净的完整正文"""
    try:
        article = Article(url, language="en")
        # 直接依托系统代理进行轻量直连请求
        response = requests.get(url, headers=config.HEADERS, timeout=12)
        if response.status_code == 200:
            article.set_html(response.text)
            article.parse()
            return article.text
        return ""
    except Exception:
        # 单篇抓取异常时静默容错，保护整个大管道不断裂
        return ""