import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, firstValueFrom, Observable, Subject } from 'rxjs';
import { ApiService } from './api.service';
import { TtsStatus } from './models';

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

const VOICE_ENABLED_KEY = 'jarvis.voiceEnabled';
const HANDS_FREE_KEY = 'jarvis.handsFree';
const TTS_ENGINE_KEY = 'jarvis.ttsEngine';

const PREFERRED_EN_VOICES = [
  'Microsoft Andrew Online (Natural) - English (United States)',
  'Microsoft Aria Online (Natural) - English (United States)',
  'Microsoft Ryan Online (Natural) - English (United Kingdom)',
  'Microsoft Sonia Online (Natural) - English (United Kingdom)',
  'Microsoft Guy Online (Natural) - English (United States)',
  'Google UK English Male',
  'Google UK English Female',
  'Microsoft George - English (United Kingdom)',
  'Daniel',
];

const SAMPLE_RATE = 16000;
const SILENCE_RMS = 0.012;
const SILENCE_MS = 650;
const MIN_SPEECH_MS = 250;
const MAX_RECORD_MS = 30000;
/** Wait for a full phrase before first speak — avoids robotic micro-chunks. */
const STREAM_FIRST_MIN = 48;
const STREAM_MIN_SENTENCE = 24;
const FAST_STT_KEY = 'jarvis.fastStt';
const WAKE_WORD_KEY = 'jarvis.wakeWord';
const WAKE_PHRASE = /\b(hey\s+)?jarvis\b/i;
/** Natural conversational pace (Siri-like), not slow robot. */
const RATE_NATURAL = 1.14;
const RATE_AR = 1.08;
const PITCH_NATURAL = 1.0;

@Injectable({ providedIn: 'root' })
export class VoiceService {
  private speakingSubject = new BehaviorSubject<boolean>(false);
  private listeningSubject = new BehaviorSubject<boolean>(false);
  private transcribingSubject = new BehaviorSubject<boolean>(false);
  private enabledSubject = new BehaviorSubject<boolean>(
    localStorage.getItem(VOICE_ENABLED_KEY) !== 'false',
  );
  private handsFreeSubject = new BehaviorSubject<boolean>(
    localStorage.getItem(HANDS_FREE_KEY) === 'true',
  );
  private transcriptSubject = new Subject<string>();

  speaking$: Observable<boolean> = this.speakingSubject.asObservable();
  listening$: Observable<boolean> = this.listeningSubject.asObservable();
  transcribing$: Observable<boolean> = this.transcribingSubject.asObservable();
  enabled$: Observable<boolean> = this.enabledSubject.asObservable();
  handsFree$: Observable<boolean> = this.handsFreeSubject.asObservable();
  transcript$: Observable<string> = this.transcriptSubject.asObservable();

  private recognition?: SpeechRecognitionLike;
  private enVoice?: SpeechSynthesisVoice;
  private whisperAvailable = true;
  private preferBrowserStt = localStorage.getItem(FAST_STT_KEY) === 'true';
  private wakeWordEnabled = localStorage.getItem(WAKE_WORD_KEY) === 'true';
  private wakeRecognition?: SpeechRecognitionLike;
  private wakeWordActive = false;

  private streamBuffer = '';
  private streamSpokenAt = 0;
  private streamStarted = false;
  private speechQueue: Array<{ text: string; lang: string; jarvis: boolean; resolve: () => void }> = [];
  private queueSpeaking = false;

  private enginePreference: 'piper' | 'browser' =
    (localStorage.getItem(TTS_ENGINE_KEY) as 'piper' | 'browser' | null) ?? 'piper';
  private activeEngine: 'piper' | 'browser' = 'browser';
  private piperReady = false;
  private currentAudio?: HTMLAudioElement;
  private prefetchCache?: { text: string; blob: Blob };

  private audioContext?: AudioContext;
  private mediaStream?: MediaStream;
  private processor?: ScriptProcessorNode;
  private pcmChunks: Float32Array[] = [];
  private recordingStartedAt = 0;
  private heardSpeech = false;
  private silenceSince: number | null = null;
  private recordTimeout?: ReturnType<typeof setTimeout>;

  constructor(
    private zone: NgZone,
    private api: ApiService,
  ) {
    if (typeof speechSynthesis !== 'undefined') {
      this.pickEnglishVoice();
      speechSynthesis.onvoiceschanged = () => this.pickEnglishVoice();
    }
  }

  private ttsInitialized = false;

  private async ensureTtsReady(): Promise<void> {
    if (this.ttsInitialized) {
      return;
    }
    this.ttsInitialized = true;
    await this.initTtsEngine();
  }

  get ttsSupported(): boolean {
    return typeof speechSynthesis !== 'undefined' || this.piperReady;
  }

  get ttsEngine(): 'piper' | 'browser' {
    return this.enginePreference;
  }

  get piperAvailable(): boolean {
    return this.piperReady;
  }

  setTtsEngine(engine: 'piper' | 'browser'): void {
    this.enginePreference = engine;
    localStorage.setItem(TTS_ENGINE_KEY, engine);
    void this.initTtsEngine();
  }

  get sttEngine(): 'whisper' | 'browser' {
    return this.preferBrowserStt ? 'browser' : 'whisper';
  }

  setSttEngine(engine: 'whisper' | 'browser'): void {
    this.preferBrowserStt = engine === 'browser';
    localStorage.setItem(FAST_STT_KEY, String(this.preferBrowserStt));
  }

  get wakeWord(): boolean {
    return this.wakeWordEnabled;
  }

  setWakeWord(on: boolean): void {
    this.wakeWordEnabled = on;
    localStorage.setItem(WAKE_WORD_KEY, String(on));
    if (!on) {
      this.stopWakeWordListener();
    } else if (this.handsFree && !this.speakingSubject.value && !this.listeningSubject.value) {
      this.startWakeWordListener();
    }
  }

  startWakeWordListener(): void {
    if (!this.wakeWordEnabled || !this.browserSttAvailable()) {
      return;
    }
    if (
      this.wakeWordActive ||
      this.listeningSubject.value ||
      this.transcribingSubject.value ||
      this.speakingSubject.value
    ) {
      return;
    }
    const w = window as unknown as Record<string, unknown>;
    const Ctor = (w['SpeechRecognition'] ?? w['webkitSpeechRecognition']) as
      | (new () => SpeechRecognitionLike)
      | undefined;
    if (!Ctor) {
      return;
    }
    this.wakeRecognition = new Ctor();
    this.wakeRecognition.lang = 'en-GB';
    this.wakeRecognition.continuous = true;
    this.wakeRecognition.interimResults = true;
    this.wakeRecognition.onresult = (event) => {
      let heard = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        heard += event.results[i][0].transcript;
      }
      if (WAKE_PHRASE.test(heard)) {
        this.stopWakeWordListener();
        void this.speakAsJarvis('Yes sir?').finally(() => {
          setTimeout(() => this.startListening(), 120);
        });
      }
    };
    this.wakeRecognition.onend = () => {
      this.wakeWordActive = false;
      if (
        this.wakeWordEnabled &&
        !this.listeningSubject.value &&
        !this.transcribingSubject.value &&
        !this.speakingSubject.value
      ) {
        setTimeout(() => this.startWakeWordListener(), 400);
      }
    };
    this.wakeRecognition.onerror = () => {
      this.wakeWordActive = false;
    };
    try {
      this.wakeRecognition.start();
      this.wakeWordActive = true;
    } catch {
      this.wakeWordActive = false;
    }
  }

  stopWakeWordListener(): void {
    if (this.wakeRecognition) {
      this.wakeRecognition.onend = null;
      this.wakeRecognition.stop();
      this.wakeRecognition = undefined;
    }
    this.wakeWordActive = false;
  }

  async refreshTtsStatus(): Promise<TtsStatus | null> {
    await this.ensureTtsReady();
    try {
      const status = await firstValueFrom(this.api.ttsStatus());
      this.piperReady = !!status?.ready;
      return status;
    } catch {
      this.piperReady = false;
      return null;
    }
  }

  get sttSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  get enabled(): boolean {
    return this.enabledSubject.value;
  }

  setEnabled(enabled: boolean): void {
    localStorage.setItem(VOICE_ENABLED_KEY, String(enabled));
    this.enabledSubject.next(enabled);
    if (!enabled) {
      this.stopSpeaking();
    }
  }

  get handsFree(): boolean {
    return this.handsFreeSubject.value;
  }

  setHandsFree(on: boolean): void {
    localStorage.setItem(HANDS_FREE_KEY, String(on));
    this.handsFreeSubject.next(on);
    if (!on) {
      this.stopWakeWordListener();
      this.stopListening();
    } else if (!this.speakingSubject.value && !this.listeningSubject.value && !this.transcribingSubject.value) {
      this.resumeIdleVoice();
    }
  }

  speak(text: string): void {
    if (!this.canSpeak) {
      return;
    }
    void this.ensureTtsReady().then(() => {
      const cleaned = this.cleanForSpeech(text);
      if (!cleaned) {
        return;
      }
      void this.enqueueSpeech(cleaned, this.detectLang(cleaned), true);
    });
  }

  speakStreamReset(): void {
    this.streamBuffer = '';
    this.streamSpokenAt = 0;
    this.streamStarted = false;
    this.speechQueue = [];
    this.queueSpeaking = false;
    this.prefetchCache = undefined;
    this.stopCurrentAudio();
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel();
    }
    this.speakingSubject.next(false);
  }

  speakStreamPauseForTool(): void {
    this.streamBuffer = '';
    this.streamSpokenAt = 0;
    this.streamStarted = false;
  }

  speakStreamAppend(token: string): void {
    if (!this.canSpeak || !token) {
      return;
    }
    this.streamBuffer += token;
    this.flushStreamChunks();
  }

  speakStreamFlush(): void {
    if (!this.canSpeak) {
      return;
    }
    const rest = this.streamBuffer.slice(this.streamSpokenAt).trim();
    if (rest) {
      const cleaned = this.cleanForSpeech(rest);
      if (cleaned) {
        this.enqueueSpeech(cleaned, this.detectLang(cleaned), true);
      }
      this.streamSpokenAt = this.streamBuffer.length;
    }
  }

  speakAsJarvis(text: string): Promise<void> {
    if (!this.canSpeak) {
      return Promise.resolve();
    }
    const cleaned = this.cleanForSpeech(text);
    if (!cleaned) {
      return Promise.resolve();
    }
    return this.enqueueSpeech(cleaned, 'en-GB', true);
  }

  async speakJarvisWelcome(onLine?: (index: number) => void): Promise<void> {
    if (!this.canSpeak) {
      return;
    }
    if (typeof speechSynthesis !== 'undefined') {
      await this.ensureVoicesReady();
      speechSynthesis.cancel();
    }
    this.stopCurrentAudio();

    const lines = [
      'Arc reactor online.',
      'Neural core online.',
      'Voice synthesis ready.',
      'At your service, sir.',
    ];

    for (let i = 0; i < lines.length; i++) {
      this.zone.run(() => onLine?.(i));
      await this.enqueueSpeech(lines[i], 'en-GB', true);
    }
    this.zone.run(() => onLine?.(4));
  }

  stopSpeaking(): void {
    this.speakStreamReset();
  }

  startListening(): void {
    if (!this.sttSupported || this.listeningSubject.value || this.transcribingSubject.value) {
      return;
    }
    this.stopWakeWordListener();
    this.stopSpeaking();
    if (this.preferBrowserStt && this.browserSttAvailable()) {
      this.startBrowserCapture();
    } else if (this.whisperAvailable) {
      void this.startWhisperCapture();
    } else {
      this.startBrowserCapture();
    }
  }

  stopListening(): void {
    if (this.processor) {
      void this.finishWhisperCapture(false);
      return;
    }
    this.recognition?.stop();
    this.listeningSubject.next(false);
  }

  resumeIdleVoice(): void {
    if (this.wakeWordEnabled && this.handsFree) {
      this.startWakeWordListener();
      return;
    }
    if (this.handsFree) {
      this.startListening();
    }
  }

  toggleListening(): void {
    if (this.listeningSubject.value || this.transcribingSubject.value) {
      this.stopListening();
    } else {
      this.startListening();
    }
  }

  private browserSttAvailable(): boolean {
    const w = window as unknown as Record<string, unknown>;
    return !!(w['SpeechRecognition'] ?? w['webkitSpeechRecognition']);
  }

  private startBrowserCapture(): void {
    const w = window as unknown as Record<string, unknown>;
    const Ctor = (w['SpeechRecognition'] ?? w['webkitSpeechRecognition']) as
      | (new () => SpeechRecognitionLike)
      | undefined;
    if (!Ctor) {
      return;
    }
    this.recognition = new Ctor();
    this.recognition.lang = '';
    this.recognition.continuous = false;
    this.recognition.interimResults = true;

    this.recognition.onresult = (event) => {
      let interim = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += piece;
        } else {
          interim += piece;
        }
      }
      if (finalText.trim()) {
        this.zone.run(() => this.transcriptSubject.next(finalText.trim()));
      }
    };
    this.recognition.onend = () => this.zone.run(() => this.listeningSubject.next(false));
    this.recognition.onerror = () => this.zone.run(() => this.listeningSubject.next(false));

    this.recognition.start();
    this.listeningSubject.next(true);
  }

  private async startWhisperCapture(): Promise<void> {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.pcmChunks = [];
      this.recordingStartedAt = Date.now();
      this.heardSpeech = false;
      this.silenceSince = null;

      this.processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        this.pcmChunks.push(new Float32Array(input));
        const rms = this.rms(input);
        const elapsed = Date.now() - this.recordingStartedAt;

        if (rms >= SILENCE_RMS) {
          this.heardSpeech = true;
          this.silenceSince = null;
        } else if (this.heardSpeech && elapsed >= MIN_SPEECH_MS) {
          if (this.silenceSince == null) {
            this.silenceSince = Date.now();
          } else if (Date.now() - this.silenceSince >= SILENCE_MS) {
            void this.finishWhisperCapture(true);
          }
        }
      };

      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
      this.recordTimeout = setTimeout(() => void this.finishWhisperCapture(true), MAX_RECORD_MS);
      this.listeningSubject.next(true);
    } catch {
      this.cleanupAudio();
      this.listeningSubject.next(false);
    }
  }

  private async finishWhisperCapture(autoFromVad: boolean): Promise<void> {
    if (!this.processor) {
      return;
    }
    if (this.recordTimeout) {
      clearTimeout(this.recordTimeout);
      this.recordTimeout = undefined;
    }

    const chunks = this.pcmChunks;
    const heardSpeech = this.heardSpeech;
    this.cleanupAudio();
    this.listeningSubject.next(false);

    if (!heardSpeech && autoFromVad) {
      return;
    }

    const pcm = this.mergePcm(chunks);
    if (!pcm.length) {
      return;
    }

    const wav = encodeWav(pcm, SAMPLE_RATE);
    this.transcribingSubject.next(true);
    try {
      const result = await firstValueFrom(this.api.transcribeAudio(wav));
      const text = result?.text?.trim();
      if (text) {
        this.zone.run(() => this.transcriptSubject.next(text));
      }
    } catch {
      this.whisperAvailable = false;
      this.zone.run(() => this.startBrowserCapture());
    } finally {
      this.transcribingSubject.next(false);
    }
  }

  private flushStreamChunks(): void {
    const pending = this.streamBuffer.slice(this.streamSpokenAt);
    if (!pending) {
      return;
    }

    // Prefer full sentences — continuous, Siri-like phrasing instead of word fragments.
    const sentence = pending.match(
      new RegExp(`^([\\s\\S]{${STREAM_MIN_SENTENCE},}?[.!?؟…](?:\\s+|$))`),
    );
    if (sentence?.[1]) {
      const chunk = this.cleanForSpeech(sentence[1]);
      if (chunk) {
        this.enqueueSpeech(chunk, this.detectLang(chunk), true);
      }
      this.streamSpokenAt += sentence[1].length;
      this.streamStarted = true;
      this.flushStreamChunks();
      return;
    }

    // First audio only after a solid phrase (clause / comma), never tiny scraps.
    if (!this.streamStarted && pending.length >= STREAM_FIRST_MIN) {
      const clause = pending.search(/[,;:—–]\s/);
      const softBreak = pending.lastIndexOf(' ', STREAM_FIRST_MIN + 24);
      let cut = STREAM_FIRST_MIN;
      if (clause >= STREAM_MIN_SENTENCE && clause <= STREAM_FIRST_MIN + 40) {
        cut = clause + 1;
      } else if (softBreak > STREAM_MIN_SENTENCE) {
        cut = softBreak;
      }
      const chunk = this.cleanForSpeech(pending.slice(0, cut));
      if (chunk) {
        this.enqueueSpeech(chunk, this.detectLang(chunk), true);
      }
      this.streamSpokenAt += cut;
      this.streamStarted = true;
    }
  }

  private enqueueSpeech(text: string, lang: string, jarvis: boolean): Promise<void> {
    return new Promise((resolve) => {
      const last = this.speechQueue[this.speechQueue.length - 1];
      // Merge short trailing scraps into the previous queued phrase to avoid staccato.
      if (last && !this.queueSpeaking && text.length < 40 && last.lang === lang) {
        last.text = `${last.text} ${text}`.replace(/\s+/g, ' ').trim();
        const prevResolve = last.resolve;
        last.resolve = () => {
          prevResolve();
          resolve();
        };
        return;
      }
      this.speechQueue.push({ text, lang, jarvis: true, resolve });
      void this.drainSpeechQueue();
    });
  }

  private async initTtsEngine(): Promise<void> {
    if (this.enginePreference === 'browser') {
      this.activeEngine = 'browser';
      return;
    }

    const status = await this.refreshTtsStatus();
    if (status?.ready) {
      this.activeEngine = 'piper';
      return;
    }

    this.activeEngine = typeof speechSynthesis !== 'undefined' ? 'browser' : 'browser';
  }

  private get canSpeak(): boolean {
    if (!this.enabled) {
      return false;
    }
    return this.activeEngine === 'piper' || typeof speechSynthesis !== 'undefined';
  }

  private stopCurrentAudio(): void {
    if (!this.currentAudio) {
      return;
    }
    this.currentAudio.pause();
    this.currentAudio.src = '';
    this.currentAudio = undefined;
  }

  private prefetchSpeech(text: string): void {
    if (this.prefetchCache?.text === text) {
      return;
    }
    void firstValueFrom(this.api.synthesizeSpeech(text))
      .then((blob) => {
        this.prefetchCache = { text, blob };
      })
      .catch(() => {
        /* prefetch failure is non-fatal */
      });
  }

  private async speakPiperAudio(text: string, lang: string, jarvis: boolean): Promise<void> {
    let blob: Blob | undefined;
    if (this.prefetchCache?.text === text) {
      blob = this.prefetchCache.blob;
      this.prefetchCache = undefined;
    } else {
      try {
        blob = await firstValueFrom(this.api.synthesizeSpeech(text, jarvis ? 'en-GB' : lang));
      } catch {
        if (typeof speechSynthesis !== 'undefined') {
          await this.speakUtterance(text, lang, jarvis);
        }
        return;
      }
    }
    await this.playAudioBlob(blob);
  }

  private playAudioBlob(blob: Blob): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.currentAudio = audio;
      audio.onplay = () => this.zone.run(() => this.speakingSubject.next(true));
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (this.currentAudio === audio) {
          this.currentAudio = undefined;
        }
        this.zone.run(() => this.speakingSubject.next(false));
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (this.currentAudio === audio) {
          this.currentAudio = undefined;
        }
        this.zone.run(() => this.speakingSubject.next(false));
        resolve();
      };
      void audio.play().catch(() => {
        URL.revokeObjectURL(url);
        if (this.currentAudio === audio) {
          this.currentAudio = undefined;
        }
        this.zone.run(() => this.speakingSubject.next(false));
        resolve();
      });
    });
  }

  private async drainSpeechQueue(): Promise<void> {
    if (this.queueSpeaking) {
      return;
    }
    this.queueSpeaking = true;
    while (this.speechQueue.length) {
      const item = this.speechQueue.shift();
      if (!item) {
        break;
      }
      const next = this.speechQueue[0];
      if (this.activeEngine === 'piper' && next) {
        this.prefetchSpeech(next.text);
      }
      if (this.activeEngine === 'piper') {
        await this.speakPiperAudio(item.text, item.lang, item.jarvis);
      } else {
        await this.speakUtterance(item.text, item.lang, item.jarvis);
      }
      item.resolve();
    }
    this.queueSpeaking = false;
    if (this.speechQueue.length) {
      void this.drainSpeechQueue();
    }
  }

  private cleanupAudio(): void {
    this.processor?.disconnect();
    this.processor = undefined;
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.mediaStream = undefined;
    void this.audioContext?.close();
    this.audioContext = undefined;
    this.pcmChunks = [];
  }

  private mergePcm(chunks: Float32Array[]): Float32Array {
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }

  private rms(samples: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

  private pickEnglishVoice(): void {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) {
      return;
    }
    for (const name of PREFERRED_EN_VOICES) {
      const match = voices.find((v) => v.name === name);
      if (match) {
        this.enVoice = match;
        return;
      }
    }
    // Prefer any Neural / Online / Natural voice over classic robotic ones.
    const neural =
      voices.find((v) => /natural|neural|online/i.test(v.name) && /^en/i.test(v.lang)) ??
      voices.find((v) => /natural|neural|online/i.test(v.name));
    if (neural) {
      this.enVoice = neural;
      return;
    }
    this.enVoice =
      voices.find((v) => v.lang === 'en-GB') ??
      voices.find((v) => v.lang.startsWith('en')) ??
      voices[0];
  }

  private pickVoiceForLang(lang: string): SpeechSynthesisVoice | undefined {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) {
      return this.enVoice;
    }
    const prefix = lang.split('-')[0].toLowerCase();
    const neuralLang = voices.find(
      (v) =>
        v.lang.toLowerCase().startsWith(prefix) && /natural|neural|online/i.test(v.name),
    );
    if (neuralLang) {
      return neuralLang;
    }
    const exact = voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase());
    if (exact) {
      return exact;
    }
    const partial = voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
    if (partial) {
      return partial;
    }
    return lang.startsWith('en') ? this.enVoice : voices[0];
  }

  private detectLang(text: string): string {
    if (/[\u0600-\u06FF]/.test(text)) {
      return 'ar-TN';
    }
    if (/[àâäçéèêëîïôùûüœæ]/i.test(text)) {
      return 'fr-FR';
    }
    if (/[¿¡ñáéíóúü]/i.test(text)) {
      return 'es-ES';
    }
    return 'en-GB';
  }

  private speakUtterance(text: string, lang: string, jarvis: boolean): Promise<void> {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = jarvis || lang.startsWith('en') ? (this.enVoice?.lang || 'en-GB') : lang;
      const voice = jarvis
        ? this.enVoice ?? this.pickVoiceForLang('en-GB')
        : this.pickVoiceForLang(lang);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang || utterance.lang;
      }
      // Natural assistant cadence — avoid slow/low “robot” settings.
      utterance.rate = lang.startsWith('ar') ? RATE_AR : RATE_NATURAL;
      utterance.pitch = PITCH_NATURAL;
      utterance.volume = 1;
      utterance.onstart = () => this.zone.run(() => this.speakingSubject.next(true));
      utterance.onend = () => {
        this.zone.run(() => this.speakingSubject.next(false));
        resolve();
      };
      utterance.onerror = () => {
        this.zone.run(() => this.speakingSubject.next(false));
        resolve();
      };
      // Keep the synth awake on Chromium (Electron) so chained phrases don’t stall.
      if (speechSynthesis.paused) {
        speechSynthesis.resume();
      }
      speechSynthesis.speak(utterance);
    });
  }

  private ensureVoicesReady(): Promise<void> {
    return new Promise((resolve) => {
      const voices = speechSynthesis.getVoices();
      if (voices.length) {
        this.pickEnglishVoice();
        resolve();
        return;
      }
      const onReady = () => {
        this.pickEnglishVoice();
        speechSynthesis.onvoiceschanged = null;
        resolve();
      };
      speechSynthesis.onvoiceschanged = onReady;
      setTimeout(onReady, 200);
    });
  }

  private cleanForSpeech(text: string): string {
    return text
      .replace(/```[\s\S]*?```/g, ' Code block omitted. ')
      .replace(/[*_#`>|]/g, '')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1')
      .replace(/https?:\/\/\S+/g, 'a link')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}
