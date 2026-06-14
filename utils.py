# -*- coding: utf-8 -*-
"""
utils.py: 工业级多站自适应抗震荡内容资产全量提取引擎
修复 BBC Sport 域名错位导致的超链接提取熔断退出漏洞，确保长文 100% 完整留存
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

# 初始化常驻全局网络会话，建立持久化 TCP 连接池
http_session = requests.Session()

# 必须在核心正文容器内部靶向切除的垃圾噪声容器指纹库
BAD_SUB_SELECTORS = [
    'nav', 'footer', 'header', '[data-testid="links-grid"]',        
    '[data-testid="links-container"]', '[data-testid="chester-card"]',      
    '[data-testid="promo-box"]', '[class*="links-grid"]', 'aside', 
    '.advert', '.commercial', '.newsletter-signup',
    'smp-toucan-player', 'toucan-player', '#bbcMediaPlayer0', 
    '[data-block="media"]', '.media-player-container', '[class*="MediaPlayerWrapper"]',
    'noscript', 'video', 'smp-video-layout', 'smp-preplay-layout', 'smp-error-layout'
]

GHOST_IMAGE_PATTERNS = [
    r'data:image', r'placeholder', r'trans\.gif', r'space\.gif', 
    r'/1x1/', r'analytics', r'tracking', r'dot\.gif'
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


def convert_element_to_markdown_with_images(soup_node, feed_key, found_images):
    """
    核心富文本转换器
    100% 按原文相对物理顺序，地毯式扫描并精准无损复原纯净图文，移除了导致误熔断的隐患
    """
    if not soup_node:
        return ""

    markdown_pieces = []
    image_idx = 0
    
    for el in soup_node.find_all(['p', 'h2', 'h3', 'h4', 'strong', 'b', 'li', 'figure', 'img']):
        tag_name = el.name
        
        if tag_name in ['figure', 'img']:
            img_tag = el if tag_name == 'img' else el.find('img')
            if img_tag:
                img_url = ""
                for attr in ['data-src', 'data-delay-src', 'data-original', 'original']:
                    if img_tag.get(attr):
                        img_url = img_tag.get(attr).strip()
                        break
                        
                if not img_url and img_tag.get('srcset'):
                    try:
                        srcset_str = img_tag.get('srcset')
                        img_url = srcset_str.split(',')[-1].strip().split(' ')[0]
                    except Exception:
                        pass
                        
                if not img_url and img_tag.get('src'):
                    img_url = img_tag.get('src').strip()

                if img_url:
                    is_ghost = False
                    for pattern in GHOST_IMAGE_PATTERNS:
                        if re.search(pattern, img_url, re.IGNORECASE):
                            is_ghost = True
                            break
                            
                    if not is_ghost and img_url.startswith('http') and img_url not in found_images:
                        found_images.append(img_url)
                        markdown_pieces.append(f"\n\n![Illustration](./img_{image_idx}.jpg)\n\n")
                        image_idx += 1
            continue

        text_content = el.get_text().strip()
        if not text_content:
            continue
            
        # 过滤广告与不必要的系统提示行
        if "advertisement" in text_content.lower() or text_content.startswith("Read More"):
            continue

        # 🎯【核心修复点】：移除之前版本错误的 return False 隐患，改为 continue 跳过无意义碎屑，保障主数据流绝不断流
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


def scrape_full_text_and_images(url, feed_key):
    """自适应多站独立生命周期正文与图片双资产联合细粒度审计提取引擎"""
    html_source = ""
    site_brand = detect_site_brand(feed_key, url)
    site_policy = config.SITE_PARSER_CONFIGS.get(site_brand, config.SITE_PARSER_CONFIGS["bbc"])
    
    found_images = [] 
    max_retries = 3
    retry_delay = 2
    
    for attempt in range(max_retries):
        try:
            response = http_session.get(url, headers=config.HEADERS, timeout=12)
            if response.status_code == 200:
                html_source = response.text
                break
            time.sleep(retry_delay)
            retry_delay *= 2
        except Exception as e:
            time.sleep(retry_delay)
            retry_delay *= 2
            
    if not html_source:
        return "", []

    try:
        lang = "zh" if "chinese" in feed_key else "en"
        article = Article(url, language=lang)
        soup = BeautifulSoup(html_source, "lxml")

        # =================================================================
        # 轨道一：策略模式 · 精准 CSS 黄金容器锁定与图片多轨探测
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
            for sub_selector in BAD_SUB_SELECTORS:
                for bad_node in target_container.select(sub_selector):
                    bad_node.decompose()

            # 🎯【泛媒体超链接解耦】：升级正则，将包含了 /news/、/sport/、/articles/ 等全频道超链接统一脱敏还原为文本文字
            for nav_link in target_container.find_all('a', href=re.compile(r'^/|bbc\.(com|co\.uk)')):
                nav_link.unwrap()
                
            extracted_markdown = convert_element_to_markdown_with_images(target_container, feed_key, found_images)
            if len(extracted_markdown) > 250:
                return extracted_markdown, found_images

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
            text = convert_element_to_markdown_with_images(soup_node, feed_key, found_images)
            if len(text) > 150:
                return text, found_images

        # 轨道三：最严格行级二次审计去噪兜底
        if article.text and len(article.text) > 100:
            paragraphs = article.text.split('\n')
            cleaned_pieces = []
            for p in paragraphs:
                p_str = p.strip()
                if "advertisement" in p_str.lower() or p_str.startswith("Read More:"):
                    continue
                if len(p_str) > 25 and not p_str.startswith('/') and not p_str.endswith('}'):
                    cleaned_pieces.append(f"\n\n{p_str}\n\n")
            return "".join(cleaned_pieces).strip(), found_images
            
        return "", []
    except Exception as e:
        logger.error(f"提取富文本和插图出现异常: {e}, URL: {url}")
        return "", []