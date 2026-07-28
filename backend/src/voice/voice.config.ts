export interface VoicePipelineConfig {
  wakeWordEnabled: boolean;
  wakeWordEngine: 'porcupine' | 'none';
  sttPrimary: 'whisper-local' | 'browser' | 'groq-cloud';
  ttsPrimary: 'piper' | 'browser';
  cloudSttFallback: boolean;
}

export const DEFAULT_VOICE_CONFIG: VoicePipelineConfig = {
  wakeWordEnabled: process.env.JARVIS_WAKE_WORD === '1',
  wakeWordEngine: process.env.PORCUPINE_ACCESS_KEY ? 'porcupine' : 'none',
  sttPrimary: process.env.GROQ_API_KEY && process.env.JARVIS_CLOUD_STT === '1' ? 'groq-cloud' : 'whisper-local',
  ttsPrimary: 'piper',
  cloudSttFallback: !!process.env.GROQ_API_KEY,
};
