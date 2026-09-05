# -*- coding: utf-8 -*-
"""
utils.py: 工业级多站自适应立体资产清洗引擎
完美对接 config 映射而来的纯净 JSON 属性卡尺，采用流式子节点平铺迭代算法
"""

import re
import time
import logging
import requests
from bs4 import BeautifulSoup, NavigableString
from newspaper import Article
import config

logger = logging.getLogger("multi_harvest")

# 初始化常驻全局网络会话，建立持久化 TCP 连接池
http_session = requests.Session()


def clean_filename(text):
    """过滤 Windows/Linux 下的非法字符，确保文件名合法"""
    text = re.sub(r"[\\/:*?\"<>|]", "", text)
    return text.strip().replace(" ", "_")


def detect_site_brand(feed_key, url):
    """自适应站点识别器：匹配规则来自 parsers.json 的 match 字段。

    未命中任何站点档案时回落到 default_site_profile（通用档案），
    这样从 /admin 新增的订阅源无需改代码即可解析。
    """
    haystack = f"{feed_key} {url}".lower()
    default_profile = getattr(config, "DEFAULT_SITE_PROFILE", "generic")

    for brand, policy in config.SITE_PARSER_CONFIGS.items():
        if brand == default_profile:
            continue
        for token in policy.get("match", []):
            if token and token.lower() in haystack:
                return brand

    if default_profile in config.SITE_PARSER_CONFIGS:
        return default_profile
    return next(iter(config.SITE_PARSER_CONFIGS), "generic")


def parse_inline_elements(parent_el):
    """句内混合排版流式重组器"""
    if not parent_el:
        return ""
        
    line_pieces = []
    for child in parent_el.contents:
        if isinstance(child, NavigableString):
            line_pieces.append(str(child))
        elif child.name in ['b', 'strong']:
            inner_text = child.get_text().strip()
            if inner_text:
                line_pieces.append(f" **{inner_text}** ")
        elif child.name in ['i', 'em', 'span', 'a']:
            inner_text = child.get_text()
            if inner_text:
                line_pieces.append(inner_text)
                
    full_sentence = "".join(line_pieces).strip()
    return re.sub(r'\s+', ' ', full_sentence)


def extract_pure_markdown_by_attributes(target_container, feed_key, found_images, site_brand):
    """泛实体自适应顺序检索雷达"""
    markdown_pieces = []
    
    # 1. 提取高清原厂纪实图片
    for img_node in target_container.find_all(['figure', 'img', 'div', 'section']):
        is_asset = img_node.get('data-cslp-field-type') == 'Asset' or img_node.get('data-testid') == 'image-content' or img_node.get('data-testid') == 'image-element'
        img_tag = img_node if img_node.name == 'img' else img_node.find('img')
        
        if (is_asset or img_tag) and img_tag:
            img_url = ""
            for attr in ['data-src', 'data-delay-src', 'data-original', 'original', 'src']:
                if img_tag.get(attr):
                    img_url = img_tag.get(attr).strip()
                    break
            if not img_url and img_tag.get('srcset'):
                try:
                    img_url = img_tag.get('srcset').split(',')[-1].strip().split(' ')[0]
                except Exception:
                    pass

            if img_url:
                is_ghost = False
                for pattern in config.GHOST_IMAGE_PATTERNS:
                    if re.search(pattern, img_url, re.IGNORECASE):
                        is_ghost = True
                        break
                        
                if not is_ghost and img_url.startswith('http') and img_url not in found_images:
                    found_images.append(img_url)
                    markdown_pieces.append(f"\n\n![Illustration]({img_url})\n\n")

    # 2. 全频道泛实体顺序扫描与文本提取
    for el in target_container.find_all(['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'div']):
        if el.get('data-block') == 'links' or el.get('data-testid') == 'links-element':
            continue
            
        tag_name = el.name
        
        # 标题识别轨
        if tag_name in ['h2', 'h3', 'h4'] or el.get('data-testid') == 'heading-content' or el.get('data-testid') == 'heading-element':
            t_text = el.get_text().strip()
            if "advertisement" in t_text.lower() or t_text.startswith("Read More"):
                continue
            if t_text and len(t_text) > 3:
                markdown_pieces.append(f"\n\n## {t_text}\n\n")
            continue
            
        # 真实正文段落轨
        if tag_name == 'p':
            if site_brand == "bbc" and el.find_parent(attrs={"data-block": "links"}):
                continue
                
            pure_sentence = parse_inline_elements(el)
            if "advertisement" in pure_sentence.lower() or pure_sentence.startswith("Read More"):
                continue
                
            if pure_sentence and len(pure_sentence) > 3:
                markdown_pieces.append(f"\n\n{pure_sentence}\n\n")
            continue
            
        # 无序列表条目轨
        if tag_name in ['ul', 'ol']:
            for li in el.find_all('li', recursive=False):
                li_sentence = parse_inline_elements(li)
                if "advertisement" in li_sentence.lower() or li_sentence.startswith("Read More"):
                    continue
                if li_sentence and len(li_sentence) > 2:
                    markdown_pieces.append(f"\n* {li_sentence}")
            continue

    return "".join(markdown_pieces).strip()


def scrape_full_text(url, feed_key):
    """自适应多站通用标准图文长文高精提取引擎"""
    html_source = ""
    site_brand = detect_site_brand(feed_key, url)
    site_policy = config.SITE_PARSER_CONFIGS.get(site_brand, {})
    if not site_policy:
        fallback = getattr(config, "DEFAULT_SITE_PROFILE", "generic")
        site_policy = config.SITE_PARSER_CONFIGS.get(fallback, {})
    if not site_policy:
        logger.warning(f"未找到任何可用的站点解析档案，跳过: {url}")
        return ""
        
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
        except Exception:
            time.sleep(retry_delay)
            retry_delay *= 2
            
    if not html_source:
        return ""

    try:
        soup = BeautifulSoup(html_source, "lxml")

        # =================================================================
        # 轨道一：策略模式 · 精准 CSS 黄金容器卡位
        # =================================================================
        target_container = None
        for selector in site_policy.get("core_selectors", []):
            found = soup.select_one(selector) if selector.startswith('.') or selector.startswith('#') else soup.find(selector)
            if found:
                target_container = found
                break
                
        if target_container is None:
            paragraphs = soup.find_all('p', class_=re.compile(site_policy.get("paragraph_class_pattern", "")))
            if paragraphs:
                target_container = paragraphs[0].find_parent('div')

        if target_container is not None:
            # 强类型实体对象标签拦截
            found_bad_tag = target_container.find(config.HARD_MELTDOWN_TAGS)
            if found_bad_tag:
                logger.warning(f"富媒体硬拦截触发 -> 正文核心内部检测到实体标签: [{found_bad_tag.name}]，抛弃非标页: {url}")
                return ""

            # 清减无关垃圾容器
            for sub_selector in site_policy.get("bad_sub_selectors", []):
                for bad_node in target_container.select(sub_selector):
                    bad_node.decompose()

            for nav_link in target_container.find_all('a', href=re.compile(r'^/|bbc\.(com|co\.uk)|time\.com')):
                nav_link.unwrap()
                
            extracted_markdown = extract_pure_markdown_by_attributes(target_container, feed_key, found_images, site_brand)
            if len(extracted_markdown) > 250:
                logger.info(f"标准图文长文收割提取成功 [{site_brand.upper()} | 长度: {len(extracted_markdown)} 字节]: {url}")
                return extracted_markdown

        # =================================================================
        # 轨道二：自愈常规图文兜底机制
        # =================================================================
        article = Article(url, language="zh" if "chinese" in feed_key else "en")
        article.set_html(html_source)
        article.parse()
        top_node = article.clean_top_node
        if top_node is not None:
            from lxml import etree
            raw_html = etree.tostring(top_node, encoding='utf-8').decode('utf-8')
            soup_node = BeautifulSoup(raw_html, "lxml")
            
            if soup_node.find(config.HARD_MELTDOWN_TAGS):
                return ""
                    
            text = extract_pure_markdown_by_attributes(soup_node, feed_key, found_images, site_brand)
            if len(text) > 150:
                return text

        # 轨道三：最严格行级二次去噪对齐
        if article.text and len(article.text) > 100:
            paragraphs = article.text.split('\n')
            cleaned_pieces = []
            for p in paragraphs:
                p_str = p.strip()
                if "advertisement" in p_str.lower() or p_str.startswith("Read More:"):
                    continue
                if len(p_str) > 25 and not p_str.startswith('/') and not p_str.endswith('}'):
                    cleaned_pieces.append(f"\n\n{p_str}\n\n")
            return "".join(cleaned_pieces).strip()
            
        return ""
    except Exception as e:
        logger.error(f"提取标准正文出现未知致命异常: {e}, URL: {url}")
        return ""