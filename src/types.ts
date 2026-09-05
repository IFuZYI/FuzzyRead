export interface ArticleMeta {
  id: string;
  title: string;
  titleZh: string;
  date: string; // YYYYMMDD
  sourceChannel: string; // e.g., 'bbc_english_top_articles'
  sourceChannelNameEn?: string;
  sourceChannelNameZh?: string;
  originalLink: string;
  filePath: string;
}

export interface Paragraph {
  id: string;
  text: string;
  isCaption: boolean;
  isHeading?: boolean;
  headingLevel?: number;
}

export interface ProcessedArticle extends ArticleMeta {
  paragraphs: Paragraph[];
}

export type TranslationEngine = 'free' | 'openai' | 'gemini' | 'deepseek' | 'other';

export interface AIModelOption {
  id: string;
  name?: string;
  ownedBy?: string;
}

export interface AISettings {
  engine: TranslationEngine;
  model: string;
  apiKey: string;
  baseUrl: string;
  openaiKey?: string;
  openaiBase?: string;
  geminiKey?: string;
  geminiBase?: string;
  deepseekKey?: string;
  deepseekBase?: string;
  otherKey?: string;
  otherBase?: string;
  otherModel?: string;
  azureTranslatorKey?: string;
  azureTranslatorRegion?: string;
  azureSpeechKey?: string;
  azureSpeechRegion?: string;
  googleCloudTtsKey?: string;
  fastapiDictUrl?: string;
  elevenlabsKey?: string;
}

export interface ReadingPreferences {
  fontSize: 'sm' | 'base' | 'lg' | 'xl' | '2xl';
  fontFamily: 'times' | 'calibri' | 'inter';
  autoplayAudio: boolean;
  dictProvider?: 'builtin' | 'azure' | 'google' | 'youdao' | 'microsoft-free' | 'google-free' | 'googlecloud';  // FastAPI removed from here
  pronunciationType?: 'uk' | 'us';
  ttsProvider?: 'browser' | 'youdao' | 'azure'; // deprecated alias for word tts compatibility
  wordReadProvider?: 'browser-microsoft' | 'browser-google' | 'youdao' | 'googlecloud' | 'azure';
  paragraphTtsEngine?: 'browser' | 'openai' | 'elevenlabs' | 'other';
  paragraphTtsOtherEngine?: 'youdao' | 'google' | 'azure' | 'googlecloud';
  openaiTtsVoice?: string; // alloy, echo, fable, onyx, nova, shimmer
  openaiTtsModel?: string; // tts-1 or tts-1-hd
  elevenlabsVoiceId?: string; // custom voice ID or built-in voice
  paragraphSpeechBrowserBrand?: 'microsoft' | 'google';
  paragraphSpeechUseCloud?: boolean;
  voiceGender?: 'male' | 'female';
  paragraphTtsVoice?: string; // specific voice color chosen
}

export interface DictWordDef {
  word: string;
  phonetic: string;
  tag: string; // e.g. "cet4 ky ielts"
  translation: string;
}

declare module 'bing-translate-api' {
  export function translate(text: string, from: string | null, to: string): Promise<{ translation: string }>;
}
