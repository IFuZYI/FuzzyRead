# -*- coding: utf-8 -*-
"""
utils.py: 工业级核心容器锁定与内嵌视频组件反向阻断清洗工具包
全面捕获并物理拦截文章中间夹杂原生视频播放器（toucan-player、bbcMediaPlayer）的非标漏流页面
"""

import re
import requests
import logging
from bs4 import BeautifulSoup
from newspaper import Article
import config

# 获取中央日志记录器
logger = logging.getLogger("bbc_harvest")

# 必须在核心正文容器内部靶向切除的嵌套垃圾组件指纹库
BAD_SUB_SELECTORS = [
    '[data-testid="links-grid"]',        
    '[data-testid="links-container"]',   
    '[data-testid="chester-card"]',      
    '[data-testid="promo-box"]',         
    '[class*="links-grid"]',             
    'aside',                             
    '.advert', '.commercial'             
]

# 核心卡尺：只要文章中间掺杂了以下任何视频播放器指纹，坚决物理抹杀，整篇抛弃
VIDEO_PLAYER_SIGNALS = [
    'toucan-player', 'bbcMediaPlayer', 'media-player-container', 
    'smp-playback', 'smp-video-layout', 'smpVideoElement'
]


def clean_filename(text):
    """过滤 Windows/Linux 下的非法字符，确保文件名合法"""
    text = re.sub(r"[\\/:*?\"<>|]", "", text)
    return text.strip().replace(" ", "_")


def convert_element_to_markdown(soup_node):
    """
    核心富文本转换器
    针对锁定的核心正文节点进行高度精准的 H2/H3 小标题与加粗强调样式重构
    """
    if not soup_node:
        return ""

    markdown_pieces = []
    
    # 按照原文顺序高精度恢复真正的排版样式
    for el in soup_node.find_all(['p', 'h2', 'h3', 'h4', 'strong', 'b', 'li']):
        tag_name = el.name
        text_content = el.get_text().strip()
        
        if not text_content:
            continue
            
        if len(text_content) < 3 and tag_name not in ['strong', 'b']:
            continue

        # 1. 恢复真正属于正文的小标题
        if tag_name in ['h2', 'h3', 'h4']:
            markdown_pieces.append(f"\n\n## {text_content}\n\n")
            
        # 2. 恢复句中加粗强调样式
        elif tag_name in ['strong', 'b']:
            if len(text_content) > 30 and not text_content.endswith('.'):
                markdown_pieces.append(f"\n\n### {text_content}\n\n")
            else:
                markdown_pieces.append(f" **{text_content}** ")
                
        # 3. 恢复标准正文段落
        elif tag_name == 'p':
            markdown_pieces.append(f"\n\n{text_content}\n\n")
            
        # 4. 恢复无序列表分条排版
        elif tag_name == 'li':
            markdown_pieces.append(f"\n* {text_content}")

    # 合拢文本碎片
    full_text = "".join(markdown_pieces)
    
    # 还原标点转义
    full_text = full_text.replace('&amp;', '&').replace('&quot;', '"').replace('&lt;', '<').replace('&gt;', '>')
    full_text = full_text.replace('&#39;', "'").replace('&nbsp;', ' ')
    
    # 连续空行压缩
    full_text = re.sub(r'\n{3,}', '\n\n', full_text)
    return full_text.strip()


def scrape_full_text(url, feed_key):
    """依托系统全局代理，100% 净化拦截内嵌视频文章的标准外刊提取引擎"""
    try:
        lang = "zh" if "chinese" in feed_key else "en"
        article = Article(url, language=lang)
        
        # 1. 发起请求拉回原厂静态源码
        response = requests.get(url, headers=config.HEADERS, timeout=12)
        if response.status_code != 200:
            return ""
            
        html_source = response.text
        
        # 🎯【上游卡尺阻断】：一针见血，只要源码中包含任何原厂内嵌视频播放器的核心组件指纹，整篇直接抛弃
        if any(signal in html_source for signal in VIDEO_PLAYER_SIGNALS):
            logger.debug(f"成功捕获并切断中间夹杂了原生视频播放器的污染文章: {url}")
            return ""

        soup = BeautifulSoup(html_source, "lxml")

        # =================================================================
        # 轨道一：精准 CSS 黄金容器锁定
        # =================================================================
        target_container = None
        
        # 优先卡锁标准 article 骨架
        if soup.find('article'):
            target_container = soup.find('article')
        elif soup.find(attrs={"data-component": "text-block"}):
            target_container = soup.find(attrs={"data-component": "text-block"}).parent
        else:
            paragraphs = soup.find_all('p', class_=re.compile(r'StyledParagraph|Paragraph'))
            if paragraphs:
                target_container = paragraphs[0].find_parent('div')

        if target_container is not None:
            # 靶向切除内嵌在正文里的推荐卡片和卡片推荐网格
            for sub_selector in BAD_SUB_SELECTORS:
                for bad_node in target_container.select(sub_selector):
                    bad_node.decompose() 

            # 剥离残存的直连栏目导航 A 标签
            for nav_link in target_container.find_all('a', href=re.compile(r'^/news|^/sport|^/business')):
                nav_link.unwrap()
                
            extracted_markdown = convert_element_to_markdown(target_container)
            
            if len(extracted_markdown) > 250:
                logger.info(f"成功锁定 CSS 核心容器，无损斩获 100% 纯净正文: {url}")
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
                    
            text = convert_element_to_markdown(soup_node)
            if len(text) > 150:
                return text

        # 轨道三：终极防漏基础大文本行过滤
        if article.text and len(article.text) > 100:
            paragraphs = article.text.split('\n')
            cleaned_pieces = []
            for p in paragraphs:
                p_str = p.strip()
                if len(p_str) > 25 and not p_str.startswith('/') and not p_str.endswith('}'):
                    cleaned_pieces.append(f"\n\n{p_str}\n\n")
            return "".join(cleaned_pieces).strip()
            
        return ""
    except Exception as e:
        logger.error(f"提取正文出现严重未知异常: {e}, URL: {url}")
        return ""