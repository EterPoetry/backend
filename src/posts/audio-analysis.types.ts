export const AUDIO_ANALYSIS_VERSION = 1 as const;
export const AUDIO_ANALYSIS_FRAME_MS = 80;
export const AUDIO_ANALYSIS_FEATURES = ['energy', 'peak', 'low', 'mid', 'high', 'zcr'] as const;

export type AudioAnalysisFeature = (typeof AUDIO_ANALYSIS_FEATURES)[number];

export interface AudioAnalysisV1Dto {
  version: typeof AUDIO_ANALYSIS_VERSION;
  durationMs: number;
  frameMs: number;
  features: AudioAnalysisFeature[];
  frames: string;
  waveform: string;
  accents: Array<[number, number]>;
  silences: Array<[number, number]>;
}

export interface AudioAnalysisRawFrame {
  energy: number;
  peak: number;
  low: number;
  mid: number;
  high: number;
  zcr: number;
}
