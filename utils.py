# -*- coding: utf-8 -*-
"""
utils.py: 工业级多站自适应立体资产清洗引擎
引入高敏捷 CSS 类名节点爆破与句内前置指纹拦截双卡尺，100% 物理绝杀正文 Advertisement 广告污染
"""

import re
import time
import logging
import requests
from bs4 import BeautifulSoup, NavigableString
from newspaper import Article
import config

# 获取中央日志记录器
logger = logging.getLogger("multi_harvest")

# 初始化常驻全局网络会话，建立持久化 TCP 连接池
http_session = requests.Session()

# 🎯【降维绝杀卡尺一】：全面封杀 BBC 与时代周刊全站通用的广告、Martech 赞助商专属容器类名特征指纹库
BAD_SUB_SELECTORS = [
    'nav', 'footer', 'header', '[data-testid="links-grid"]',        
    '[data-testid="links-container"]', '[data-testid="chester-card"]',      
    '[data-testid="promo-box"]', '[class*="links-grid"]', 'aside', 
    '.social-shares', '.sp-story-body__related-item',
    
    # 时代周刊与媒体专用的中插广告占位容器
    '.advert', '.commercial', '.newsletter-signup', '.rail-advertisement', 
    '.inline-article-advertisement', '.advertisement', '[class*="advertisement"]',
    '.branded-wrapper', '.outbrain-wrapper', '.marketing-blurb'
]

# 幽灵垃圾死图特征阻断卡尺
GHOST_IMAGE_PATTERNS = [
    r'data:image', r'placeholder', r'trans\.gif', r'space\.gif', 
    r'/1x1/', r'analytics', r'tracking', r'dot\.gif'
]

# 富媒体精确作用域实体节点拦截矩阵
HARD_MELTDOWN_TAGS = ['table', 'iframe', 'video', 'embed', 'object']


def clean_filename(text):
    """过滤 Windows/Linux 下的非法字符，确保文件名合法"""
    text = re.sub(r"[\\/:*?\"<>|]", "", text)
    return text.strip().replace(" ", "_")


def detect_site_brand(feed_key, url):
    """自适应站点识别器"""
    if "time" in feed_key or "time.com" in url:
        return "time"
    return "bbc"


def parse_inline_elements(parent_el):
    """
    句内混合排版流式重组器
    将含有 b、strong 等错综复杂的富文本平推转化为单行纯净 Markdown，杜绝漏字与内容截断
    """
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
    """
    泛实体自适应顺序检索雷达
    完美重组正文，并在文字转换最核心死角扼杀 Advertisement 广告行
    """
    markdown_pieces = []
    image_idx = 0
    
    # =================================================================
    # 步骤 1：高清原厂纪实图片打捞雷达
    # =================================================================
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
                for pattern in GHOST_IMAGE_PATTERNS:
                    if re.search(pattern, img_url, re.IGNORECASE):
                        is_ghost = True
                        break
                        
                if not is_ghost and img_url.startswith('http') and img_url not in found_images:
                    found_images.append(img_url)
                    markdown_pieces.append(f"\n\n![Illustration]({img_url})\n\n")
                    image_idx += 1

    # =================================================================
    # 步骤 2：全频道泛实体顺序扫描与文本去广告过滤
    # =================================================================
    for el in target_container.find_all(['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'div']):
        if el.get('data-block') == 'links' or el.get('data-testid') == 'links-element':
            continue
            
        tag_name = el.name
        
        # 标题识别轨
        if tag_name in ['h2', 'h3', 'h4'] or el.get('data-testid') == 'heading-content' or el.get('data-testid') == 'heading-element':
            t_text = el.get_text().strip()
            
            # 🎯【降维绝杀卡尺二】：行为特征核对！如果小标题或段落文本中包含了任何广告控制字，直接宣布出局
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
            
            # 🎯【降维绝杀卡尺二】：行为特征核对！如果段落包含 advertisement 标识，100% 内存抹杀，拒绝进入 Markdown 流
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
    """标准自然图文外刊全量收割主引擎"""
    html_source = ""
    site_brand = detect_site_brand(feed_key, url)
    site_policy = config.SITE_PARSER_CONFIGS.get(site_brand, config.SITE_PARSER_CONFIGS["bbc"])
    
    found_images = [] 
    max_retries = 3
    retry_delay = 2
    
    logger.debug(f"正在拉取目标外刊源码 -> 频道类型: {site_brand.upper()} -> URL: {url}")
    
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
            # 实体节点强拦截
            found_bad_tag = target_container.find(HARD_MELTDOWN_TAGS)
            if found_bad_tag:
                logger.warning(f"硬拦截触发 -> 正文核心区内部确实嵌套了非标实体标签: [{found_bad_tag.name}]，不予考虑: {url}")
                return ""

            # 🎯 清减无关广告与 Martech 噪声容器，执行内存 Decompose 彻底粉碎
            for sub_selector in BAD_SUB_SELECTORS:
                for bad_node in target_container.select(sub_selector):
                    bad_node.decompose()

            for nav_link in target_container.find_all('a', href=re.compile(r'^/|bbc\.(com|co\.uk)|time\.com')):
                nav_link.unwrap()
                
            # 执行高精去噪提取算法
            extracted_markdown = extract_pure_markdown_by_attributes(target_container, feed_key, found_images, site_brand)
            if len(extracted_markdown) > 250:
                logger.info(f"标准高精度图文长文收割提取成功 [{site_brand.upper()} | 长度: {len(extracted_markdown)} 字节]: {url}")
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
            
            if soup_node.find(HARD_MELTDOWN_TAGS):
                return ""
                    
            text = extract_pure_markdown_by_attributes(soup_node, feed_key, found_images, site_brand)
            if len(text) > 150:
                return text

        # 轨道三：行级兜底
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
        logger.error(f"提取标准正文出现未知异常: {e}, URL: {url}")
        return ""