import React, { useState, useEffect } from 'react';
import { Settings, X, Key, Globe, Eye, EyeOff, LayoutTemplate, Sparkles, Check, Volume2 } from 'lucide-react';
import { AISettings, AIModelOption, ReadingPreferences, TranslationEngine } from '../types';
import { DEFAULT_BASES, DEFAULT_MODELS, FONT_SIZES, normalizeOpenAIBaseUrl } from '../utils/settingsModel';
import { getApiUrl } from '../utils/api';

interface SettingsPanelProps {
  settings: AISettings;
  preferences: ReadingPreferences;
  onSettingsChange: (s: AISettings) => void;
  onPreferencesChange: (p: ReadingPreferences) => void;
  isOpen: boolean;
  onClose: () => void;
  allowances?: {
    allowBuiltinDict: boolean;
    allowBuiltinWordTts: boolean;
    allowBuiltinParagraphTranslation: boolean;
    allowBuiltinParagraphTts: boolean;
  };
}

export default function SettingsPanel({
  settings,
  preferences,
  onSettingsChange,
  onPreferencesChange,
  isOpen,
  onClose,
  allowances = {
    allowBuiltinDict: true,
    allowBuiltinWordTts: true,
    allowBuiltinParagraphTranslation: false,
    allowBuiltinParagraphTts: false
  }
}: SettingsPanelProps) {
  const [showKey, setShowKey] = useState(false);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [upstreamModels, setUpstreamModels] = useState<AIModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const updateVoices = () => {
        setBrowserVoices(window.speechSynthesis.getVoices());
      };
      updateVoices();
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, []);

  // 1. Calculate Azure Translator Allowance (used for azure dict lookup & Microsoft Azure Translate paragraph translation)
  const isDictUsingAzure = preferences.dictProvider === 'azure';
  const isParaTransUsingAzure = settings.engine === 'free' && settings.model === 'Microsoft Azure Translate';
  
  let isAzureTranslatorAllowed = true;
  if (isDictUsingAzure && !allowances.allowBuiltinDict) {
    isAzureTranslatorAllowed = false;
  }
  if (isParaTransUsingAzure && !allowances.allowBuiltinParagraphTranslation) {
    isAzureTranslatorAllowed = false;
  }
  
  const azureTranslatorPlaceholder = isAzureTranslatorAllowed
    ? '留空即使用服务器默认密钥'
    : '请输入 Microsoft Azure 翻译 API 密钥';

  // 2. Calculate Azure Speech Allowance (used for azure word pronunciation & Microsoft Azure paragraph speech)
  const isWordSpeechUsingAzure = preferences.wordReadProvider === 'azure';
  const isParaSpeechUsingAzure = preferences.paragraphTtsEngine === 'browser' && preferences.paragraphSpeechUseCloud && preferences.paragraphSpeechBrowserBrand === 'microsoft';
  
  let isAzureSpeechAllowed = true;
  if (isWordSpeechUsingAzure && !allowances.allowBuiltinWordTts) {
    isAzureSpeechAllowed = false;
  }
  if (isParaSpeechUsingAzure && !allowances.allowBuiltinParagraphTts) {
    isAzureSpeechAllowed = false;
  }
  
  const azureSpeechPlaceholder = isAzureSpeechAllowed
    ? '留空即使用服务器默认通道'
    : '请输入 Microsoft Azure 语音 API 密钥';

  // 3. Calculate Google Cloud Allowance
  const isDictUsingGoogle = preferences.dictProvider === 'googlecloud';
  const isWordSpeechUsingGoogle = preferences.wordReadProvider === 'googlecloud';
  const isParaTransUsingGoogle = settings.engine === 'free' && settings.model === 'Google Cloud Translate';
  const isParaSpeechUsingGoogle = preferences.paragraphTtsEngine === 'browser' && preferences.paragraphSpeechUseCloud && preferences.paragraphSpeechBrowserBrand === 'google';

  let isGoogleAllowed = true;
  if (isDictUsingGoogle && !allowances.allowBuiltinDict) {
    isGoogleAllowed = false;
  }
  if (isWordSpeechUsingGoogle && !allowances.allowBuiltinWordTts) {
    isGoogleAllowed = false;
  }
  if (isParaTransUsingGoogle && !allowances.allowBuiltinParagraphTranslation) {
    isGoogleAllowed = false;
  }
  if (isParaSpeechUsingGoogle && !allowances.allowBuiltinParagraphTts) {
    isGoogleAllowed = false;
  }

  const googlePlaceholder = isGoogleAllowed
    ? '留空即使用服务器默认密钥'
    : '请输入 Google Cloud 专用 API 密钥';

  // 4. Calculate OpenAI Allowance
  const isParaTransUsingOpenAI = settings.engine === 'openai';
  const isParaSpeechUsingOpenAI = preferences.paragraphTtsEngine === 'openai';
  
  let isOpenAIAllowed = true;
  if (isParaTransUsingOpenAI && !allowances.allowBuiltinParagraphTranslation) {
    isOpenAIAllowed = false;
  }
  if (isParaSpeechUsingOpenAI && !allowances.allowBuiltinParagraphTts) {
    isOpenAIAllowed = false;
  }
  const openaiPlaceholder = isOpenAIAllowed
    ? '留空即使用服务器默认密钥'
    : '请输入 OpenAI API 密钥';

  // 5. Calculate Gemini Allowance
  const isParaTransUsingGemini = settings.engine === 'gemini';
  let isGeminiAllowed = true;
  if (isParaTransUsingGemini && !allowances.allowBuiltinParagraphTranslation) {
    isGeminiAllowed = false;
  }
  const geminiPlaceholder = isGeminiAllowed
    ? '留空即使用服务器默认密钥'
    : '请输入 Gemini API 密钥';

  // 6. Calculate DeepSeek Allowance
  const isParaTransUsingDeepSeek = settings.engine === 'deepseek';
  let isDeepSeekAllowed = true;
  if (isParaTransUsingDeepSeek && !allowances.allowBuiltinParagraphTranslation) {
    isDeepSeekAllowed = false;
  }
  const deepseekPlaceholder = isDeepSeekAllowed
    ? '留空即使用服务器默认密钥'
    : '请输入 DeepSeek API 密钥';

  // 7. Calculate ElevenLabs Allowance
  const isParaSpeechUsingElevenLabs = preferences.paragraphTtsEngine === 'elevenlabs';
  let isElevenLabsAllowed = true;
  if (isParaSpeechUsingElevenLabs && !allowances.allowBuiltinParagraphTts) {
    isElevenLabsAllowed = false;
  }
  const elevenlabsPlaceholder = isElevenLabsAllowed
    ? '留空即使用服务器默认密钥'
    : '请输入 ElevenLabs API 密钥';

  if (!isOpen) return null;

  const handleEngineChange = (engine: TranslationEngine) => {
    let key = '';
    let baseUrl = '';

    if (engine === 'openai') {
      key = settings.openaiKey || '';
      baseUrl = settings.openaiBase || DEFAULT_BASES.openai;
    } else if (engine === 'gemini') {
      key = settings.geminiKey || '';
      baseUrl = settings.geminiBase || DEFAULT_BASES.gemini;
    } else if (engine === 'deepseek') {
      key = settings.deepseekKey || '';
      baseUrl = settings.deepseekBase || DEFAULT_BASES.deepseek;
    } else if (engine === 'other') {
      key = settings.otherKey || '';
      baseUrl = settings.otherBase || '';
    }

    const updated: AISettings = {
      ...settings,
      engine,
      model: engine === 'other' ? (settings.otherModel || settings.model || '') : DEFAULT_MODELS[engine][0],
      apiKey: key,
      baseUrl: baseUrl,
      openaiKey: settings.openaiKey || (settings.engine === 'openai' ? settings.apiKey : ''),
      openaiBase: settings.openaiBase || (settings.engine === 'openai' ? settings.baseUrl : DEFAULT_BASES.openai),
      geminiKey: settings.geminiKey || (settings.engine === 'gemini' ? settings.apiKey : ''),
      geminiBase: settings.geminiBase || (settings.engine === 'gemini' ? settings.baseUrl : DEFAULT_BASES.gemini),
      deepseekKey: settings.deepseekKey || (settings.engine === 'deepseek' ? settings.apiKey : ''),
      deepseekBase: settings.deepseekBase || (settings.engine === 'deepseek' ? settings.baseUrl : DEFAULT_BASES.deepseek),
      otherKey: settings.otherKey || (settings.engine === 'other' ? settings.apiKey : ''),
      otherBase: settings.otherBase || (settings.engine === 'other' ? settings.baseUrl : ''),
      otherModel: settings.otherModel || (settings.engine === 'other' ? settings.model : 'custom-model'),
    };
    onSettingsChange(updated);
  };

  const getActiveKey = () => {
    if (settings.engine === 'openai') return settings.openaiKey ?? settings.apiKey ?? '';
    if (settings.engine === 'gemini') return settings.geminiKey ?? settings.apiKey ?? '';
    if (settings.engine === 'deepseek') return settings.deepseekKey ?? settings.apiKey ?? '';
    if (settings.engine === 'other') return settings.otherKey ?? settings.apiKey ?? '';
    return '';
  };

  const getActiveBase = () => {
    if (settings.engine === 'openai') return settings.openaiBase ?? settings.baseUrl ?? DEFAULT_BASES.openai;
    if (settings.engine === 'gemini') return settings.geminiBase ?? settings.baseUrl ?? DEFAULT_BASES.gemini;
    if (settings.engine === 'deepseek') return settings.deepseekBase ?? settings.baseUrl ?? DEFAULT_BASES.deepseek;
    if (settings.engine === 'other') return settings.otherBase ?? settings.baseUrl ?? '';
    return '';
  };

  const handleActiveKeyChange = (val: string) => {
    const updated = { ...settings, apiKey: val };
    if (settings.engine === 'openai') updated.openaiKey = val;
    else if (settings.engine === 'gemini') updated.geminiKey = val;
    else if (settings.engine === 'deepseek') updated.deepseekKey = val;
    else if (settings.engine === 'other') updated.otherKey = val;
    onSettingsChange(updated);
  };

  const handleActiveBaseChange = (val: string) => {
    const updated = { ...settings, baseUrl: val };
    if (settings.engine === 'openai') updated.openaiBase = val;
    else if (settings.engine === 'gemini') updated.geminiBase = val;
    else if (settings.engine === 'deepseek') updated.deepseekBase = val;
    else if (settings.engine === 'other') updated.otherBase = val;
    onSettingsChange(updated);
  };

  const fetchUpstreamModels = async () => {
    const baseUrl = settings.engine === 'other'
      ? settings.otherBase || ''
      : settings.engine === 'openai'
        ? settings.openaiBase || settings.baseUrl || ''
        : settings.engine === 'gemini'
          ? settings.geminiBase || settings.baseUrl || ''
          : settings.engine === 'deepseek'
            ? settings.deepseekBase || settings.baseUrl || ''
            : settings.baseUrl || '';
    const apiKey = settings.engine === 'other'
      ? settings.otherKey || ''
      : settings.engine === 'openai'
        ? settings.openaiKey || settings.apiKey || ''
        : settings.engine === 'gemini'
          ? settings.geminiKey || settings.apiKey || ''
          : settings.engine === 'deepseek'
            ? settings.deepseekKey || settings.apiKey || ''
            : settings.apiKey || '';
    setLoadingModels(true);
    setModelFetchError('');
    try {
      const response = await fetch(getApiUrl('/api/ai/models'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: normalizeOpenAIBaseUrl(baseUrl), apiKey }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '模型列表拉取失败');
      const models: AIModelOption[] = data.models || [];
      setUpstreamModels(models);
      if (models.length > 0 && !models.some(model => model.id === settings.model)) {
        onSettingsChange({ ...settings, model: models[0].id });
      }
    } catch (error) {
      setModelFetchError((error as Error).message || '模型列表拉取失败');
    } finally {
      setLoadingModels(false);
    }
  };

  const getVoiceOptions = () => {
    const engine = preferences.paragraphTtsEngine || 'browser';
    const accent = preferences.pronunciationType || 'uk';
    
    if (engine === 'openai') {
      return [
        { label: 'Alloy (中性音)', value: 'alloy' },
        { label: 'Echo (男低音)', value: 'echo' },
        { label: 'Fable (动感音)', value: 'fable' },
        { label: 'Onyx (浑厚男音)', value: 'onyx' },
        { label: 'Nova (明亮女音)', value: 'nova' },
        { label: 'Shimmer (清亮女音)', value: 'shimmer' },
      ];
    }
    
    if (engine === 'elevenlabs') {
      return [
        { label: 'Rachel (默认拟真女音)', value: '21m00Tcm4TlvDq8ikWAM' },
        { label: 'Drew (磁性男音)', value: '29vD33N1CtxCmqQRPOHJ' },
        { label: 'Clyde (坚毅男音)', value: '2EiwWnXF2V4jof978385' },
        { label: 'Paul (优雅叙事男音)', value: '5Q0t7uMcgvnag6gC1YDP' },
        { label: 'Nicole (温柔播报女音)', value: 'piTKgcLEGmPEeCEmgW95' },
      ];
    }
    
    const subEngine = preferences.paragraphTtsOtherEngine || 'youdao';
    
    if (subEngine === 'azure') {
      if (accent === 'us') {
        return [
          { label: 'Jenny (微软美音女声)', value: 'en-US-JennyNeural' },
          { label: 'Guy (微软美音男声)', value: 'en-US-GuyNeural' },
          { label: 'Aria (精选成熟美音女声)', value: 'en-US-AriaNeural' },
          { label: 'Christopher (美音男声)', value: 'en-US-ChristopherNeural' },
          { label: 'Michelle (自然美音女声)', value: 'en-US-MichelleNeural' },
          { label: 'Roger (质感美音男声)', value: 'en-US-RogerNeural' },
        ];
      } else {
        return [
          { label: 'Sonia (微软英音女声)', value: 'en-GB-SoniaNeural' },
          { label: 'Ryan (微软英音男声)', value: 'en-GB-RyanNeural' },
          { label: 'Libby (自然英音女声)', value: 'en-GB-LibbyNeural' },
          { label: 'Oliver (明媚英音男声)', value: 'en-GB-OliverNeural' },
        ];
      }
    }
    
    if (subEngine === 'googlecloud') {
      if (accent === 'us') {
        return [
          { label: 'Wavenet-F (精选美音女声)', value: 'en-US-Wavenet-F' },
          { label: 'Wavenet-B (磁性美音男声)', value: 'en-US-Wavenet-B' },
          { label: 'Wavenet-A (日常美音女声)', value: 'en-US-Wavenet-A' },
          { label: 'Wavenet-C (清纯美音女声)', value: 'en-US-Wavenet-C' },
          { label: 'Wavenet-D (成熟美音男声)', value: 'en-US-Wavenet-D' },
        ];
      } else {
        return [
          { label: 'Wavenet-A (日常英音女声)', value: 'en-GB-Wavenet-A' },
          { label: 'Wavenet-B (磁性英音男声)', value: 'en-GB-Wavenet-B' },
          { label: 'Wavenet-C (标准英音女声)', value: 'en-GB-Wavenet-C' },
          { label: 'Wavenet-D (优雅英音男声)', value: 'en-GB-Wavenet-D' },
        ];
      }
    }
    
    const targetBrandName = subEngine === 'google' ? 'google' : 'microsoft';
    const langPrefix = accent === 'us' ? 'en-us' : 'en-gb';
    const localMatched = browserVoices.filter(v =>
      v.lang.toLowerCase().startsWith(langPrefix) &&
      v.name.toLowerCase().includes(targetBrandName)
    );
    
    if (localMatched.length > 0) {
      return localMatched.map(v => ({
        label: v.name.replace(/Microsoft |Google /g, '') + ' (本地内置)',
        value: v.name
      }));
    }
    
    return [
      { label: `系统默认内置人声 (${accent.toUpperCase()} Accent)`, value: 'default' }
    ];
  };

  const fontSizes = FONT_SIZES;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" id="settings-drawer-container">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
        id="settings-backdrop"
      />
      
      {/* Slide-out Sheet */}
      <div 
        className="relative w-full max-w-md h-full bg-white shadow-xl flex flex-col justify-between py-6 px-5 sm:px-6 animate-slide-up sm:animate-none overflow-y-auto"
        id="settings-sheet"
      >
        <div>
          {/* Header */}
          <div className="flex items-center justify-between pb-5 border-b border-[#d2d2d7]" id="settings-header">
            <div className="flex items-center space-x-2">
              <Settings className="w-5 h-5 text-[#0071e3] " />
              <h2 className="text-[21px] font-semibold text-[#1d1d1f] leading-[1.19] tracking-tight">阅读设置</h2>
            </div>
            <button 
              onClick={onClose}
              className="p-1 px-2 text-gray-400 hover:text-gray-600 hover:bg-[#f5f5f7] rounded-full transition-colors active:scale-95 touch-manipulation"
              id="close-settings-btn"
              aria-label="关闭面板"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 区域1：视觉与极简偏好 */}
          <div className="py-5 space-y-4 border-b border-[#d2d2d7]" id="visual-preferences-section">
            <h3 className="text-[12px] font-normal text-gray-500 mb-1 flex items-center space-x-1">
              <Eye className="w-3.5 h-3.5 text-[#0071e3]" />
              <span>视觉与极简偏好 (Visual & Display)</span>
            </h3>
            
            {/* Font Size Selector */}
            <div className="space-y-1.5">
              <label className="text-[14px] font-normal text-[#1d1d1f] block">阅读字号大小 (Font Size)</label>
              <div className="grid grid-cols-5 gap-1 p-1 bg-[#f5f5f7] rounded-xl">
                {fontSizes.map((f) => {
                  const isActive = preferences.fontSize === f.value;
                  return (
                    <button
                      key={f.value}
                      onClick={() => onPreferencesChange({ ...preferences, fontSize: f.value })}
                      className={`py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                        isActive
                          ? 'bg-[#0071e3] text-white'
                          : 'text-gray-600 hover:text-gray-950 hover:bg-[#f5f5f7]/60'
                      }`}
                      id={`font-size-btn-${f.value}`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Font Family Selector */}
            <div className="space-y-1.5">
              <label className="text-[14px] font-normal text-[#1d1d1f] block">阅读排版字体 (Typography)</label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-[#f5f5f7] rounded-xl">
                {[
                  { label: 'Times New Roman', value: 'times' },
                  { label: 'Calibri', value: 'calibri' },
                  { label: '系统默认', value: 'inter' },
                ].map((f) => {
                  const isActive = (preferences.fontFamily || 'times') === f.value;
                  return (
                    <button
                      key={f.value}
                      onClick={() => onPreferencesChange({ ...preferences, fontFamily: f.value as any })}
                      className={`py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors truncate ${
                        isActive
                          ? 'bg-[#0071e3] text-white'
                          : 'text-gray-600 hover:text-gray-950 hover:bg-[#f5f5f7]/60'
                      }`}
                      id={`font-family-btn-${f.value}`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          {/* 词典选项 */}
          <div className="py-5 space-y-4 border-b border-[#d2d2d7]" id="dictionary-options-section">
            <h3 className="text-[12px] font-normal text-gray-500 mb-1 flex items-center space-x-1">
              <LayoutTemplate className="w-3.5 h-3.5 text-[#0071e3]" />
              <span>词典选项 (Dictionary Config)</span>
            </h3>

            {/* Autoplay toggle */}
            <div className="flex items-center justify-between pb-2 border-b border-[#d2d2d7]">
              <div>
                <label className="text-[14px] font-normal text-[#1d1d1f] block">查词自动语音包发音</label>
              </div>
              <button
                onClick={() => onPreferencesChange({ ...preferences, autoplayAudio: !preferences.autoplayAudio })}
                className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${
                  preferences.autoplayAudio ? 'bg-[#0071e3]' : 'bg-gray-200'
                }`}
                id="autoplay-toggle-btn"
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    preferences.autoplayAudio ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Dictionary Selection */}
            <div className="space-y-1.5">
              <label className="text-[14px] font-normal text-[#1d1d1f] block">词典选择 (Dictionary lookup)</label>
              <div className="grid grid-cols-4 gap-1 p-1 bg-[#f5f5f7] rounded-xl">
                {/* Builtin / Default button */}
                {(() => {
                  const val = preferences.dictProvider || 'builtin';
                  const isActive = val === 'builtin';
                  return (
                    <button
                      key="dict-builtin"
                      onClick={() => onPreferencesChange({ ...preferences, dictProvider: 'builtin' })}
                      className={`py-1.5 text-[10px] sm:text-xs font-bold rounded-lg transition-colors truncate ${
                        isActive
                          ? 'bg-[#0071e3] text-white shadow-none'
                          : 'text-gray-600 hover:text-gray-950 hover:bg-[#f5f5f7]/60'
                      }`}
                      id="dict-provider-btn-builtin"
                    >
                      默认
                    </button>
                  );
                })()}

                {/* Microsoft button */}
                {(() => {
                  const val = preferences.dictProvider || 'builtin';
                  const isMicrosoftActive = val === 'microsoft-free' || val === 'azure';
                  const label = val === 'microsoft-free' ? '微软' : val === 'azure' ? '微软云(Azure)' : '微软';
                  return (
                    <button
                      key="dict-microsoft-toggle"
                      onClick={() => {
                        if (val !== 'microsoft-free' && val !== 'azure') {
                          onPreferencesChange({ ...preferences, dictProvider: 'microsoft-free' });
                        } else if (val === 'microsoft-free') {
                          onPreferencesChange({ ...preferences, dictProvider: 'azure' });
                        } else {
                          onPreferencesChange({ ...preferences, dictProvider: 'microsoft-free' });
                        }
                      }}
                      className={`py-1.5 text-[10px] sm:text-xs font-bold rounded-lg transition-colors truncate ${
                        isMicrosoftActive
                          ? 'bg-[#0071e3] text-white shadow-none'
                          : 'text-gray-600 hover:text-gray-950 hover:bg-[#f5f5f7]/60'
                      }`}
                      id="dict-provider-btn-microsoft"
                    >
                      {label}
                    </button>
                  );
                })()}

                {/* Google button */}
                {(() => {
                  const val = preferences.dictProvider || 'builtin';
                  const isGoogleActive = val === 'google-free' || val === 'googlecloud';
                  const label = val === 'google-free' ? '谷歌' : val === 'googlecloud' ? '谷歌云' : '谷歌';
                  return (
                    <button
                      key="dict-google-toggle"
                      onClick={() => {
                        if (val !== 'google-free' && val !== 'googlecloud') {
                          onPreferencesChange({ ...preferences, dictProvider: 'google-free' });
                        } else if (val === 'google-free') {
                          onPreferencesChange({ ...preferences, dictProvider: 'googlecloud' });
                        } else {
                          onPreferencesChange({ ...preferences, dictProvider: 'google-free' });
                        }
                      }}
                      className={`py-1.5 text-[10px] sm:text-xs font-bold rounded-lg transition-colors truncate ${
                        isGoogleActive
                          ? 'bg-[#0071e3] text-white shadow-none'
                          : 'text-gray-600 hover:text-gray-950 hover:bg-[#f5f5f7]/60'
                      }`}
                      id="dict-provider-btn-google"
                    >
                      {label}
                    </button>
                  );
                })()}

                {/* Youdao button */}
                {(() => {
                  const val = preferences.dictProvider || 'builtin';
                  const isActive = val === 'youdao';
                  return (
                    <button
                      key="dict-youdao"
                      onClick={() => onPreferencesChange({ ...preferences, dictProvider: 'youdao' })}
                      className={`py-1.5 text-[10px] sm:text-xs font-bold rounded-lg transition-colors truncate ${
                        isActive
                          ? 'bg-[#0071e3] text-white shadow-none'
                          : 'text-gray-600 hover:text-gray-950 hover:bg-[#f5f5f7]/60'
                      }`}
                      id="dict-provider-btn-youdao"
                    >
                      有道
                    </button>
                  );
                })()}
              </div>

            </div>

            {/* Word Read Aloud Engine */}
            <div className="space-y-1.5">
              <label className="text-[14px] font-normal text-[#1d1d1f] block">朗读选择 (Word Pronunciation Engine)</label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-[#f5f5f7] rounded-xl">
                {/* Microsoft button */}
                {(() => {
                  const val = preferences.wordReadProvider || 'browser-microsoft';
                  const isMicrosoftActive = val === 'browser-microsoft' || val === 'azure';
                  const label = val === 'browser-microsoft' ? '微软内置' : val === 'azure' ? '微软云(Azure)' : '微软';
                  return (
                    <button
                      key="microsoft-toggle"
                      onClick={() => {
                        if (val !== 'browser-microsoft' && val !== 'azure') {
                          onPreferencesChange({ ...preferences, wordReadProvider: 'browser-microsoft' });
                        } else if (val === 'browser-microsoft') {
                          onPreferencesChange({ ...preferences, wordReadProvider: 'azure' });
                        } else {
                          onPreferencesChange({ ...preferences, wordReadProvider: 'browser-microsoft' });
                        }
                      }}
                      className={`py-1.5 text-[10px] sm:text-xs font-bold rounded-lg transition-colors truncate ${
                        isMicrosoftActive
                          ? 'bg-[#0071e3] text-white shadow-none'
                          : 'text-gray-600 hover:text-gray-950 hover:bg-[#f5f5f7]/60'
                      }`}
                      id="word-read-microsoft-toggle"
                    >
                      {label}
                    </button>
                  );
                })()}

                {/* Google button */}
                {(() => {
                  const val = preferences.wordReadProvider || 'browser-microsoft';
                  const isGoogleActive = val === 'browser-google' || val === 'googlecloud';
                  const label = val === 'browser-google' ? '谷歌内置' : val === 'googlecloud' ? '谷歌云' : '谷歌';
                  return (
                    <button
                      key="google-toggle"
                      onClick={() => {
                        if (val !== 'browser-google' && val !== 'googlecloud') {
                          onPreferencesChange({ ...preferences, wordReadProvider: 'browser-google' });
                        } else if (val === 'browser-google') {
                          onPreferencesChange({ ...preferences, wordReadProvider: 'googlecloud' });
                        } else {
                          onPreferencesChange({ ...preferences, wordReadProvider: 'browser-google' });
                        }
                      }}
                      className={`py-1.5 text-[10px] sm:text-xs font-bold rounded-lg transition-colors truncate ${
                        isGoogleActive
                          ? 'bg-[#0071e3] text-white shadow-none'
                          : 'text-gray-600 hover:text-gray-950 hover:bg-[#f5f5f7]/60'
                      }`}
                      id="word-read-google-toggle"
                    >
                      {label}
                    </button>
                  );
                })()}

                {/* Youdao button */}
                {(() => {
                  const val = preferences.wordReadProvider || 'browser-microsoft';
                  const isYoudaoActive = val === 'youdao';
                  return (
                    <button
                      key="youdao-toggle"
                      onClick={() => onPreferencesChange({ ...preferences, wordReadProvider: 'youdao' })}
                      className={`py-1.5 text-[10px] sm:text-xs font-bold rounded-lg transition-colors truncate ${
                        isYoudaoActive
                          ? 'bg-[#0071e3] text-white shadow-none'
                          : 'text-gray-600 hover:text-gray-950 hover:bg-[#f5f5f7]/60'
                      }`}
                      id="word-read-youdao-toggle"
                    >
                      有道
                    </button>
                  );
                })()}
              </div>
            </div>

            {/* Voice Accent */}
            <div className="space-y-1.5">
              <label className="text-[14px] font-normal text-[#1d1d1f] block">口音选择 (Accent Preferences)</label>
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#f5f5f7] rounded-xl">
                {[
                  { label: '英式英音 (UK Accent)', value: 'uk' },
                  { label: '美式美音 (US Accent)', value: 'us' },
                ].map((p) => {
                  const isActive = (preferences.pronunciationType || 'uk') === p.value;
                  return (
                    <button
                      key={p.value}
                      onClick={() => onPreferencesChange({ ...preferences, pronunciationType: p.value as any })}
                      className={`py-1.5 transition-colors text-xs font-semibold rounded-md ${
                        isActive
                          ? 'bg-[#0071e3] text-white'
                          : 'text-gray-600 hover:text-gray-950 hover:bg-[#f5f5f7]/60'
                      }`}
                      id={`pron-accent-btn-${p.value}`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 段落选项 */}
          <div className="py-5 space-y-4 border-b border-[#d2d2d7]" id="paragraph-options-section">
            <h3 className="text-[12px] font-normal text-gray-500 mb-1 flex items-center space-x-1">
              <Sparkles className="w-3.5 h-3.5 text-[#0071e3]" />
              <span>段落选项 (Paragraph Config)</span>
            </h3>

            {/* Paragraph translation provider */}
            <div className="space-y-1.5">
              <label className="text-[14px] font-normal text-[#1d1d1f] block">翻译引擎 (Translation Engine)</label>
              <div className="grid grid-cols-5 gap-1">
                {(['free', 'openai', 'gemini', 'deepseek', 'other'] as TranslationEngine[]).map((eng) => {
                  const isActive = settings.engine === eng;
                  return (
                    <button
                      key={eng}
                      onClick={() => handleEngineChange(eng)}
                      className={`py-1.5 text-xs font-semibold rounded-lg border transition-all truncate active:scale-95 ${
                        isActive
                           ? 'bg-[#0071e3] text-white'
                           : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                      id={`engine-btn-${eng}`}
                    >
                      {eng === 'free' ? '微软/谷歌' : eng === 'openai' ? 'OpenAI' : eng === 'gemini' ? 'Gemini' : eng === 'deepseek' ? 'DeepSeek' : '自定义'}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Paragraph Translation model selector */}
            {settings.engine !== 'free' ? (
              <div className="space-y-2 animate-fade-in" id="custom-model-selector">
                <div className="flex items-center gap-2">
                  <input
                    value={settings.model}
                    onChange={e => onSettingsChange({ ...settings, model: e.target.value })}
                    placeholder="填写模型 ID，例如 gpt-4o、claude-3-5-sonnet"
                    className="apple-focus flex-1 text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] font-mono outline-none"
                    id="custom-model-input"
                  />
                  <button
                    type="button"
                    onClick={fetchUpstreamModels}
                    disabled={loadingModels}
                    className="apple-focus apple-pill shrink-0 bg-[#0071e3] text-white px-3 py-2 text-[12px] disabled:opacity-50"
                  >
                    {loadingModels ? '拉取中…' : '拉取模型'}
                  </button>
                </div>
                {upstreamModels.length > 0 && (
                  <select
                    value={settings.model}
                    onChange={e => onSettingsChange({ ...settings, model: e.target.value })}
                    className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] outline-none"
                    id="upstream-model-selector"
                  >
                    {upstreamModels.map(model => <option key={model.id} value={model.id}>{model.id}{model.ownedBy ? ` · ${model.ownedBy}` : ''}</option>)}
                  </select>
                )}
                {modelFetchError && <p className="text-[12px] text-[#b3261e]">{modelFetchError}</p>}
              </div>
            ) : (
              <div className="space-y-1 animate-fade-in" id="model-select-wrapper">
                <label className="text-[11px] font-semibold text-gray-500 block">具体翻译语言模型 (Model Choice)</label>
                <select
                  value={settings.model}
                  onChange={(e) => onSettingsChange({ ...settings, model: e.target.value })}
                  className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] outline-none cursor-pointer"
                  id="model-selector"
                >
                  {DEFAULT_MODELS[settings.engine]?.map((m) => (
                    <option key={m} value={m}>
                      {m === 'Microsoft Translate Free' ? '微软内置 (完全免费/免密码)' : m === 'Google Translate Free' ? '谷歌内置 (完全免费/免密码)' : m === 'Microsoft Azure Translate' ? '微软云服务 (Azure Translator)' : m === 'Google Cloud Translate' ? '谷歌云服务 (Google Cloud Translate)' : m}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Paragraph Read Aloud Engine */}
            <div className="space-y-1.5" id="paragraph-tts-engine-deck">
              <label className="text-[14px] font-normal text-[#1d1d1f] block">朗读引擎 (Paragraph speech synthesis)</label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-[#f5f5f7] rounded-xl">
                {[
                  { label: '微软与谷歌', value: 'browser' },
                  { label: 'OpenAI', value: 'openai' },
                  { label: 'ElevenLabs', value: 'elevenlabs' },
                ].map((pr) => {
                  const isActive = (preferences.paragraphTtsEngine || 'browser') === pr.value;
                  return (
                    <button
                      key={pr.value}
                      type="button"
                      onClick={() => {
                        const updatedPrefs = { 
                          ...preferences, 
                          paragraphTtsEngine: pr.value as any,
                          paragraphTtsVoice: '' // Reset voice choice
                        };
                        onPreferencesChange(updatedPrefs);
                      }}
                      className={`py-1.5 text-[10px] sm:text-xs font-semibold rounded-lg transition-colors truncate cursor-pointer ${
                        isActive
                           ? 'bg-[#0071e3] text-white shadow-none font-bold'
                           : 'text-gray-600 hover:text-gray-950 hover:bg-[#f5f5f7]/60'
                      }`}
                      id={`paragraph-tts-btn-${pr.value}`}
                    >
                      {pr.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Model select when "微软与谷歌" (browser) is chosen (4 options: Microsoft Builtin, Google Builtin, Azure Speech, Google Cloud Speech) */}
            {preferences.paragraphTtsEngine === 'browser' && (
              <div className="space-y-1.5 animate-fade-in" id="paragraph-speech-model-deck">
                <label className="text-[11px] font-semibold text-gray-400 block">具体朗读源模式 (Speech Source Model)</label>
                <select
                  value={preferences.paragraphTtsOtherEngine || 'youdao'}
                  onChange={(e) => {
                    const val = e.target.value as any;
                    onPreferencesChange({
                      ...preferences,
                      paragraphTtsOtherEngine: val,
                      paragraphTtsVoice: '' // Reset selected voice
                    });
                  }}
                  className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] outline-none cursor-pointer"
                  id="paragraph-speech-model-select"
                >
                  <option value="youdao">微软内置 (完全免费/免秘钥)</option>
                  <option value="google">谷歌内置 (完全免费/免秘钥)</option>
                  <option value="azure">微软云服务 (Azure Neural Cloud)</option>
                  <option value="googlecloud">谷歌云服务 (Google Cloud Speech)</option>
                </select>
              </div>
            )}

            {/* Dynamic Voice (Timbre) Selection Dropdown */}
            <div className="space-y-1.5 animate-fade-in" id="paragraph-tts-voice-timbre-deck">
              <label className="text-[14px] font-normal text-[#1d1d1f] block">具体朗读音色 (Speech Voice & Timbre)</label>
              <select
                value={preferences.paragraphTtsVoice || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  const updated: any = { ...preferences, paragraphTtsVoice: val };
                  if (preferences.paragraphTtsEngine === 'openai') {
                    updated.openaiTtsVoice = val;
                  } else if (preferences.paragraphTtsEngine === 'elevenlabs') {
                    updated.elevenlabsVoiceId = val;
                  }
                  onPreferencesChange(updated);
                }}
                className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] outline-none cursor-pointer"
                id="paragraph-tts-voice-selector"
              >
                <option value="">-- 请选择音色/使用系统默认 --</option>
                {getVoiceOptions().map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              {/* Extra input field for custom ElevenLabs Voice ID if elevenlabs is active */}
              {preferences.paragraphTtsEngine === 'elevenlabs' && (
                <div className="mt-1.5 space-y-1 animate-fade-in" id="custom-elevenlabs-voice-input-deck">
                  <label className="text-[10px] text-gray-400 font-semibold block">自定 ElevenLabs Voice ID (若不在预设中)</label>
                  <input
                    type="text"
                    value={preferences.paragraphTtsVoice || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      onPreferencesChange({
                        ...preferences,
                        paragraphTtsVoice: val,
                        elevenlabsVoiceId: val
                      });
                    }}
                    placeholder="例如: 21m00Tcm4TlvDq8ikWAM"
                    className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] font-mono outline-none"
                    id="elevenlabs-custom-input"
                  />
                </div>
              )}
            </div>

            {/* OpenAI Extra Option (Model Selection) */}
            {preferences.paragraphTtsEngine === 'openai' && (
              <div className="space-y-1.5 animate-fade-in" id="openai-model-extra-deck">
                <label className="text-[11px] font-semibold text-gray-400 block">OpenAI TTS 模型精度 (Model)</label>
                <select
                  value={preferences.openaiTtsModel || 'tts-1'}
                  onChange={(e) => onPreferencesChange({ ...preferences, openaiTtsModel: e.target.value })}
                  className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] outline-none cursor-pointer"
                  id="openai-model-selector"
                >
                  <option value="tts-1">tts-1 (标准品质/合成速度极快)</option>
                  <option value="tts-1-hd">tts-1-hd (高保真品质/完美无瑕)</option>
                </select>
              </div>
            )}
          </div>

          {/* 专属 API 密钥配置台 */}
          <div className="py-5 space-y-4" id="api-keys-control-deck">
            <h3 className="text-[12px] font-normal text-gray-500 mb-1 flex items-center space-x-1">
              <Key className="w-3.5 h-3.5 text-[#0071e3]" />
              <span>专属自备授权 API 密钥 & 端点 (Keys Deck)</span>
            </h3>

            {/* OpenAI API credentials */}
            {(settings.engine === 'openai' || preferences.paragraphTtsEngine === 'openai') && (
              <div className="space-y-2 p-3 bg-[#f5f5f7] border border-[#d2d2d7] rounded-2xl animate-fade-in">
                <div className="font-bold text-xs text-gray-800">OpenAI API 授权自备 (AI 翻译 & TTS)</div>
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-semibold block">API Secret Key</label>
                  <input
                    type="password"
                    value={settings.openaiKey || ''}
                    onChange={(e) => onSettingsChange({ ...settings, openaiKey: e.target.value })}
                    placeholder={openaiPlaceholder}
                    className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] font-mono outline-none"
                    id="openai-key-input"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-semibold block">代理/自定端点 URL (Base URL)</label>
                  <input
                    type="text"
                    value={settings.openaiBase || ''}
                    onChange={(e) => onSettingsChange({ ...settings, openaiBase: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                    className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] font-mono outline-none"
                    id="openai-base-input"
                  />
                </div>
              </div>
            )}

            {/* Gemini Credentials */}
            {settings.engine === 'gemini' && (
              <div className="space-y-2 p-3 bg-[#f5f5f7] border border-[#d2d2d7] rounded-2xl animate-fade-in">
                <div className="font-bold text-xs text-gray-800">Gemini (Google) API 授权自备</div>
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-semibold block">Gemini API Key</label>
                  <input
                    type="password"
                    value={settings.geminiKey || ''}
                    onChange={(e) => onSettingsChange({ ...settings, geminiKey: e.target.value })}
                    placeholder={geminiPlaceholder}
                    className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] font-mono outline-none"
                    id="gemini-key-input"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-semibold block">代理端点 Base URL</label>
                  <input
                    type="text"
                    value={settings.geminiBase || ''}
                    onChange={(e) => onSettingsChange({ ...settings, geminiBase: e.target.value })}
                    placeholder="https://generativelanguage.googleapis.com/v1beta/openai"
                    className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] font-mono outline-none"
                    id="gemini-base-input"
                  />
                </div>
              </div>
            )}

            {/* DeepSeek Credentials */}
            {settings.engine === 'deepseek' && (
              <div className="space-y-2 p-3 bg-[#f5f5f7] border border-[#d2d2d7] rounded-2xl animate-fade-in">
                <div className="font-bold text-xs text-gray-800">DeepSeek API 授权自备</div>
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-semibold block">DeepSeek API Key</label>
                  <input
                    type="password"
                    value={settings.deepseekKey || ''}
                    onChange={(e) => onSettingsChange({ ...settings, deepseekKey: e.target.value })}
                    placeholder={deepseekPlaceholder}
                    className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] font-mono outline-none"
                    id="deepseek-key-input"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-semibold block">API 端点 (Base URL)</label>
                  <input
                    type="text"
                    value={settings.deepseekBase || ''}
                    onChange={(e) => onSettingsChange({ ...settings, deepseekBase: e.target.value })}
                    placeholder="https://api.deepseek.com"
                    className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] font-mono outline-none"
                    id="deepseek-base-input"
                  />
                </div>
              </div>
            )}

            {/* ElevenLabs Credentials */}
            {preferences.paragraphTtsEngine === 'elevenlabs' && (
              <div className="space-y-2 p-3 bg-[#f5f5f7] border border-[#d2d2d7] rounded-2xl animate-fade-in" id="elevenlabs-custom-deck">
                <div className="font-bold text-xs text-gray-800">ElevenLabs API 授权自备</div>
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-semibold block">ElevenLabs API Key</label>
                  <input
                    type="password"
                    value={settings.elevenlabsKey || ''}
                    onChange={(e) => onSettingsChange({ ...settings, elevenlabsKey: e.target.value })}
                    placeholder={elevenlabsPlaceholder}
                    className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] font-mono outline-none"
                    id="elevenlabs-key-input"
                  />
                </div>
              </div>
            )}

            {settings.engine === 'other' && (
              <div className="space-y-2 p-3 bg-[#f5f5f7] border border-[#d2d2d7] rounded-2xl animate-fade-in" id="custom-other-translation-deck">
                <span className="text-xs font-bold text-gray-800 block">自定义 OpenAI 兼容端点</span>
                
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-semibold block">API Key（可选，按上游要求填写）</label>
                  <input
                    type="password"
                    value={settings.otherKey || ''}
                    onChange={(e) => onSettingsChange({ ...settings, otherKey: e.target.value, apiKey: e.target.value })}
                    placeholder="请输入自定义 API Key"
                    className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] font-mono outline-none"
                    id="other-key-input-deck"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-semibold block">Base URL（例如 https://newapi.example.com/v1）</label>
                  <input
                    type="text"
                    value={settings.otherBase || ''}
                    onChange={(e) => onSettingsChange({ ...settings, otherBase: e.target.value, baseUrl: e.target.value })}
                    placeholder="e.g. https://api.yourproxy.com/v1"
                    className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] font-mono outline-none"
                    id="other-base-input-deck"
                  />
                </div>
              </div>
            )}

            {/* Microsoft Azure Translator custom key configuration */}
            {(preferences.dictProvider === 'azure' || (settings.engine === 'free' && settings.model === 'Microsoft Azure Translate')) && (
              <div className="space-y-2 p-3 bg-[#f5f5f7] border border-[#d2d2d7] rounded-2xl animate-fade-in" id="azure-translator-custom-deck">
                <span className="text-xs font-bold text-gray-800 block">微软 Azure 字典翻译专属 API</span>
                
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-semibold block">Ocp-Apim-Subscription-Key（字典查词）</label>
                  <input
                    type="password"
                    value={settings.azureTranslatorKey || ''}
                    onChange={(e) => onSettingsChange({ ...settings, azureTranslatorKey: e.target.value })}
                    placeholder={azureTranslatorPlaceholder}
                    className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] font-mono outline-none"
                    id="azure-translator-key-input"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-semibold block flex justify-between">
                    <span>Azure Translator Region 地区地区</span>
                    <span className="text-[9px] text-gray-400">(默认 global)</span>
                  </label>
                  <input
                    type="text"
                    value={settings.azureTranslatorRegion || ''}
                    onChange={(e) => onSettingsChange({ ...settings, azureTranslatorRegion: e.target.value })}
                    placeholder="global"
                    className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] font-mono outline-none"
                    id="azure-translator-region-input"
                  />
                </div>
              </div>
            )}

            {/* Microsoft Azure Speech custom key configuration */}
            {(preferences.wordReadProvider === 'azure' || (preferences.paragraphTtsEngine === 'browser' && preferences.paragraphSpeechUseCloud && preferences.paragraphSpeechBrowserBrand === 'microsoft')) && (
              <div className="space-y-2 p-3 bg-[#f5f5f7] border border-[#d2d2d7] rounded-2xl animate-fade-in" id="azure-speech-custom-deck">
                <span className="text-xs font-bold text-gray-800 block">微软 Azure 神经语音朗读专属 API</span>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-semibold block">Ocp-Apim-Speech-Subscription-Key</label>
                  <input
                    type="password"
                    value={settings.azureSpeechKey || ''}
                    onChange={(e) => onSettingsChange({ ...settings, azureSpeechKey: e.target.value })}
                    placeholder={azureSpeechPlaceholder}
                    className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] font-mono outline-none"
                    id="azure-speech-key-input"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-semibold block flex justify-between">
                    <span>Azure Speech Region 语音资源地区地区</span>
                    <span className="text-[9px] text-gray-400">(默认 eastasia)</span>
                  </label>
                  <input
                    type="text"
                    value={settings.azureSpeechRegion || ''}
                    onChange={(e) => onSettingsChange({ ...settings, azureSpeechRegion: e.target.value })}
                    placeholder="eastasia"
                    className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] font-mono outline-none"
                    id="azure-speech-region-input"
                  />
                </div>
              </div>
            )}

            {/* Google Cloud TTS customization key */}
            {(preferences.wordReadProvider === 'googlecloud' || (preferences.paragraphTtsEngine === 'browser' && preferences.paragraphSpeechUseCloud && preferences.paragraphSpeechBrowserBrand === 'google') || (settings.engine === 'free' && settings.model === 'Google Cloud Translate')) && (
              <div className="space-y-2 p-3 bg-[#f5f5f7] border border-[#d2d2d7] rounded-2xl animate-fade-in" id="google-cloud-tts-custom-deck">
                <span className="text-xs font-bold text-gray-800 block">谷歌云 Google Cloud TTS 专属 API</span>
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-semibold block">Google Cloud API Key</label>
                  <input
                    type="password"
                    value={settings.googleCloudTtsKey || ''}
                    onChange={(e) => onSettingsChange({ ...settings, googleCloudTtsKey: e.target.value })}
                    placeholder="请输入 Google Cloud 专用 API 密钥"
                    className="apple-focus w-full text-[13px] rounded-xl px-3 py-2 bg-[#f5f5f7] font-mono outline-none"
                    id="google-cloud-tts-key-input"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Saved indicator / footer */}
        <div className="pt-4 border-t border-gray-100 flex flex-col space-y-2 mt-4" id="settings-footer">
          <div className="flex items-center space-x-1.5 justify-center py-1.5 bg-[#f5f5f7] border border-[#d2d2d7] rounded-lg text-[#0071e3] text-xs font-semibold">
            <Check className="w-4 h-4 text-[#0071e3]" />
            <span>配置均自动实时安全保存在 localStorage 中</span>
          </div>
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-[#0071e3] hover:bg-[#0077ed] active:scale-[0.98] text-white hover:shadow-lg rounded-xl text-sm font-semibold transition-all touch-manipulation"
            id="save-settings-btn"
          >
            返回精读课文
          </button>
        </div>
      </div>
    </div>
  );
}
