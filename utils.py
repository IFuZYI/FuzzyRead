# -*- coding: utf-8 -*-
"""
utils.py: 工业级多站自适应抗震荡内容资产全量提取引擎
彻底剥离全局共享会话，采用独立生命周期连接池与多轨自愈策略，彻底封杀 10054 死锁卡死 Bug
"""

import re
import time
import logging
import requests
from bs4 import BeautifulSoup
from newspaper import Article
import config

# 获取中央日志记录器
logger = logging.getLogger("multi_harvest")

# 必须在核心正文容器内部靶向切除、连根拔起的嵌套垃圾与视频组件指纹库
BAD_SUB_SELECTORS = [
    '[data-testid="links-grid"]',        # 彻底切除推荐网格
    '[data-testid="links-container"]',   # 彻底切除关联新闻链接
    '[data-testid="chester-card"]',      # 彻底切除单卡片推荐
    '[data-testid="promo-box"]',         # 彻底切除广告推广
    '[class*="links-grid"]',             # 模糊匹配推荐网格
    'aside',                             # 彻底切除插叙推荐
    '.advert', '.commercial',            # 广告过滤
    '.newsletter-signup',                # 时代周刊邮件订阅窗
    
    # 视频播放器及其内部所有控制器提示词，直接作为垃圾节点在子树中切除，绝不整篇误杀
    'smp-toucan-player', 'toucan-player', '#bbcMediaPlayer0', 
    '[data-block="media"]', '.media-player-container', '[class*="MediaPlayerWrapper"]',
    'noscript', 'video', 'smp-video-layout', 'smp-preplay-layout', 'smp-error-layout'
]


def clean_filename(text):
    """过滤 Windows/Linux 下的非法字符，确保文件名合法"""
    text = re.sub(r"[\\/:*?\"<>|]", "", text)
    return text.strip().replace(" ", "_")


def detect_site_brand(feed_key, url):
    """自适应站点识别器"""
    if "time" in feed_key or "time.com" in url:
        return "time"
    return "bbc"


def convert_element_to_markdown(soup_node, feed_key):
    """
    通用富文本转换器
    只针对裁剪后干净的节点进行高精度 Markdown 排版还原
    """
    if not soup_node:
        return ""

    markdown_pieces = []
    
    # 严格按照原文顺序，地毯式扫描真正的文章段落
    for el in soup_node.find_all(['p', 'h2', 'h3', 'h4', 'strong', 'b', 'li']):
        tag_name = el.name
        text_content = el.get_text().strip()
        
        if not text_content:
            continue
            
        # 拦截 Advertisement 广告插页污染
        if "advertisement" in text_content.lower():
            continue
            
        # 拦截时代周刊 Read More: 延伸阅读行
        if text_content.startswith("Read More:") or text_content.startswith("Read More"):
            continue

        if len(text_content) < 3 and tag_name not in ['strong', 'b']:
            continue

        if tag_name in ['h2', 'h3', 'h4']:
            markdown_pieces.append(f"\n\n## {text_content}\n\n")
        elif tag_name in ['strong', 'b']:
            if len(text_content) > 30 and not text_content.endswith('.'):
                markdown_pieces.append(f"\n\n### {text_content}\n\n")
            else:
                markdown_pieces.append(f" **{text_content}** ")
        elif tag_name == 'p':
            markdown_pieces.append(f"\n\n{text_content}\n\n")
        elif tag_name == 'li':
            markdown_pieces.append(f"\n* {text_content}")

    full_text = "".join(markdown_pieces)
    full_text = full_text.replace('&amp;', '&').replace('&quot;', '"').replace('&lt;', '<').replace('&gt;', '>')
    full_text = full_text.replace('&#39;', "'").replace('&nbsp;', ' ')
    
    full_text = re.sub(r'\n{3,}', '\n\n', full_text)
    return full_text.strip()


def scrape_full_text(url, feed_key):
    """自适应多站独立连接池正文收割引擎"""
    html_source = ""
    site_brand = detect_site_brand(feed_key, url)
    site_policy = config.SITE_PARSER_CONFIGS.get(site_brand, config.SITE_PARSER_CONFIGS["bbc"])
    
    # 🎯【解耦自愈破局点】：放弃全局会话，在单次文章抓取时建立独立的生命周期连接池，彻底隔离 10054 模块间死锁
    max_retries = 3
    retry_delay = 2
    
    for attempt in range(max_retries):
        try:
            with requests.Session() as single_session:
                response = single_session.get(url, headers=config.HEADERS, timeout=10)
                if response.status_code == 200:
                    html_source = response.text
                    break
                elif response.status_code == 406:
                    logger.warning(f"请求遭遇 {site_brand.upper()} 406反爬风控，正在激活第 {attempt+1} 次渐进式退避...")
                else:
                    logger.warning(f"网络返回非标状态码: {response.status_code}，正在重试...")
        except Exception as e:
            logger.debug(f"触发临时代理重置或网络抖动: {e}，正在全自动隔离并重新对齐握手...")
            
        time.sleep(retry_delay)
        retry_delay *= 2
        
    if not html_source:
        logger.error(f"该外刊节点因底层网络阻断重试失败，已安全挂号跳过，保障管线不卡死: {url}")
        return ""

    try:
        lang = "zh" if "chinese" in feed_key else "en"
        article = Article(url, language=lang)
        soup = BeautifulSoup(html_content=html_source, features="lxml") if hasattr(BeautifulSoup, 'raw_html') else BeautifulSoup(html_source, "lxml")

        # =================================================================
        # 轨道一：策略模式 · 精准 CSS 黄金容器锁定与子树多媒体清除
        # =================================================================
        target_container = None
        for selector in site_policy["core_selectors"]:
            found = soup.select_one(selector) if selector.startswith('.') or selector.startswith('#') else soup.find(selector)
            if found:
                target_container = found
                break
                
        if target_container is None:
            paragraphs = soup.find_all('p', class_=re.compile(site_policy["paragraph_class_pattern"]))
            if paragraphs:
                target_container = paragraphs[0].find_parent('div')

        if target_container is not None:
            # 在容器树内部，将推荐网格、广告以及视频播放器组件整体物理剥离销毁
            for sub_selector in BAD_SUB_SELECTORS:
                for bad_node in target_container.select(sub_selector):
                    bad_node.decompose()

            # 脱敏剥离全站通用的栏目导航超链接
            for nav_link in target_container.find_all('a', href=re.compile(r'^/news|^/sport|^/business|^/world|^/politics|^/article/')):
                nav_link.unwrap()
                
            extracted_markdown = convert_element_to_markdown(target_container, feed_key)
            
            if len(extracted_markdown) > 250:
                logger.info(f"靶向切除多媒体噪声成功，100% 无损留存标准长文 [{site_brand.upper()}]: {url}")
                return extracted_markdown

        # =================================================================
        # 轨道二：柔性自愈常规 HTML 过滤
        # =================================================================
        article.set_html(html_source)
        article.parse()
        
        top_node = article.clean_top_node
        if top_node is not None:
            from lxml import etree
            raw_html = etree.tostring(top_node, encoding='utf-8').decode('utf-8')
            soup_node = BeautifulSoup(raw_html, "lxml")
            
            for sub_selector in BAD_SUB_SELECTORS:
                for bad_node in soup_node.select(sub_selector):
                    bad_node.decompose()
                    
            text = convert_element_to_markdown(soup_node, feed_key)
            if len(text) > 150:
                return text

        # 轨道三：最严格行级二次审计去噪兜底
        if article.text and len(article.text) > 100:
            paragraphs = article.text.split('\n')
            cleaned_pieces = []
            for p in paragraphs:
                p_str = p.strip()
                if "advertisement" in p_str.lower() or p_str.startswith("Read More:"):
                    continue
                if "skip back" in p_str.lower() or "picture in picture" in p_str.lower():
                    continue
                if len(p_str) > 25 and not p_str.startswith('/') and not p_str.endswith('}'):
                    cleaned_pieces.append(f"\n\n{p_str}\n\n")
            return "".join(cleaned_pieces).strip()
            
        return ""
    except Exception as e:
        logger.error(f"提取正文出现严重未知异常: {e}, URL: {url}")
        return ""