import React from 'react';
import { ChevronRight } from 'lucide-react';
import { ArticleMeta } from '../types';

interface ArticleCardProps {
  key?: string;
  article: ArticleMeta;
  onClick: () => void;
  translatedTitle?: { text: string; loading: boolean; error?: string };
  onTranslateTitle?: () => void;
  settings?: any;
}

/**
 * Apple-style article tile: light gray surface, no border, no shadow,
 * tight type, single blue accent, quiet hover.
 */
export default function ArticleCard({ article, onClick, translatedTitle, settings }: ArticleCardProps) {
  const formatDate = (dateStr: string) => {
    if (dateStr.length === 8) {
      return `${dateStr.substring(0, 4)}/${dateStr.substring(4, 6)}/${dateStr.substring(6, 8)}`;
    }
    return dateStr;
  };

  const sourceLabel =
    article.sourceChannelNameEn ||
    (article.sourceChannel.toLowerCase().includes('bbc')
      ? 'BBC News'
      : article.sourceChannel.toLowerCase().includes('time')
        ? 'TIME'
        : 'Global');

  const zhTitle = article.titleZh || translatedTitle?.text || '';
  const engineLabel =
    settings?.engine === 'free'
      ? settings.model?.includes('Google') ? '谷歌翻译' : '微软翻译'
      : settings?.engine?.toUpperCase() || 'AI';

  return (
    <button
      onClick={onClick}
      className="apple-focus group w-full bg-[#f5f5f7] hover:bg-[#ededf0] rounded-2xl p-6 text-left flex flex-col gap-4 min-h-[196px] transition-colors duration-300"
      id={`article-card-${article.id}`}
    >
      {/* Meta line — quiet, no coloured badges */}
      <div className="flex items-center gap-2 text-[12px] text-gray-500" id="card-badge-row">
        <span className="font-semibold text-[#1d1d1f]" id={`channel-badge-${article.id}`}>
          {sourceLabel}
        </span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums" id="card-date-indicator">{formatDate(article.date)}</span>
      </div>

      {/* Bilingual titles */}
      <div className="flex-grow" id={`card-bilingual-titles-${article.id}`}>
        <h3
          className="text-[19px] sm:text-[21px] font-semibold text-[#1d1d1f] leading-[1.19] tracking-tight"
          id={`card-title-${article.id}`}
        >
          {article.title}
        </h3>
        {zhTitle ? (
          <h4
            className="mt-2 text-[14px] font-normal text-gray-600 leading-[1.35]"
            id={`card-title-zh-${article.id}`}
          >
            {zhTitle}
          </h4>
        ) : (
          <p className="mt-2 text-[12px] text-gray-400 leading-[1.35]">
            {translatedTitle?.error
              ? `标题翻译失败：${translatedTitle.error}`
              : `${engineLabel} 正在翻译标题…`}
          </p>
        )}
      </div>

      {/* CTA */}
      <span className="inline-flex items-center gap-1 text-[14px] text-[#0066cc]" id="card-cta">
        开始精读
        <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
      </span>
    </button>
  );
}
