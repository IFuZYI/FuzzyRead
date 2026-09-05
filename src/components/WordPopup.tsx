import React, { useState, useEffect, useRef } from 'react';
import { Volume2, Loader2 } from 'lucide-react';
import { DictWordDef, ReadingPreferences, AISettings } from '../types';
import { getApiUrl } from '../utils/api';

interface WordPopupProps {
  word: string;
  rect: DOMRect | null;
  preferences: ReadingPreferences;
  settings: AISettings;
  onClose: () => void;
}

const TAG_LABEL: Record<string, string> = {
  gk: '高考',
  cet4: '四级',
  cet6: '六级',
  ky: '考研',
  ielts: '雅思',
  toefl: '托福',
  gre: 'GRE',
};

const posPrefixes = ['n.', 'v.', 'vt.', 'vi.', 'adj.', 'adv.', 'prep.', 'conj.', 'pron.', 'num.', 'art.', 'pl.', 'vaux.', 'abbr.'];

const renderTranslationLines = (text: string) => {
  if (!text) return null;

  let normalized = text.replace(/\\n/g, '\n');

  posPrefixes.forEach(prefix => {
    const escapedPrefix = prefix.replace('.', '\\.');
    const regex = new RegExp(`[\\s;，,]+(?=${escapedPrefix}\\s)`, 'gi');
    normalized = normalized.replace(regex, '\n');
  });

  const lines = normalized
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  return (
    <div className="space-y-1.5" id="translation-rows-box">
      {lines.map((line, idx) => {
        let matchedPrefix = '';
        for (const prefix of posPrefixes) {
          if (line.toLowerCase().startsWith(prefix)) {
            matchedPrefix = prefix;
            break;
          }
        }

        if (matchedPrefix) {
          const posLabel = line.substring(0, matchedPrefix.length);
          const definition = line.substring(matchedPrefix.length).trim();
          return (
            <div key={idx} className="flex items-start gap-2 text-[14px] leading-[1.4]" id={`pos-row-${idx}`}>
              <span className="inline-block min-w-[30px] shrink-0 text-gray-400 select-none">
                {posLabel}
              </span>
              <span className="text-[#1d1d1f] select-all">
                {definition}
              </span>
            </div>
          );
        }

        const bracketMatch = line.match(/^(\[[^\]]+\]|【[^】]+】|\([^\)]+\))(.*)$/);
        if (bracketMatch) {
          return (
            <div key={idx} className="flex items-start gap-2 text-[14px] leading-[1.4]" id={`pos-row-bracket-${idx}`}>
              <span className="inline-block shrink-0 text-gray-400 select-none">
                {bracketMatch[1]}
              </span>
              <span className="text-[#1d1d1f] select-all">
                {bracketMatch[2].trim()}
              </span>
            </div>
          );
        }

        return (
          <div className="text-[14px] text-[#1d1d1f] leading-[1.4] select-all" key={idx} id={`pos-row-normal-${idx}`}>
            {line}
          </div>
        );
      })}
    </div>
  );
};

export default function WordPopup({ word, rect, preferences, settings, onClose }: WordPopupProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DictWordDef | null>(null);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const cleanWord = word.trim().toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');

  const getAudioUrl = () => {
    const provider = preferences.wordReadProvider || 'browser-microsoft';
    const accent = preferences.pronunciationType || 'uk';
    const typeNum = accent === 'us' ? '2' : '1';
    
    if (provider === 'azure') {
      const azureKey = settings.azureSpeechKey || '';
      const azureRegion = settings.azureSpeechRegion || '';
      return getApiUrl(`/api/tts/azure?word=${encodeURIComponent(cleanWord)}&type=${accent}&azureKey=${encodeURIComponent(azureKey)}&azureRegion=${encodeURIComponent(azureRegion)}`);
    } else if (provider === 'googlecloud') {
      const googleKey = settings.googleCloudTtsKey || '';
      return getApiUrl(`/api/tts/google-cloud?word=${encodeURIComponent(cleanWord)}&type=${accent}&googleKey=${encodeURIComponent(googleKey)}`);
    } else if (provider === 'youdao') {
      return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(cleanWord)}&type=${typeNum}`;
    } else {
      return getApiUrl(`/api/tts/google?word=${encodeURIComponent(cleanWord)}&type=${accent}`);
    }
  };

  const playAudio = () => {
    const provider = preferences.wordReadProvider || 'browser-microsoft';
    const accent = preferences.pronunciationType || 'uk';
    
    if (provider === 'browser-microsoft' || provider === 'browser-google') {
      try {
        const utterance = new SpeechSynthesisUtterance(cleanWord);
        utterance.lang = accent === 'us' ? 'en-US' : 'en-GB';

        if (window.speechSynthesis) {
          const voices = window.speechSynthesis.getVoices();
          const targetBrand = provider === 'browser-google' ? 'google' : 'microsoft';
          const match = voices.find(v => 
            v.name.toLowerCase().includes(targetBrand) && 
            v.lang.toLowerCase().startsWith(accent === 'us' ? 'en-us' : 'en-gb')
          );
          if (match) {
            utterance.voice = match;
          }
        }

        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn('Browser SpeechSynthesis error, falling back to Google free TTS:', err);
        const url = getApiUrl(`/api/tts/google?word=${encodeURIComponent(cleanWord)}&type=${accent}`);
        const audio = new Audio(url);
        audio.play().catch(e => console.log('Autoplay blocked:', e));
      }
    } else {
      const url = getAudioUrl();
      const audio = new Audio(url);
      audio.play().catch((err) => console.log('Audio autoplay blocked or failed:', err));
    }
  };

  useEffect(() => {
    if (!cleanWord) return;

    let isMounted = true;
    setLoading(true);
    setErrorStatus(null);
    setData(null);

    const lookUpWord = async () => {
      try {
        const provider = preferences.dictProvider || 'builtin';
        const pronunciation = preferences.pronunciationType || 'uk';
        const userAzureKey = settings.azureTranslatorKey || '';
        const userAzureRegion = settings.azureTranslatorRegion || '';
        const userFastapiDictUrl = settings.fastapiDictUrl || '';
        const userGoogleKey = settings.googleCloudTtsKey || '';
        
        const url = `/api/dict/lookup?word=${encodeURIComponent(cleanWord)}&provider=${provider}&pronunciation=${pronunciation}&azureKey=${encodeURIComponent(userAzureKey)}&azureRegion=${encodeURIComponent(userAzureRegion)}&googleKey=${encodeURIComponent(userGoogleKey)}&fastapiDictUrl=${encodeURIComponent(userFastapiDictUrl)}`;
        
        const response = await fetch(getApiUrl(url));
        if (!response.ok) throw new Error('Failed to retrieve definitions');
        
        const json = await response.json();
        if (isMounted) {
          setData(json);
          setLoading(false);
          if (preferences.autoplayAudio) {
            setTimeout(playAudio, 150);
          }
        }
      } catch (err: any) {
        console.error('Unified dictionary lookup error:', err);
        if (isMounted) {
          setErrorStatus('无法获取词义');
          setLoading(false);
        }
      }
    };

    lookUpWord();

    return () => {
      isMounted = false;
    };
  }, [cleanWord]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [onClose]);

  if (!rect) return null;

  const popupWidth = Math.min(320, window.innerWidth - 24);
  const topPos = rect.bottom + window.scrollY + 10;
  let leftPos = rect.left + window.scrollX + rect.width / 2 - popupWidth / 2;

  if (leftPos < 12) leftPos = 12;
  if (leftPos + popupWidth > window.innerWidth - 12) {
    leftPos = window.innerWidth - popupWidth - 12;
  }

  const renderTags = (tagStr: string) => {
    if (!tagStr) return null;
    const tokens = tagStr.split(/[\s,]+/).filter(Boolean);
    if (tokens.length === 0) return null;

    return (
      <p className="text-[12px] text-gray-500" id="tags-badge-grid">
        {tokens.map(tok => TAG_LABEL[tok.toLowerCase()] || tok.toUpperCase()).join(' · ')}
      </p>
    );
  };

  /* Apple-style popover: white card, 12px radius, one soft diffused shadow */
  return (
    <div
      ref={popupRef}
      style={{
        top: `${topPos}px`,
        left: `${leftPos}px`,
        width: `${popupWidth}px`,
      }}
      className="absolute z-40 bg-white rounded-xl shadow-xl p-5 animate-fade-in text-[#1d1d1f]"
      id="word-lookup-popup"
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-5" id="popup-loading">
          <Loader2 className="w-4 h-4 text-gray-400 animate-spin" strokeWidth={2} />
          <span className="text-[13px] text-gray-500">查询中…</span>
        </div>
      ) : errorStatus || !data ? (
        <div className="py-4 text-center" id="popup-error">
          <p className="text-[15px] font-semibold">查询失败</p>
          <p className="mt-1 text-[13px] text-gray-500">请检查网络或更换词典来源</p>
        </div>
      ) : (
        <div className="max-h-[340px] overflow-y-auto pr-1" id="dictionary-card-body">
          {/* Headword row */}
          <div className="flex items-start justify-between gap-3" id="card-main-row">
            <div className="min-w-0">
              <h4 className="text-[21px] font-semibold leading-[1.19] tracking-tight break-words" id="dict-title-word">
                {data.word}
              </h4>
              <p className="mt-0.5 text-[13px] text-gray-500" id="dict-phonetic">
                {data.phonetic ? `[${data.phonetic.replace(/[\[\]]/g, '')}]` : '/.../'}
              </p>
            </div>
            <button
              onClick={playAudio}
              className="apple-focus shrink-0 p-1.5 -mr-1 -mt-1 rounded-full text-[#0071e3] hover:bg-black/[0.04] transition-colors touch-manipulation"
              id="say-word-btn"
              title="发音"
            >
              <Volume2 className="w-[18px] h-[18px]" strokeWidth={2} />
            </button>
          </div>

          {/* Exam tags */}
          <div className="mt-1.5">{renderTags(data.tag)}</div>

          {/* Definitions */}
          <div className="mt-4" id="card-definition-box">
            {renderTranslationLines(data.translation)}
          </div>
        </div>
      )}
    </div>
  );
}
