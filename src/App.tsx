/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Compass,
  Settings,
  Languages,
  ArrowLeft,
  Loader2,
  AlertCircle,
  BookOpenCheck,
  ChevronRight,
  RefreshCw,
  Search,
  Volume2,
  Play,
  Pause
} from 'lucide-react';
import { ArticleMeta, ProcessedArticle, AISettings, ReadingPreferences } from './types';
import ArticleCard from './components/ArticleCard';
import WordPopup from './components/WordPopup';
import SettingsPanel from './components/SettingsPanel';
import ArticleImage from './components/ArticleImage';
import { getApiUrl } from './utils/api';
import { filterArticles, paginateArticles, totalPages } from './utils/articleFilters';
import { loadAISettings, loadPreferences, saveAISettings, savePreferences } from './utils/preferences';
import { AsyncTaskQueue, wait } from './utils/asyncQueue';

// Cookie Helpers for API Key persistence
function setCookie(name: string, value: string, days = 365) {
  const date = new Date();
  date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
  const expires = "; expires=" + date.toUTCString();
  document.cookie = name + "=" + (encodeURIComponent(value) || "") + expires + "; path=/; SameSite=Lax";
}

function getCookie(name: string): string {
  const nameEQ = name + "=";
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
  }
  return "";
}

function loadKeysFromCookies(): Partial<AISettings> {
  const keysToLoad = [
    'openaiKey', 'openaiBase',
    'geminiKey', 'geminiBase',
    'deepseekKey', 'deepseekBase',
    'otherKey', 'otherBase', 'otherModel',
    'azureTranslatorKey', 'azureTranslatorRegion',
    'azureSpeechKey', 'azureSpeechRegion',
    'googleCloudTtsKey', 'elevenlabsKey'
  ];
  const loaded: any = {};
  keysToLoad.forEach(key => {
    const val = getCookie(key);
    if (val !== undefined && val !== null && val !== '') {
      loaded[key] = val;
    }
  });
  return loaded;
}

function saveKeysToCookies(settings: AISettings) {
  const keysToSave = [
    'openaiKey', 'openaiBase',
    'geminiKey', 'geminiBase',
    'deepseekKey', 'deepseekBase',
    'otherKey', 'otherBase', 'otherModel',
    'azureTranslatorKey', 'azureTranslatorRegion',
    'azureSpeechKey', 'azureSpeechRegion',
    'googleCloudTtsKey', 'elevenlabsKey'
  ];
  keysToSave.forEach(key => {
    const val = (settings as any)[key] || '';
    setCookie(key, val);
  });
}

const INITIAL_SETTING: AISettings = {
  engine: 'free',
  model: 'Microsoft Translate Free',
  apiKey: '',
  baseUrl: '',
  openaiKey: '',
  openaiBase: 'https://api.openai.com/v1',
  geminiKey: '',
  geminiBase: 'https://generativelanguage.googleapis.com/v1beta/openai',
  deepseekKey: '',
  deepseekBase: 'https://api.deepseek.com',
  azureTranslatorKey: '',
  azureTranslatorRegion: 'global',
  azureSpeechKey: '',
  azureSpeechRegion: 'eastasia',
  googleCloudTtsKey: '',
  fastapiDictUrl: 'https://dictapi.fuzy.site',
  elevenlabsKey: '',
};

const INITIAL_PREFERENCE: ReadingPreferences = {
  fontSize: 'lg',
  fontFamily: 'times',
  autoplayAudio: true,
  dictProvider: 'builtin',
  pronunciationType: 'uk',
  ttsProvider: 'browser',
  wordReadProvider: 'browser-microsoft',
  paragraphTtsEngine: 'browser',
  paragraphSpeechBrowserBrand: 'microsoft',
  paragraphSpeechUseCloud: false,
  openaiTtsVoice: 'alloy',
  openaiTtsModel: 'tts-1',
  elevenlabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
  voiceGender: 'female',
};

function normalizeTitleTranslation(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let text = raw.trim();
  // Remove model wrappers such as :::writing{...} ... ::: and Markdown fences.
  text = text.replace(/^\s*:::writing\{[^}]*\}\s*/i, '');
  text = text.replace(/\s*:::[\s\S]*$/i, '').trim();
  text = text.replace(/^```(?:markdown|text)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // A title translation should be one title, not an explanation or a generated
  // document. Keep the first non-empty line if the model added commentary.
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length > 1) {
    const first = lines[0].replace(/^(标题翻译|译文|Translation)\s*[:：]\s*/i, '').trim();
    if (/^(为什么|what|the|a |an |“|"|'|[A-Z\u4e00-\u9fff])/.test(first)) text = first;
  }
  return text.replace(/^标题翻译\s*[:：]\s*/i, '').replace(/^\*\*(.*?)\*\*$/, '$1').trim();
}

const renderTextWithBold = (text: string) => {
  if (!text) return null;
  // Clean up potential whitespace surrounding bold content inserted by translation engines
  const sanitized = text.replace(/\*\*\s*(.*?)\s*\*\*/g, '**$1**');
  const parts = sanitized.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={idx} className="font-semibold text-[#1d1d1f]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={idx}>{part}</span>;
  });
};

export default function App() {
  const [articles, setArticles] = useState<ArticleMeta[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(true);
  
  // Navigation
  const [currentChannel, setCurrentChannel] = useState<string>('home');
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [activeArticle, setActiveArticle] = useState<ProcessedArticle | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Dynamic channel tabs discovery from available articles list
  const uniqueChannels = useMemo(() => {
    const channelsMap = new Map<string, { key: string; label: string }>();
    articles.forEach(a => {
      if (a.sourceChannel && !channelsMap.has(a.sourceChannel)) {
        channelsMap.set(a.sourceChannel, {
          key: a.sourceChannel,
          label: a.sourceChannelNameZh || a.sourceChannel
        });
      }
    });
    return Array.from(channelsMap.values());
  }, [articles]);

  const tabsList = useMemo(() => {
    return [
      { key: 'all', label: '全部期刊' },
      ...uniqueChannels
    ];
  }, [uniqueChannels]);

  // Settings & Preferences
  const [settings, setSettings] = useState<AISettings>(() => {
    try {
      const cookieKeys = loadKeysFromCookies();
      return loadAISettings(INITIAL_SETTING, cookieKeys);
    } catch {
      return INITIAL_SETTING;
    }
  });

  const [preferences, setPreferences] = useState<ReadingPreferences>(() => {
    try {
      return loadPreferences(INITIAL_PREFERENCE);
    } catch {
      return INITIAL_PREFERENCE;
    }
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Allowances state loaded from server configuration
  const [allowances, setAllowances] = useState({
    allowBuiltinDict: true,
    allowBuiltinWordTts: true,
    allowBuiltinParagraphTranslation: false,
    allowBuiltinParagraphTts: false
  });

  useEffect(() => {
    fetch(getApiUrl('/api/config'))
      .then(res => res.json())
      .then(data => {
        if (data) {
          setAllowances({
            allowBuiltinDict: data.allowBuiltinDict !== false,
            allowBuiltinWordTts: data.allowBuiltinWordTts !== false,
            allowBuiltinParagraphTranslation: data.allowBuiltinParagraphTranslation === true,
            allowBuiltinParagraphTts: data.allowBuiltinParagraphTts === true
          });
        }
      })
      .catch(err => console.warn("Failed to fetch allowances, using defaults:", err));
  }, []);

  // Active word selection coordinates
  const [activeWordInfo, setActiveWordInfo] = useState<{ word: string; rect: DOMRect } | null>(null);

  // Paragraph translations map: paragraphId -> translation text
  const [translatedParagraphs, setTranslatedParagraphs] = useState<Record<string, { text: string; loading: boolean; error?: string }>>({});

  // Title translations map: articleId -> translation text status
  const [translatedTitles, setTranslatedTitles] = useState<Record<string, { text: string; loading: boolean; error?: string }>>({});
  const titleTranslationQueueRef = useRef(new AsyncTaskQueue(2));
  const titleTranslationCacheRef = useRef(new Map<string, string>());
  
  // Concurrent full-text translation active progress
  const [bulkTranslating, setBulkTranslating] = useState(false);

  // Audio Speech Synthesis / Playback States
  const [activeSpeechId, setActiveSpeechId] = useState<string | null>(null); // paragraph id being spoken right now
  const [speechAudioRef, setSpeechAudioRef] = useState<HTMLAudioElement | null>(null);
  const [isPlayingFullText, setIsPlayingFullText] = useState(false);
  const [isSpeechPaused, setIsSpeechPaused] = useState(false);
  const [paragraphSpeechErrors, setParagraphSpeechErrors] = useState<Record<string, string>>({});

  const isPlayingFullTextRef = useRef(false);
  const nextIndexRef = useRef(0);

  // Auto stop voice playing on article change or reader close
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    if (!selectedArticleId) {
      isPlayingFullTextRef.current = false;
      setIsPlayingFullText(false);
      setIsSpeechPaused(false);
      setActiveSpeechId(null);
      if (speechAudioRef) {
        try {
          speechAudioRef.pause();
        } catch(e){}
        setSpeechAudioRef(null);
      }
      window.speechSynthesis.cancel();
    }
  }, [selectedArticleId]);

  const playParagraphTTS = useCallback((paragraphId: string, text: string, advanceCallback?: () => void) => {
    if (speechAudioRef) {
      try {
        speechAudioRef.pause();
      } catch(e){}
      setSpeechAudioRef(null);
    }
    window.speechSynthesis.cancel();
    
    // Reset previous errors for this paragraph
    setParagraphSpeechErrors(prev => {
      const copy = { ...prev };
      delete copy[paragraphId];
      return copy;
    });

    setActiveSpeechId(paragraphId);
    setIsSpeechPaused(false);
    
    const provider = preferences.paragraphTtsEngine || 'browser';
    const accent = preferences.pronunciationType || 'uk';
    
    // Check if it's an image
    const isImage = text.match(/^!\[(.*?)\]\((.*?)\)$/) || text.match(/^<img\s[^>]*?>$/i);
    if (isImage) {
      if (advanceCallback) advanceCallback();
      return;
    }
    
    // Remove all asterisks to prevent reading out "word star/asterisk"
    const cleanText = text.replace(/<[^>]*>/g, '').replace(/\*/g, '').trim();
    if (!cleanText) {
      if (advanceCallback) advanceCallback();
      return;
    }

    // Determine target active engine
    let activeEngine = provider;
    if (provider === 'browser') {
      activeEngine = preferences.paragraphTtsOtherEngine || 'youdao';
    }

    if (activeEngine === 'youdao' || activeEngine === 'google') {
      // Local Built-in Web Speech Synthesis
      try {
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = accent === 'us' ? 'en-US' : 'en-GB';
        
        if (window.speechSynthesis) {
          const voices = window.speechSynthesis.getVoices();
          const selectedVoiceName = preferences.paragraphTtsVoice;
          let match = selectedVoiceName ? voices.find(v => v.name === selectedVoiceName) : null;
          
          if (!match) {
            // Auto match by brand list & accent prefix
            const targetBrandName = activeEngine === 'google' ? 'google' : 'microsoft';
            match = voices.find(v => 
              v.name.toLowerCase().includes(targetBrandName) && 
              v.lang.toLowerCase().startsWith(accent === 'us' ? 'en-us' : 'en-gb')
            );
          }
          if (match) utterance.voice = match;
        }

        utterance.onend = () => {
          setActiveSpeechId(null);
          if (advanceCallback) advanceCallback();
        };
        utterance.onerror = (e) => {
          console.error('Browser SpeechSynthesis error:', e);
          setActiveSpeechId(null);
          setParagraphSpeechErrors(prev => ({
            ...prev,
            [paragraphId]: `本地声音播放错误: ${e.error || 'SpeechSynthesisUtterance failed'}`
          }));
        };
        
        window.speechSynthesis.speak(utterance);
      } catch (err: any) {
        console.error('Local speech error:', err);
        setActiveSpeechId(null);
        setParagraphSpeechErrors(prev => ({
          ...prev,
          [paragraphId]: `本地朗读启动失败: ${err?.message || err}`
        }));
      }
    } else {
      // Cloud Speech Engine
      let url = '';
      if (activeEngine === 'azure') {
        const userAzureKey = settings.azureSpeechKey || '';
        const userAzureRegion = settings.azureSpeechRegion || '';
        const voice = preferences.paragraphTtsVoice || '';
        url = getApiUrl(`/api/tts/azure?word=${encodeURIComponent(cleanText)}&type=${accent}&azureKey=${encodeURIComponent(userAzureKey)}&azureRegion=${encodeURIComponent(userAzureRegion)}&isParagraph=true&voice=${encodeURIComponent(voice)}`);
      } else if (activeEngine === 'googlecloud') {
        const googleKey = settings.googleCloudTtsKey || '';
        const voice = preferences.paragraphTtsVoice || '';
        url = getApiUrl(`/api/tts/google-cloud?word=${encodeURIComponent(cleanText)}&type=${accent}&googleKey=${encodeURIComponent(googleKey)}&isParagraph=true&voice=${encodeURIComponent(voice)}`);
      } else if (activeEngine === 'openai') {
        const voice = preferences.paragraphTtsVoice || preferences.openaiTtsVoice || 'alloy';
        const model = preferences.openaiTtsModel || 'tts-1';
        const apiKey = settings.openaiKey || '';
        const apiBase = settings.openaiBase || '';
        url = getApiUrl(`/api/tts/openai?word=${encodeURIComponent(cleanText)}&voice=${encodeURIComponent(voice)}&model=${encodeURIComponent(model)}&openAIKey=${encodeURIComponent(apiKey)}&openAIBase=${encodeURIComponent(apiBase)}&isParagraph=true`);
      } else if (activeEngine === 'elevenlabs') {
        const voiceId = preferences.paragraphTtsVoice || preferences.elevenlabsVoiceId || '';
        const apiKey = settings.elevenlabsKey || '';
        url = getApiUrl(`/api/tts/elevenlabs?word=${encodeURIComponent(cleanText)}&voiceId=${encodeURIComponent(voiceId)}&elevenlabsKey=${encodeURIComponent(apiKey)}&isParagraph=true`);
      }

      if (!url) {
        setActiveSpeechId(null);
        setParagraphSpeechErrors(prev => ({
          ...prev,
          [paragraphId]: '未知的发音引擎或配置错误'
        }));
        return;
      }

      const audioInstance = new Audio(url);
      setSpeechAudioRef(audioInstance);
      
      audioInstance.onended = () => {
        setActiveSpeechId(null);
        if (advanceCallback) advanceCallback();
      };
      
      audioInstance.onerror = async (err) => {
        console.error('Cloud TTS Audio error, getting exact cause...:', err);
        try {
          const res = await fetch(url);
          if (!res.ok) {
            const data = await res.json();
            setParagraphSpeechErrors(prev => ({
              ...prev,
              [paragraphId]: data.error || `服务状态码 ${res.status}: 加载失败`
            }));
          } else {
            setParagraphSpeechErrors(prev => ({
              ...prev,
              [paragraphId]: '获取音频流失败或密钥无效'
            }));
          }
        } catch (fetchErr) {
          setParagraphSpeechErrors(prev => ({
            ...prev,
            [paragraphId]: '网络连接失败，请检查相关秘钥或代理端点配置'
          }));
        }
        setActiveSpeechId(null);
      };
      
      audioInstance.play().catch(async (e) => {
        console.warn('Playback block/failure, fetching error details...:', e);
        try {
          const res = await fetch(url);
          if (!res.ok) {
            const data = await res.json();
            setParagraphSpeechErrors(prev => ({
              ...prev,
              [paragraphId]: data.error || `播放被阻挡或秘钥配置有误`
            }));
          } else {
            setParagraphSpeechErrors(prev => ({
              ...prev,
              [paragraphId]: '浏览器音频播放受阻，请点击重试'
            }));
          }
        } catch (fetchErr) {
          setParagraphSpeechErrors(prev => ({
            ...prev,
            [paragraphId]: '由于网络连接或秘钥校验问题，音频无法播放'
          }));
        }
        setActiveSpeechId(null);
      });
    }
  }, [preferences, settings, speechAudioRef]);

  const stopSpeech = useCallback(() => {
    isPlayingFullTextRef.current = false;
    if (speechAudioRef) {
      try {
        speechAudioRef.pause();
      } catch(e){}
    }
    setSpeechAudioRef(null);
    window.speechSynthesis.cancel();
    setActiveSpeechId(null);
    setIsPlayingFullText(false);
    setIsSpeechPaused(false);
  }, [speechAudioRef]);

  const pauseSpeech = useCallback(() => {
    const provider = preferences.paragraphTtsEngine || 'browser';
    const useCloud = preferences.paragraphSpeechUseCloud || false;
    if (provider === 'browser' && !useCloud) {
      window.speechSynthesis.pause();
    } else if (speechAudioRef) {
      try {
        speechAudioRef.pause();
      } catch(e){}
    }
    setIsSpeechPaused(true);
  }, [preferences.paragraphTtsEngine, preferences.paragraphSpeechUseCloud, speechAudioRef]);

  const resumeSpeech = useCallback(() => {
    const provider = preferences.paragraphTtsEngine || 'browser';
    const useCloud = preferences.paragraphSpeechUseCloud || false;
    if (provider === 'browser' && !useCloud) {
      window.speechSynthesis.resume();
    } else if (speechAudioRef) {
      speechAudioRef.play().catch(() => {});
    }
    setIsSpeechPaused(false);
  }, [preferences.paragraphTtsEngine, preferences.paragraphSpeechUseCloud, speechAudioRef]);

  const startFullTextTTS = () => {
    if (!activeArticle || activeArticle.paragraphs.length === 0) return;
    
    isPlayingFullTextRef.current = true;
    setIsPlayingFullText(true);
    setIsSpeechPaused(false);
    
    const speakNext = (index: number) => {
      if (!isPlayingFullTextRef.current) return;
      if (index >= activeArticle.paragraphs.length) {
        stopSpeech();
        return;
      }
      
      const p = activeArticle.paragraphs[index];
      const isImg = p.text.match(/^!\[(.*?)\]\((.*?)\)$/) || p.text.match(/^<img\s[^>]*?>$/i);
      if (isImg || !p.text.trim()) {
        speakNext(index + 1);
        return;
      }
      
      const element = document.getElementById(`paragraph-container-${p.id}`) || document.getElementById(`heading-container-${p.id}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      
      nextIndexRef.current = index + 1;
      playParagraphTTS(p.id, p.text, () => {
        if (isPlayingFullTextRef.current) {
          speakNext(nextIndexRef.current);
        }
      });
    };
    
    speakNext(0);
  };

  // Filter Date states
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [quickDateRange, setQuickDateRange] = useState<'all' | '10days' | 'june'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Trigger LocalStorage & Cookie Persistence
  useEffect(() => {
    saveAISettings(settings);
    saveKeysToCookies(settings);
  }, [settings]);

  useEffect(() => {
    savePreferences(preferences);
  }, [preferences]);

  // Load articles from Express scanned backend
  useEffect(() => {
    fetch(getApiUrl('/api/articles'))
      .then(res => res.json())
      .then(data => {
        setArticles(data);
        setLoadingArticles(false);
      })
      .catch(err => {
        console.error("Failed to load articles from Express API:", err);
        setLoadingArticles(false);
      });
  }, []);

  // Hydrate detailed article structure
  useEffect(() => {
    if (!selectedArticleId) {
      setActiveArticle(null);
      setTranslatedParagraphs({});
      setDetailError(null);
      return;
    }

    let isMounted = true;
    setLoadingDetail(true);
    setDetailError(null);

    fetch(getApiUrl(`/api/articles/${selectedArticleId}`))
      .then(res => {
        if (!res.ok) {
          throw new Error(`服务器响应失败 (${res.status})`);
        }
        return res.json();
      })
      .then(data => {
        if (isMounted) {
          setActiveArticle(data);
          setLoadingDetail(false);
        }
      })
      .catch(err => {
        if (isMounted) {
          console.error(`Failed to load article detail for ${selectedArticleId}:`, err);
          setDetailError(err.message || '网络连接或资源解析失败');
          setLoadingDetail(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [selectedArticleId]);

  // Word tap listener to automatically dismiss word popups
  const handleWordClick = (word: string, e: React.MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setActiveWordInfo({ word, rect });
  };

  // Run single paragraph translation
  const translateParagraph = async (pId: string, pText: string) => {
    setTranslatedParagraphs(prev => ({
      ...prev,
      [pId]: { text: '', loading: true }
    }));

    let activeKey = settings.apiKey;
    let activeBase = settings.baseUrl;
    if (settings.engine === 'openai') {
      activeKey = settings.openaiKey || settings.apiKey;
      activeBase = settings.openaiBase || settings.baseUrl;
    } else if (settings.engine === 'gemini') {
      activeKey = settings.geminiKey || settings.apiKey;
      activeBase = settings.geminiBase || settings.baseUrl;
    } else if (settings.engine === 'deepseek') {
      activeKey = settings.deepseekKey || settings.apiKey;
      activeBase = settings.deepseekBase || settings.baseUrl;
    }

    try {
      const response = await fetch(getApiUrl('/api/translate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: pText,
          engine: settings.engine,
          model: settings.model,
          apiKey: activeKey,
          baseUrl: activeBase
        })
      });

      if (!response.ok) {
        const errJSON = await response.json();
        throw new Error(errJSON.error || 'Translation network error');
      }

      const resData = await response.json();
      setTranslatedParagraphs(prev => ({
        ...prev,
        [pId]: { text: resData.translation, loading: false }
      }));
    } catch (err: any) {
      setTranslatedParagraphs(prev => ({
        ...prev,
        [pId]: { text: '', loading: false, error: err.message || '翻译失败，请检查设置' }
      }));
    }
  };

  // Run single title translation
  const translateTitle = async (articleId: string, titleText: string) => {
    if (!titleText.trim()) return;
    setTranslatedTitles(prev => ({
      ...prev,
      [articleId]: { text: '', loading: true }
    }));

    let activeKey = settings.apiKey;
    let activeBase = settings.baseUrl;
    if (settings.engine === 'openai') {
      activeKey = settings.openaiKey || settings.apiKey;
      activeBase = settings.openaiBase || settings.baseUrl;
    } else if (settings.engine === 'gemini') {
      activeKey = settings.geminiKey || settings.apiKey;
      activeBase = settings.geminiBase || settings.baseUrl;
    } else if (settings.engine === 'deepseek') {
      activeKey = settings.deepseekKey || settings.apiKey;
      activeBase = settings.deepseekBase || settings.baseUrl;
    }

    try {
      const cacheKey = `${settings.engine}:${settings.model}:${titleText.trim()}`;
      const cached = titleTranslationCacheRef.current.get(cacheKey);
      if (cached) {
        setTranslatedTitles(prev => ({ ...prev, [articleId]: { text: cached, loading: false } }));
        return;
      }
      await titleTranslationQueueRef.current.add(async () => {
        let response: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          response = await fetch(getApiUrl('/api/translate'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: titleText,
              engine: settings.engine,
              model: settings.model,
              apiKey: activeKey,
              baseUrl: activeBase,
              purpose: 'title',
            })
          });
          if (response.status !== 429 && response.status !== 502 && response.status !== 503) break;
          if (attempt < 2) await wait(600 * (attempt + 1));
        }

        if (!response) throw new Error('翻译请求未建立');
        if (!response.ok) {
          const errJSON = await response.json();
          const error = new Error(errJSON.error || 'Translation network error') as Error & { status?: number };
          error.status = response.status;
          throw error;
        }

        const resData = await response.json();
        const translation = normalizeTitleTranslation(resData.translation);
        if (!translation) throw new Error('上游返回了空标题翻译');
        titleTranslationCacheRef.current.set(cacheKey, translation);
        setTranslatedTitles(prev => ({
          ...prev,
          [articleId]: { text: translation, loading: false }
        }));
      });
    } catch (err: any) {
      setTranslatedTitles(prev => ({
        ...prev,
        [articleId]: { text: '', loading: false, error: err.message || '翻译失败' }
      }));
    }
  };

  // Reset/Clear translated titles when settings engine/model changes
  useEffect(() => {
    setTranslatedTitles({});
  }, [settings.engine, settings.model, settings.apiKey, settings.openaiKey, settings.geminiKey, settings.deepseekKey]);

  // Run bulk text dual translation concurrently
  const translateAllParagraphs = async () => {
    if (!activeArticle) return;
    if (!settings.apiKey || settings.engine === 'free') {
      alert("全篇对照翻译由于文本篇幅长、排版格式复杂，需要调用学术级大语言模型进行本页内格式合并，请点击右上角「设置」配置您个人的 AI API 密钥。单段翻译已完美支持调用您当前使用的浏览器或系统之自带翻译器。");
      return;
    }
    setBulkTranslating(true);

    const promises = activeArticle.paragraphs.map(async (p) => {
      // Avoid translating header captions or existing translations
      if (p.isCaption || (translatedParagraphs[p.id] && translatedParagraphs[p.id].text)) {
        return;
      }
      return translateParagraph(p.id, p.text);
    });

    await Promise.all(promises);
    setBulkTranslating(false);
  };

  // Word formatting parser inside paragraphs
  const renderInteractiveText = (text: string) => {
    // Splits by `**bold**` blocks to support markdown bold text
    const parts = text.split(/(\*\*.*?\*\*)/g);

    return parts.map((part, partIdx) => {
      const isBold = part.startsWith('**') && part.endsWith('**');
      const innerText = isBold ? part.slice(2, -2) : part;

      // Splits by alphanumeric blocks to grab real words for span tokenizing
      const tokens = innerText.split(/([a-zA-Z]+(?:'[a-zA-Z]+)?)/g);

      const renderedTokens = tokens.map((tok, idx) => {
        const isWord = /[a-zA-Z]/.test(tok);
        if (isWord) {
          // Highlighting tapped word
          const isActive = activeWordInfo?.word.toLowerCase() === tok.toLowerCase();
          return (
            <span
              key={`${partIdx}-${idx}`}
              onClick={(e) => handleWordClick(tok, e)}
              className={`dict-word select-none ${isActive ? 'active-word' : ''}`}
              id={`word-${tok}-${partIdx}-${idx}`}
            >
              {tok}
            </span>
          );
        } else {
          return <span key={`${partIdx}-${idx}`}>{tok}</span>;
        }
      });

      if (isBold) {
        return (
          <strong key={partIdx} className="font-bold text-gray-900 border-b border-dashed border-[#0071e3]/30">
            {renderedTokens}
          </strong>
        );
      } else {
        return <span key={partIdx}>{renderedTokens}</span>;
      }
    });
  };

  const filteredArticlesList = useMemo(() => filterArticles({
    articles,
    channel: currentChannel,
    quickRange: quickDateRange,
    startDate,
    endDate,
    query: searchQuery,
    translatedTitles,
  }), [articles, currentChannel, quickDateRange, startDate, endDate, searchQuery, translatedTitles]);

  // Reset pagination to page 1 when filter parameters change
  useEffect(() => {
    setCurrentPage(1);
  }, [currentChannel, quickDateRange, startDate, endDate, searchQuery]);

  const totalPagesCount = totalPages(filteredArticlesList.length, 10);

  // Make sure currentPage stays within bounds
  useEffect(() => {
    if (currentPage > totalPagesCount) {
      setCurrentPage(totalPagesCount);
    }
  }, [currentPage, totalPagesCount]);

  const paginatedArticlesList = useMemo(() => paginateArticles(filteredArticlesList, currentPage, 10), [filteredArticlesList, currentPage]);

  // Automatically translate any article titles that don't have a pre-translated titleZh inside the paginated current page list
  useEffect(() => {
    if (loadingArticles) return;

    const toTranslate = paginatedArticlesList.filter(art => !art.titleZh);

    toTranslate.forEach(art => {
      // Only translate if we don't have a record yet
      if (!translatedTitles[art.id]) {
        translateTitle(art.id, art.title);
      }
    });
  }, [paginatedArticlesList, loadingArticles, translatedTitles]);

  const handlePreferencesChange = (newPrefs: ReadingPreferences) => {
    setPreferences(newPrefs);
  };

  const handleSettingsChange = (newSettings: AISettings) => {
    setSettings(newSettings);
  };

  // Get font styling class dynamically
  const getFontSizeClass = () => {
    switch (preferences.fontSize) {
      case 'sm': return 'text-sm leading-relaxed';
      case 'base': return 'text-base leading-relaxed';
      case 'lg': return 'text-lg leading-loose';
      case 'xl': return 'text-xl leading-loose';
      case '2xl': return 'text-2xl leading-loose';
      default: return 'text-lg leading-loose';
    }
  };

  // Get font family class dynamically
  const getFontFamilyClass = () => {
    switch (preferences.fontFamily || 'times') {
      case 'times': return 'font-times';
      case 'calibri': return 'font-calibri';
      case 'inter': return 'font-inter';
      default: return 'font-times';
    }
  };

  return (
    <div className="min-h-screen bg-cream flex flex-col justify-between selection:bg-selection selection:text-gray-900" id="main-applet-root">
      
      {/* 5. Apple-style glass navigation bar */}
      <header className="apple-nav sticky top-0 z-30 h-12 px-4 sm:px-6" id="app-global-header">
        <div className="max-w-[980px] mx-auto h-full flex items-center justify-between" id="header-container">
          {/* Logo & title */}
          <div
            className="flex items-center gap-2 cursor-pointer transition-opacity hover:opacity-70 active:opacity-60"
            onClick={() => {
              setSelectedArticleId(null);
              setCurrentChannel('home');
            }}
            id="brand-logo-combo"
          >
            <Compass className="w-[18px] h-[18px] text-[#1d1d1f]" strokeWidth={1.75} />
            <span className="text-[15px] font-semibold text-[#1d1d1f] tracking-tight">
              FuzyRead
            </span>
            <span className="hidden md:inline text-[12px] text-gray-400 font-normal ml-1">
              Bilingual Reading
            </span>
          </div>

          {/* Controls right */}
          <div className="flex items-center gap-1" id="header-controls">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="apple-focus flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-normal text-[#1d1d1f] hover:bg-black/[0.04] active:bg-black/[0.07] transition-colors touch-manipulation"
              id="header-settings-trigger"
              title="设置偏好"
            >
              <Settings className="w-[15px] h-[15px]" strokeWidth={1.75} />
              <span>设置</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container viewport */}
      <main className="flex-grow w-full max-w-[980px] mx-auto px-4 sm:px-6" id="article-viewports-container">
        
        {/* VIEW 1: Apple-style hero + product grid home */}
        {currentChannel === 'home' && !selectedArticleId && (
          <div className="animate-fade-in" id="home-view-panel">
            {/* Hero — cinematic, centred, generous whitespace */}
            <section className="text-center pt-16 pb-14 sm:pt-24 sm:pb-20" id="home-hero-block">
              <h2 className="apple-display text-[40px] sm:text-[56px] text-[#1d1d1f] max-w-3xl mx-auto">
                随时随地，点词即查。
              </h2>
              <p className="mt-4 text-[19px] sm:text-[21px] font-normal text-[#1d1d1f] leading-[1.19] max-w-2xl mx-auto">
                双语段落智能翻译，为深度精读而生。
              </p>
              <p className="mt-3 text-[15px] text-gray-500 leading-[1.47] max-w-xl mx-auto">
                Read anytime. Tap to look up words and translate paragraphs intelligently.
              </p>
              <div className="mt-7 flex items-center justify-center gap-6 text-[15px]">
                <button
                  onClick={() => setCurrentChannel('all')}
                  className="apple-focus apple-pill bg-[#0071e3] hover:bg-[#0077ed] text-white px-5 py-2 font-normal transition-colors"
                >
                  浏览全部文章
                </button>
                <button
                  onClick={() => setIsSettingsOpen(true)}
                  className="apple-focus text-[#0066cc] hover:underline font-normal"
                >
                  设置阅读偏好 &rsaquo;
                </button>
              </div>
            </section>

            {/* Channel tiles — alternating light/dark, product-as-hero framing */}
            <section className="grid grid-cols-1 md:grid-cols-2 gap-5 pb-6" id="magazine-brands-grid">
              {uniqueChannels.map((channel) => {
                const isBBC = channel.key.toLowerCase().includes('bbc');
                const count = articles.filter(a => a.sourceChannel === channel.key).length;

                const surface = isBBC
                  ? 'bg-black text-white'
                  : 'bg-[#f5f5f7] text-[#1d1d1f]';
                const desc = isBBC
                  ? '科技突破、地缘政局、气候变化与人文科学。纯正英音学术语料，深度思辨与严谨修辞。'
                  : '时代高阶叙事长文特稿。句式精深典雅，掌握地道的高级句法与说理逻辑。';
                const heading = isBBC ? 'BBC News' : 'TIME';

                return (
                  <button
                    key={channel.key}
                    onClick={() => setCurrentChannel(channel.key)}
                    className={`apple-focus group relative overflow-hidden rounded-2xl px-8 py-10 sm:py-12 text-left flex flex-col justify-between min-h-[300px] transition-transform duration-500 hover:scale-[1.006] ${surface}`}
                    id={`brand-card-${channel.key}`}
                  >
                    <div>
                      <p className={`text-[12px] font-normal tracking-tight ${isBBC ? 'text-white/55' : 'text-gray-500'}`}>
                        {channel.label} · {count} 篇
                      </p>
                      <h3 className="mt-2 text-[32px] sm:text-[40px] font-semibold leading-[1.1] tracking-tight">
                        {heading}
                      </h3>
                    </div>
                    <p className={`mt-6 text-[15px] leading-[1.47] max-w-sm ${isBBC ? 'text-white/70' : 'text-gray-600'}`}>
                      {desc}
                    </p>
                    <span className={`mt-7 inline-flex items-center gap-1 text-[15px] font-normal ${isBBC ? 'text-[#2997ff]' : 'text-[#0066cc]'}`}>
                      进入专区
                      <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
                    </span>
                  </button>
                );
              })}
            </section>

            {/* Full-catalogue row */}
            <section className="pb-16 sm:pb-24" id="home-bento-footer">
              <button
                onClick={() => setCurrentChannel('all')}
                className="apple-focus group w-full bg-[#f5f5f7] rounded-2xl px-8 py-7 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left transition-colors hover:bg-[#ededf0]"
                id="explore-all-bento"
              >
                <div className="flex items-center gap-4">
                  <BookOpenCheck className="w-6 h-6 text-[#1d1d1f]" strokeWidth={1.5} />
                  <div>
                    <h4 className="text-[17px] font-semibold text-[#1d1d1f] leading-[1.24]">跨期刊探索全部文章</h4>
                    <p className="mt-1 text-[14px] text-gray-500 leading-[1.29]">一页汇总全部译文，支持按日期与关键词筛选</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-[15px] text-[#0066cc] shrink-0">
                  查看目录
                  <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
                </span>
              </button>
            </section>
          </div>
        )}

        {/* VIEW 2: Catalog Index with Date Limit Filters */}
        {currentChannel !== 'home' && !selectedArticleId && (
          <div className="space-y-6 animate-fade-in" id="catalog-view-panel">
            
            {/* Breadcrumb row */}
            <div className="flex items-center justify-between pt-8" id="breadcrumb-section">
              <button
                onClick={() => setCurrentChannel('home')}
                className="apple-focus flex items-center gap-1 text-[14px] text-[#0066cc] hover:underline"
                id="back-to-home-link"
              >
                <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} />
                <span>期刊大厅</span>
              </button>
              <div className="text-[12px] text-gray-500" id="catalog-location-tag">
                {(() => {
                  if (currentChannel === 'all') return '全部文章';
                  let mappedChannel = currentChannel;
                  if (mappedChannel === 'bbc_news') mappedChannel = 'bbc_english_top_articles';
                  else if (mappedChannel === 'time_english_top') mappedChannel = 'time_english_top_articles';
                  const match = articles.find(a => a.sourceChannel === mappedChannel);
                  return match?.sourceChannelNameZh || '精品周刊';
                })()}
              </div>
            </div>

            {/* Filters — flat light-gray panel, no border, no shadow */}
            <div className="bg-[#f5f5f7] rounded-2xl p-5 sm:p-6 space-y-5" id="catalog-filter-card">
              
              {/* Channel switcher tabs */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3" id="filter-tabs-row">
                <div className="flex items-center gap-1 flex-wrap" id="magazine-tabs">
                  {tabsList.map((tab) => {
                    const isActive = currentChannel === tab.key || 
                      (currentChannel === 'bbc_news' && tab.key === 'bbc_english_top_articles') ||
                      (currentChannel === 'time_english_top' && tab.key === 'time_english_top_articles');
                    return (
                      <button
                        key={tab.key}
                        onClick={() => setCurrentChannel(tab.key)}
                        className={`apple-focus apple-pill px-4 py-1.5 text-[12px] transition-colors ${
                          isActive 
                            ? 'bg-[#0071e3] text-white' 
                            : 'bg-white text-gray-600 hover:bg-[#ededf0]'
                        }`}
                        id={`tab-select-${tab.key}`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
                <div className="text-[12px] text-gray-500 tabular-nums" id="stats-indicator">
                  {filteredArticlesList.length} 篇
                </div>
              </div>

              {/* Keyword Search Input Bar */}
              <div className="relative" id="search-input-wrapper">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Search className="h-4 w-4 text-gray-400" strokeWidth={2} />
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索标题、译名、日期或关键词"
                  className="apple-focus block w-full pl-10 pr-16 py-2.5 text-[14px] rounded-xl bg-white text-[#1d1d1f] placeholder-gray-400 outline-none transition-colors"
                  id="catalog-search-input"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="apple-focus absolute inset-y-0 right-0 pr-4 flex items-center text-[12px] text-[#0066cc] hover:underline"
                    id="clear-search-btn"
                  >
                    清空
                  </button>
                )}
              </div>

              {/* Responsive Date Filter Range controls */}
              <div className="space-y-3" id="filters-date-grid">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3" id="dates-selection-box">
                  {/* Quick Filters Options */}
                  <div className="sm:col-span-5 flex flex-wrap gap-1.5" id="quick-ranges-grid">
                    {[
                      { key: 'all', label: '全部' },
                      { key: '10days', label: '近 10 天' },
                      { key: 'june', label: '2026 年 6 月' }
                    ].map((btn) => {
                      const isActive = quickDateRange === btn.key;
                      return (
                        <button
                          key={btn.key}
                          onClick={() => {
                            setQuickDateRange(btn.key as any);
                            setStartDate('');
                            setEndDate('');
                          }}
                          className={`apple-focus apple-pill px-3.5 py-1.5 text-[12px] transition-colors ${
                            isActive
                              ? 'bg-[#1d1d1f] text-white'
                              : 'bg-white text-gray-600 hover:bg-[#ededf0]'
                          }`}
                          id={`quick-date-range-${btn.key}`}
                        >
                          {btn.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Manual Calendar Date Inputs */}
                  <div className="sm:col-span-7 flex items-center gap-2" id="calendar-inputs-box">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value);
                        setQuickDateRange('all');
                      }}
                      className="apple-focus w-full text-[12px] rounded-lg px-3 py-2 bg-white text-gray-600 outline-none tabular-nums"
                      id="date-filter-start"
                      placeholder="开始日期"
                    />
                    <span className="text-gray-400 text-[12px] shrink-0">至</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => {
                        setEndDate(e.target.value);
                        setQuickDateRange('all');
                      }}
                      className="apple-focus w-full text-[12px] rounded-lg px-3 py-2 bg-white text-gray-600 outline-none tabular-nums"
                      id="date-filter-end"
                      placeholder="结束日期"
                    />
                    {(startDate || endDate) && (
                      <button
                        onClick={() => {
                          setStartDate('');
                          setEndDate('');
                        }}
                        className="apple-focus shrink-0 px-2 text-[12px] text-[#0066cc] hover:underline"
                        id="clear-calendars-btn"
                        title="清空日期筛选"
                      >
                        重置
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Articles catalog items list Grid (Touch friendly cards) */}
            {loadingArticles ? (
              <div className="flex flex-col items-center justify-center py-24 gap-3" id="articles-loading-spinner">
                <Loader2 className="w-6 h-6 text-gray-400 animate-spin" strokeWidth={2} />
                <span className="text-[14px] text-gray-500">正在载入文章…</span>
              </div>
            ) : filteredArticlesList.length === 0 ? (
              <div className="bg-[#f5f5f7] rounded-2xl px-8 py-20 text-center" id="catalog-empty-view">
                <AlertCircle className="w-8 h-8 text-gray-400 mx-auto" strokeWidth={1.5} />
                <h4 className="mt-4 text-[21px] font-semibold text-[#1d1d1f] leading-[1.19]">未找到匹配的文章</h4>
                <p className="mt-2 text-[14px] text-gray-500 max-w-sm mx-auto leading-[1.35]">
                  当前筛选条件下暂无内容。可以重置筛选器或调整日期范围。
                </p>
                <button
                  onClick={() => {
                    setStartDate('');
                    setEndDate('');
                    setQuickDateRange('all');
                  }}
                  className="apple-focus apple-pill mt-6 px-5 py-2 bg-[#0071e3] hover:bg-[#0077ed] text-white text-[14px] transition-colors"
                  id="reset-empty-filters-btn"
                >
                  显示全部文章
                </button>
              </div>
            ) : (
              <div className="space-y-6 pb-16">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5" id="catalog-listing-grid">
                  {paginatedArticlesList.map((art) => (
                    <ArticleCard
                      key={art.id}
                      article={art}
                      onClick={() => setSelectedArticleId(art.id)}
                      translatedTitle={translatedTitles[art.id]}
                      onTranslateTitle={() => translateTitle(art.id, art.title)}
                      settings={settings}
                    />
                  ))}
                </div>

                {/* Pagination */}
                {totalPagesCount > 1 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6" id="catalog-pagination">
                    <p className="text-[12px] text-gray-500 tabular-nums" id="pagination-info">
                      第 {(currentPage - 1) * 10 + 1}–{Math.min(currentPage * 10, filteredArticlesList.length)} 篇 / 共 {filteredArticlesList.length} 篇
                    </p>
                    <div className="flex items-center gap-1.5" id="pagination-buttons">
                      <button
                        onClick={() => {
                          setCurrentPage(prev => Math.max(prev - 1, 1));
                          window.scrollTo({ top: 350, behavior: 'smooth' });
                        }}
                        disabled={currentPage === 1}
                        className="apple-focus apple-pill px-4 py-1.5 text-[12px] text-[#1d1d1f] bg-[#f5f5f7] hover:bg-[#ededf0] disabled:opacity-40 disabled:hover:bg-[#f5f5f7] transition-colors touch-manipulation cursor-pointer"
                        id="pagination-prev-btn"
                      >
                        上一页
                      </button>

                      {/* Display page numbers intelligently */}
                      {Array.from({ length: totalPagesCount }, (_, i) => i + 1).map((pg) => {
                        const isFirst = pg === 1;
                        const isLast = pg === totalPagesCount;
                        const isCurrent = pg === currentPage;
                        const isNear = Math.abs(pg - currentPage) <= 1;

                        if (isFirst || isLast || isNear) {
                          return (
                            <button
                              key={pg}
                              onClick={() => {
                                setCurrentPage(pg);
                                window.scrollTo({ top: 350, behavior: 'smooth' });
                              }}
                              className={`apple-focus w-8 h-8 text-[12px] rounded-full transition-colors touch-manipulation flex items-center justify-center cursor-pointer tabular-nums ${
                                isCurrent
                                  ? 'bg-[#0071e3] text-white'
                                  : 'bg-[#f5f5f7] text-gray-600 hover:bg-[#ededf0]'
                              }`}
                              id={`pagination-page-${pg}`}
                            >
                              {pg}
                            </button>
                          );
                        } else if (pg === 2 || pg === totalPagesCount - 1) {
                          return (
                            <span key={pg} className="px-1 text-[12px] text-gray-400 select-none">
                              …
                            </span>
                          );
                        }
                        return null;
                      })}

                      <button
                        onClick={() => {
                          setCurrentPage(prev => Math.min(prev + 1, totalPagesCount));
                          window.scrollTo({ top: 350, behavior: 'smooth' });
                        }}
                        disabled={currentPage === totalPagesCount}
                        className="apple-focus apple-pill px-4 py-1.5 text-[12px] text-[#1d1d1f] bg-[#f5f5f7] hover:bg-[#ededf0] disabled:opacity-40 disabled:hover:bg-[#f5f5f7] transition-colors touch-manipulation cursor-pointer"
                        id="pagination-next-btn"
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* VIEW 3: Immersive Read view Panel */}
        {selectedArticleId && (
          <div className="space-y-6 animate-fade-in pb-16" id="reading-detail-view-panel">
            
            {/* Reader toolbar */}
            <div className="flex items-center justify-between pt-8 pb-2" id="reader-toolbar">
              <button
                onClick={() => setSelectedArticleId(null)}
                className="apple-focus flex items-center gap-1 text-[14px] text-[#0066cc] hover:underline touch-manipulation"
                id="close-reader-btn"
              >
                <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} />
                <span>文章目录</span>
              </button>
              
              <div className="flex items-center gap-1.5" id="reader-font-controls">
                <span className="text-[12px] text-gray-500">
                  字号 · {preferences.fontSize === 'sm' ? '较小' : preferences.fontSize === 'base' ? '中等' : preferences.fontSize === 'lg' ? '宽适' : preferences.fontSize === 'xl' ? '大号' : '特大'}
                </span>
              </div>
            </div>

            {loadingDetail ? (
              <div className="flex flex-col items-center justify-center py-32 gap-3" id="detail-loading-panel">
                <Loader2 className="w-6 h-6 text-gray-400 animate-spin" strokeWidth={2} />
                <span className="text-[14px] text-gray-500">正在排版双语内容…</span>
              </div>
            ) : detailError ? (
              <div className="bg-[#f5f5f7] px-8 py-14 text-center rounded-2xl max-w-md mx-auto" id="detail-error-panel">
                <AlertCircle className="w-8 h-8 text-gray-400 mx-auto" strokeWidth={1.5} />
                <h4 className="mt-4 text-[21px] font-semibold text-[#1d1d1f] leading-[1.19]">内容加载失败</h4>
                <p className="mt-2 text-[14px] text-gray-500 leading-[1.35]">
                  {detailError}
                </p>
                <div className="mt-6 flex items-center justify-center gap-5" id="error-options">
                  <button
                    onClick={() => {
                      const currentId = selectedArticleId;
                      setSelectedArticleId(null);
                      setTimeout(() => setSelectedArticleId(currentId), 20);
                    }}
                    className="apple-focus apple-pill px-5 py-2 bg-[#0071e3] hover:bg-[#0077ed] text-white text-[14px] transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                    id="retry-fetch-detail-btn"
                  >
                    <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} />
                    <span>重试</span>
                  </button>
                  <button
                    onClick={() => setSelectedArticleId(null)}
                    className="apple-focus text-[14px] text-[#0066cc] hover:underline cursor-pointer"
                    id="go-back-fallback-btn"
                  >
                    返回目录
                  </button>
                </div>
              </div>
            ) : !activeArticle ? (
              <div className="bg-[#f5f5f7] px-8 py-14 text-center rounded-2xl max-w-md mx-auto" id="detail-error-panel">
                <h4 className="text-[21px] font-semibold text-[#1d1d1f] leading-[1.19]">无法读取该文章</h4>
                <p className="mt-2 text-[14px] text-gray-500">Markdown 文件读取失败，请返回目录重试。</p>
                <button
                  onClick={() => setSelectedArticleId(null)}
                  className="apple-focus apple-pill mt-6 px-5 py-2 bg-[#0071e3] hover:bg-[#0077ed] text-white text-[14px] transition-colors"
                  id="go-back-fallback-btn"
                >
                  返回目录
                </button>
              </div>
            ) : (
              <div className="space-y-6 max-w-[700px] mx-auto" id="curated-article-container">
                
                {/* 6. Article editorial header */}
                <div className="pt-4 pb-2" id="article-view-meta-header">
                  <div className="flex items-center gap-2 text-[12px] text-gray-500" id="article-meta-row">
                    <span className="font-semibold text-[#1d1d1f]" id="meta-channel">
                      {activeArticle.sourceChannelNameEn || (activeArticle.sourceChannel.toLowerCase().includes('bbc') ? 'BBC News' : 'TIME')}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums" id="meta-date">
                      {activeArticle.date.substring(0, 4)}/{activeArticle.date.substring(4, 6)}/{activeArticle.date.substring(6, 8)}
                    </span>
                  </div>

                  <div className="mt-3" id="active-article-bilingual-header">
                    <h2 className="apple-display text-[32px] sm:text-[40px] text-[#1d1d1f]" id="active-article-title">
                      {activeArticle.title}
                    </h2>
                    {(activeArticle.titleZh || translatedTitles[activeArticle.id]?.text) ? (
                      <h3 className="mt-3 text-[19px] font-normal text-gray-600 leading-[1.35]" id="active-article-title-zh">
                        {activeArticle.titleZh || translatedTitles[activeArticle.id].text}
                      </h3>
                    ) : (
                      <p className="mt-3 text-[14px] text-gray-400">正在翻译标题…</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 mt-7" id="speech-and-translate-flat-actions">
                    {/* Translate all paragraphs */}
                    <button
                      onClick={translateAllParagraphs}
                      disabled={bulkTranslating}
                      className="apple-focus apple-pill px-5 py-2 bg-[#0071e3] hover:bg-[#0077ed] text-white text-[14px] flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
                      id="translate-all-p-btn"
                    >
                      {bulkTranslating ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
                          <span>正在全文翻译…</span>
                        </>
                      ) : (
                        <>
                          <Languages className="w-3.5 h-3.5" strokeWidth={2} />
                          <span>全文翻译</span>
                        </>
                      )}
                    </button>

                    {/* Speech controls */}
                    {isPlayingFullText ? (
                      <>
                        {isSpeechPaused ? (
                          <button
                            onClick={resumeSpeech}
                            className="apple-focus apple-pill px-5 py-2 bg-[#f5f5f7] hover:bg-[#ededf0] text-[#1d1d1f] text-[14px] flex items-center gap-2 transition-colors"
                            id="resume-full-text-btn"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" strokeWidth={2} />
                            <span>继续朗读</span>
                          </button>
                        ) : (
                          <button
                            onClick={pauseSpeech}
                            className="apple-focus apple-pill px-5 py-2 bg-[#f5f5f7] hover:bg-[#ededf0] text-[#1d1d1f] text-[14px] flex items-center gap-2 transition-colors"
                            id="pause-full-text-btn"
                          >
                            <Pause className="w-3.5 h-3.5 fill-current" strokeWidth={2} />
                            <span>暂停</span>
                          </button>
                        )}
                        <button
                          onClick={stopSpeech}
                          className="apple-focus text-[14px] text-[#0066cc] hover:underline"
                          id="stop-full-text-btn"
                        >
                          停止朗读
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={startFullTextTTS}
                        className="apple-focus apple-pill px-5 py-2 bg-[#f5f5f7] hover:bg-[#ededf0] text-[#1d1d1f] text-[14px] flex items-center gap-2 transition-colors"
                        id="play-full-text-btn"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" strokeWidth={2} />
                        <span>全文朗读</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* 7. Reading canvas */}
                <div className="space-y-7 py-4 select-text" id="article-reading-canvas">
                  {activeArticle.paragraphs.map((p) => {
                    const translation = translatedParagraphs[p.id];
                    
                    // Native rich rendering of image paragraphs
                    const mdImgMatch = p.text.match(/^!\[(.*?)\]\((.*?)\)$/);
                    const htmlImgMatch = p.text.match(/^<img\s[^>]*?src=["'](.*?)["'][^>]*?>$/i); // HTML tag
                    if (mdImgMatch || htmlImgMatch) {
                      const alt = mdImgMatch ? mdImgMatch[1] : '';
                      const src = mdImgMatch ? mdImgMatch[2] : (p.text.match(/src=["'](.*?)["']/i)?.[1] || '');
                      return (
                        <ArticleImage
                          key={p.id}
                          src={src}
                          alt={alt}
                          id={p.id}
                        />
                      );
                    }
                    
                    if (p.isCaption) {
                      // Photo caption — quiet, indented, no card chrome
                      return (
                        <figcaption
                          key={p.id}
                          className="my-6 pl-4 border-l border-[#d2d2d7] text-[13px] text-gray-500 leading-[1.4]"
                          id={`photo-placeholder-${p.id}`}
                        >
                          {p.text}
                        </figcaption>
                      );
                    }

                     if (p.isHeading) {
                      // Section subheading — Apple section-title scale
                      return (
                        <div
                          key={p.id}
                          className={`pt-8 pb-1 rounded-xl transition-colors duration-300 ${
                            activeSpeechId === p.id ? 'bg-[#f5f5f7] px-4' : ''
                          }`}
                          id={`heading-container-${p.id}`}
                        >
                          <h3
                            className="text-[24px] sm:text-[28px] font-semibold text-[#1d1d1f] leading-[1.14] tracking-tight select-text"
                            id={`english-h-${p.id}`}
                          >
                            {renderInteractiveText(p.text)}
                          </h3>

                          {/* Subheading actions */}
                          <div className="flex items-center gap-4 mt-3" id={`p-controls-${p.id}`}>
                            <button
                              onClick={() => {
                                if (activeSpeechId === p.id) {
                                  if (isSpeechPaused) resumeSpeech();
                                  else pauseSpeech();
                                } else {
                                  playParagraphTTS(p.id, p.text);
                                }
                              }}
                              className={`apple-focus inline-flex items-center gap-1 text-[12px] transition-colors ${
                                activeSpeechId === p.id ? 'text-[#0071e3]' : 'text-gray-500 hover:text-[#0066cc]'
                              }`}
                              id={`tts-subheading-btn-${p.id}`}
                            >
                              <Volume2 className="w-3.5 h-3.5" strokeWidth={2} />
                              <span>{activeSpeechId === p.id && !isSpeechPaused ? '播放中' : '朗读'}</span>
                            </button>

                            <button
                              onClick={() => translateParagraph(p.id, p.text)}
                              disabled={translation?.loading}
                              className="apple-focus inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-[#0066cc] transition-colors disabled:opacity-50"
                              id={`translate-btn-${p.id}`}
                            >
                              {translation?.loading ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
                                  <span>翻译中…</span>
                                </>
                              ) : translation?.text ? (
                                <>
                                  <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} />
                                  <span>重新翻译</span>
                                </>
                              ) : (
                                <>
                                  <Languages className="w-3.5 h-3.5" strokeWidth={2} />
                                  <span>翻译</span>
                                </>
                              )}
                            </button>
                          </div>

                          {/* Translation block */}
                          {translation && !translation.loading && (
                            <div className="animate-fade-in mt-3" id={`p-translation-box-${p.id}`}>
                              {translation.error ? (
                                <p className="text-[13px] text-gray-500">{translation.error}</p>
                              ) : (
                                <h4 className="text-[19px] font-normal text-gray-600 leading-[1.35]">
                                  {renderTextWithBold(translation.text)}
                                </h4>
                              )}
                            </div>
                          )}

                          {paragraphSpeechErrors[p.id] && (
                            <p className="animate-fade-in mt-2 text-[12px] text-gray-500" id={`p-speech-error-${p.id}`}>
                              朗读失败：{paragraphSpeechErrors[p.id]}
                            </p>
                          )}
                        </div>
                      );
                    }

                    // Standard paragraph — borderless prose, hover-revealed controls
                    return (
                      <div
                        key={p.id}
                        className={`group rounded-xl px-4 py-3 -mx-4 transition-colors ${
                          activeSpeechId === p.id ? 'bg-[#f5f5f7]' : 'hover:bg-[#fbfbfd]'
                        }`}
                        id={`paragraph-container-${p.id}`}
                      >
                        {/* Interactive English Content */}
                        <p 
                          className={`text-[#1d1d1f] animate-fade-in select-text ${getFontFamilyClass()} ${getFontSizeClass()}`}
                          id={`english-p-${p.id}`}
                        >
                          {renderInteractiveText(p.text)}
                        </p>

                        {/* Paragraph actions */}
                        <div className="flex items-center gap-4 mt-2.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity" id={`p-controls-${p.id}`}>
                          <button
                            onClick={() => {
                              if (activeSpeechId === p.id) {
                                if (isSpeechPaused) resumeSpeech();
                                else pauseSpeech();
                              } else {
                                playParagraphTTS(p.id, p.text);
                              }
                            }}
                            className={`apple-focus inline-flex items-center gap-1 text-[12px] transition-colors touch-manipulation ${
                              activeSpeechId === p.id ? 'text-[#0071e3]' : 'text-gray-500 hover:text-[#0066cc]'
                            }`}
                            id={`tts-btn-${p.id}`}
                          >
                            <Volume2 className="w-3.5 h-3.5" strokeWidth={2} />
                            <span>{activeSpeechId === p.id && !isSpeechPaused ? '播放中' : '朗读'}</span>
                          </button>

                          <button
                            onClick={() => translateParagraph(p.id, p.text)}
                            disabled={translation?.loading}
                            className="apple-focus inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-[#0066cc] transition-colors touch-manipulation disabled:opacity-50"
                            id={`translate-btn-${p.id}`}
                          >
                            {translation?.loading ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
                                <span>翻译中…</span>
                              </>
                            ) : translation?.text ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} />
                                <span>重新翻译</span>
                              </>
                            ) : (
                              <>
                                <Languages className="w-3.5 h-3.5" strokeWidth={2} />
                                <span>翻译</span>
                              </>
                            )}
                          </button>

                          <span className="text-[11px] text-gray-300 tabular-nums" id={`char-count-${p.id}`}>
                            {p.text.length}
                          </span>
                        </div>

                        {/* Paragraph translation */}
                        {translation && (
                          <div className="animate-fade-in mt-2.5" id={`p-translation-box-${p.id}`}>
                            {translation.loading ? (
                              <p className="text-[13px] text-gray-400" id="translating-p-skeleton">正在翻译…</p>
                            ) : translation.error ? (
                              <p className="text-[13px] text-gray-500" id="translation-p-error">{translation.error}</p>
                            ) : (
                              <div className="border-l-2 border-[#0071e3] pl-4" id={`translation-p-response-${p.id}`}>
                                <p className="text-[15px] sm:text-[17px] text-gray-600 leading-[1.47] select-text">
                                  {renderTextWithBold(translation.text)}
                                </p>
                                <p className="mt-1.5 text-[11px] text-gray-400 select-none">
                                  {settings.engine === 'free'
                                    ? settings.model === 'Google Translate Free' ? '谷歌翻译' : '微软翻译'
                                    : `${settings.engine?.toUpperCase()} 智能译注`}
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {paragraphSpeechErrors[p.id] && (
                          <p className="animate-fade-in mt-2 text-[12px] text-gray-500" id={`p-speech-error-${p.id}`}>
                            朗读失败：{paragraphSpeechErrors[p.id]}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Footer action */}
                <div className="pt-10 pb-4 flex justify-center" id="article-prose-footer">
                  <button
                    onClick={() => {
                      setSelectedArticleId(null);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="apple-focus apple-pill px-6 py-2 bg-[#f5f5f7] hover:bg-[#ededf0] text-[#1d1d1f] text-[14px] transition-colors"
                    id="finish-prose-btn"
                  >
                    返回目录
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Floating dictionary popup */}
      {activeWordInfo && (
        <WordPopup
          word={activeWordInfo.word}
          rect={activeWordInfo.rect}
          preferences={preferences}
          settings={settings}
          onClose={() => setActiveWordInfo(null)}
        />
      )}

      {/* Sliding Customize Settings drawer */}
      <SettingsPanel
        settings={settings}
        preferences={preferences}
        onSettingsChange={handleSettingsChange}
        onPreferencesChange={handlePreferencesChange}
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        allowances={allowances}
      />

      {/* 8. Footer */}
      <footer className="bg-[#f5f5f7] py-8 text-center" id="applet-global-footer">
        <div className="max-w-[980px] mx-auto px-6" id="foot-inner-combo">
          <p className="text-[12px] text-gray-500">© 2026 FuzyRead · Bilingual Reading Companion</p>
        </div>
      </footer>
    </div>
  );
}
