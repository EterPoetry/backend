import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { spawn } from 'child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { StoredFile } from '../storage/file-storage.service';
import {
  AUDIO_ANALYSIS_FEATURES,
  AUDIO_ANALYSIS_FRAME_MS,
  AUDIO_ANALYSIS_VERSION,
  AudioAnalysisRawFrame,
  AudioAnalysisV1Dto,
} from './audio-analysis.types';

const ANALYSIS_SAMPLE_RATE = 16000;
const ANALYSIS_CHANNELS = 1;
const ANALYSIS_FFT_SIZE = 2048;
const ANALYSIS_WAVEFORM_BUCKETS = 1024;
const ANALYSIS_SILENCE_THRESHOLD = 0.05;
const ANALYSIS_MIN_SILENCE_MS = 240;
const ANALYSIS_MERGE_SILENCE_GAP_MS = 120;
const ANALYSIS_ACCENT_WINDOW_MS = 400;
const ANALYSIS_ACCENT_ENERGY_MULTIPLIER = 1.55;
const ANALYSIS_ACCENT_MIN_ENERGY = 0.12;
const ANALYSIS_ACCENT_MIN_PEAK = 0.16;
const ANALYSIS_ACCENT_MIN_DISTANCE_MS = 180;
const ANALYSIS_FEATURE_PERCENTILES = {
  energy: 0.95,
  peak: 0.98,
  low: 0.95,
  mid: 0.95,
  high: 0.95,
  zcr: 0.95,
} satisfies Record<keyof AudioAnalysisRawFrame, number>;

interface NormalizedAudioAnalysisFrame extends AudioAnalysisRawFrame {}

@Injectable()
export class PostAudioAnalysisService {
  async analyzeStoredAudio(audio: StoredFile): Promise<AudioAnalysisV1Dto> {
    const workingDirectory = await this.createWorkingDirectory();
    const inputPath = join(workingDirectory, `analysis-${randomUUID()}.opus`);

    try {
      await writeFile(inputPath, audio.buffer);
      return await this.analyzePostAudio(inputPath);
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }

  async analyzePostAudio(convertedAudioPath: string): Promise<AudioAnalysisV1Dto> {
    const pcmBuffer = await this.decodeAudioToPcm(convertedAudioPath);
    const samples = this.parsePcmSamples(pcmBuffer);

    if (!samples.length) {
      throw new InternalServerErrorException('Converted audio is empty and cannot be analyzed.');
    }

    const rawFrames = this.buildRawFrames(samples);
    const normalizedFrames = this.normalizeFrames(rawFrames);
    const frames = this.packFrames(normalizedFrames).toString('base64');
    const waveform = this.buildWaveform(samples).toString('base64');
    const durationMs = Math.round((samples.length * 1000) / ANALYSIS_SAMPLE_RATE);
    const silences = this.buildSilences(normalizedFrames);
    const accents = this.buildAccents(normalizedFrames);

    return {
      version: AUDIO_ANALYSIS_VERSION,
      durationMs,
      frameMs: AUDIO_ANALYSIS_FRAME_MS,
      features: [...AUDIO_ANALYSIS_FEATURES],
      frames,
      waveform,
      accents,
      silences,
    };
  }

  private async decodeAudioToPcm(convertedAudioPath: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-v',
        'error',
        '-i',
        convertedAudioPath,
        '-ac',
        String(ANALYSIS_CHANNELS),
        '-ar',
        String(ANALYSIS_SAMPLE_RATE),
        '-f',
        's16le',
        'pipe:1',
      ]);
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      ffmpeg.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
      ffmpeg.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });
      ffmpeg.on('error', (error) => {
        reject(this.wrapCommandError(error, 'Unable to decode audio for analysis.'));
      });
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(stdoutChunks));
          return;
        }

        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        reject(
          new InternalServerErrorException(
            stderr ? `Unable to decode audio for analysis: ${stderr}` : 'Unable to decode audio for analysis.',
          ),
        );
      });
    });
  }

  private parsePcmSamples(buffer: Buffer): Float32Array {
    const sampleCount = Math.floor(buffer.length / 2);
    const samples = new Float32Array(sampleCount);

    for (let index = 0; index < sampleCount; index += 1) {
      const sample = buffer.readInt16LE(index * 2) / 32768;
      samples[index] = Math.max(-1, Math.min(1, sample));
    }

    return samples;
  }

  private buildRawFrames(samples: Float32Array): AudioAnalysisRawFrame[] {
    const samplesPerFrame = Math.max(
      1,
      Math.round((ANALYSIS_SAMPLE_RATE * AUDIO_ANALYSIS_FRAME_MS) / 1000),
    );
    const frameCount = Math.max(1, Math.ceil(samples.length / samplesPerFrame));
    const frames: AudioAnalysisRawFrame[] = [];

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const start = frameIndex * samplesPerFrame;
      const end = Math.min(start + samplesPerFrame, samples.length);
      const frameSamples = samples.subarray(start, end);
      frames.push(this.analyzeFrame(frameSamples));
    }

    return frames;
  }

  private analyzeFrame(frameSamples: Float32Array): AudioAnalysisRawFrame {
    let sumSquares = 0;
    let peak = 0;
    let zeroCrossings = 0;

    for (let index = 0; index < frameSamples.length; index += 1) {
      const sample = frameSamples[index];
      const absoluteSample = Math.abs(sample);
      sumSquares += sample * sample;
      if (absoluteSample > peak) {
        peak = absoluteSample;
      }

      if (index > 0) {
        const previous = frameSamples[index - 1];
        const crossedPositive = previous < 0 && sample >= 0;
        const crossedNegative = previous > 0 && sample <= 0;
        if (crossedPositive || crossedNegative) {
          zeroCrossings += 1;
        }
      }
    }

    const energy = Math.sqrt(sumSquares / Math.max(1, frameSamples.length));
    const zcr = zeroCrossings / Math.max(1, frameSamples.length - 1);
    const { low, mid, high } = this.computeBandEnergies(frameSamples);

    return {
      energy,
      peak,
      low,
      mid,
      high,
      zcr,
    };
  }

  private computeBandEnergies(frameSamples: Float32Array): { low: number; mid: number; high: number } {
    const real = new Float64Array(ANALYSIS_FFT_SIZE);
    const imaginary = new Float64Array(ANALYSIS_FFT_SIZE);
    const limit = Math.min(frameSamples.length, ANALYSIS_FFT_SIZE);

    for (let index = 0; index < limit; index += 1) {
      const window = 0.5 * (1 - Math.cos((2 * Math.PI * index) / Math.max(1, frameSamples.length - 1)));
      real[index] = frameSamples[index] * window;
    }

    this.fft(real, imaginary);

    let lowSum = 0;
    let midSum = 0;
    let highSum = 0;
    let lowCount = 0;
    let midCount = 0;
    let highCount = 0;
    const binFrequency = ANALYSIS_SAMPLE_RATE / ANALYSIS_FFT_SIZE;

    for (let binIndex = 1; binIndex <= ANALYSIS_FFT_SIZE / 2; binIndex += 1) {
      const frequency = binIndex * binFrequency;
      const power = real[binIndex] * real[binIndex] + imaginary[binIndex] * imaginary[binIndex];

      if (frequency >= 80 && frequency < 250) {
        lowSum += power;
        lowCount += 1;
        continue;
      }

      if (frequency >= 250 && frequency < 2500) {
        midSum += power;
        midCount += 1;
        continue;
      }

      if (frequency >= 2500 && frequency <= 7000) {
        highSum += power;
        highCount += 1;
      }
    }

    return {
      low: Math.sqrt(lowSum / Math.max(1, lowCount)),
      mid: Math.sqrt(midSum / Math.max(1, midCount)),
      high: Math.sqrt(highSum / Math.max(1, highCount)),
    };
  }

  private normalizeFrames(rawFrames: AudioAnalysisRawFrame[]): NormalizedAudioAnalysisFrame[] {
    const percentiles = {
      energy: this.computeFeaturePercentile(rawFrames, 'energy'),
      peak: this.computeFeaturePercentile(rawFrames, 'peak'),
      low: this.computeFeaturePercentile(rawFrames, 'low'),
      mid: this.computeFeaturePercentile(rawFrames, 'mid'),
      high: this.computeFeaturePercentile(rawFrames, 'high'),
      zcr: this.computeFeaturePercentile(rawFrames, 'zcr'),
    };

    return rawFrames.map((frame) => ({
      energy: this.shapeFeature(frame.energy, percentiles.energy),
      peak: this.shapeFeature(frame.peak, percentiles.peak),
      low: this.shapeFeature(frame.low, percentiles.low),
      mid: this.shapeFeature(frame.mid, percentiles.mid),
      high: this.shapeFeature(frame.high, percentiles.high),
      zcr: this.shapeFeature(frame.zcr, percentiles.zcr),
    }));
  }

  private computeFeaturePercentile(
    frames: AudioAnalysisRawFrame[],
    feature: keyof AudioAnalysisRawFrame,
  ): number {
    const values = frames.map((frame) => frame[feature]);
    const percentile = this.computePercentile(values, ANALYSIS_FEATURE_PERCENTILES[feature]);
    if (percentile > 0) {
      return percentile;
    }

    return Math.max(...values, 0) || 1;
  }

  private computePercentile(values: number[], percentile: number): number {
    if (!values.length) {
      return 0;
    }

    const sorted = [...values].sort((left, right) => left - right);
    const position = (sorted.length - 1) * percentile;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const lowerValue = sorted[lowerIndex] ?? sorted[sorted.length - 1] ?? 0;
    const upperValue = sorted[upperIndex] ?? lowerValue;

    if (lowerIndex === upperIndex) {
      return lowerValue;
    }

    const weight = position - lowerIndex;
    return lowerValue + (upperValue - lowerValue) * weight;
  }

  private shapeFeature(value: number, normalizer: number): number {
    const normalized = this.clamp01(value / Math.max(normalizer, 1e-6));
    return Math.pow(normalized, 0.7);
  }

  private packFrames(frames: NormalizedAudioAnalysisFrame[]): Buffer {
    const bytes = Buffer.alloc(frames.length * AUDIO_ANALYSIS_FEATURES.length);

    frames.forEach((frame, frameIndex) => {
      const offset = frameIndex * AUDIO_ANALYSIS_FEATURES.length;
      bytes[offset] = this.toByte(frame.energy);
      bytes[offset + 1] = this.toByte(frame.peak);
      bytes[offset + 2] = this.toByte(frame.low);
      bytes[offset + 3] = this.toByte(frame.mid);
      bytes[offset + 4] = this.toByte(frame.high);
      bytes[offset + 5] = this.toByte(frame.zcr);
    });

    return bytes;
  }

  private buildWaveform(samples: Float32Array): Buffer {
    const bucketSize = Math.max(1, Math.ceil(samples.length / ANALYSIS_WAVEFORM_BUCKETS));
    const rawPeaks: number[] = [];

    for (let bucketIndex = 0; bucketIndex < ANALYSIS_WAVEFORM_BUCKETS; bucketIndex += 1) {
      const start = bucketIndex * bucketSize;
      const end = Math.min(start + bucketSize, samples.length);
      let peak = 0;

      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        peak = Math.max(peak, Math.abs(samples[sampleIndex]));
      }

      rawPeaks.push(peak);
    }

    const normalizer = this.computePercentile(rawPeaks, 0.98) || Math.max(...rawPeaks, 0) || 1;
    const bytes = Buffer.alloc(ANALYSIS_WAVEFORM_BUCKETS);

    rawPeaks.forEach((peak, index) => {
      bytes[index] = this.toByte(this.clamp01(peak / normalizer));
    });

    return bytes;
  }

  private buildSilences(frames: NormalizedAudioAnalysisFrame[]): Array<[number, number]> {
    const silences: Array<[number, number]> = [];
    const minimumFrames = Math.max(1, Math.ceil(ANALYSIS_MIN_SILENCE_MS / AUDIO_ANALYSIS_FRAME_MS));
    let silenceStartIndex: number | null = null;

    for (let index = 0; index <= frames.length; index += 1) {
      const isSilent = index < frames.length && frames[index].energy < ANALYSIS_SILENCE_THRESHOLD;
      if (isSilent) {
        if (silenceStartIndex === null) {
          silenceStartIndex = index;
        }
        continue;
      }

      if (silenceStartIndex !== null) {
        const length = index - silenceStartIndex;
        if (length >= minimumFrames) {
          silences.push([
            silenceStartIndex * AUDIO_ANALYSIS_FRAME_MS,
            index * AUDIO_ANALYSIS_FRAME_MS,
          ]);
        }

        silenceStartIndex = null;
      }
    }

    return this.mergeSilences(silences);
  }

  private mergeSilences(silences: Array<[number, number]>): Array<[number, number]> {
    if (silences.length <= 1) {
      return silences;
    }

    const merged: Array<[number, number]> = [silences[0]];

    for (let index = 1; index < silences.length; index += 1) {
      const current = silences[index];
      const previous = merged[merged.length - 1];

      if (current[0] - previous[1] < ANALYSIS_MERGE_SILENCE_GAP_MS) {
        previous[1] = current[1];
        continue;
      }

      merged.push(current);
    }

    return merged;
  }

  private buildAccents(frames: NormalizedAudioAnalysisFrame[]): Array<[number, number]> {
    if (!frames.length) {
      return [];
    }

    const windowRadius = Math.max(1, Math.round(ANALYSIS_ACCENT_WINDOW_MS / AUDIO_ANALYSIS_FRAME_MS));
    const minimumDistanceFrames = Math.max(
      1,
      Math.ceil(ANALYSIS_ACCENT_MIN_DISTANCE_MS / AUDIO_ANALYSIS_FRAME_MS),
    );
    const movingAverage = frames.map((_frame, index) =>
      this.computeLocalAverage(frames, index, windowRadius),
    );

    const candidates = frames
      .map((frame, index) => {
        const localAverage = movingAverage[index];
        const isAccent =
          frame.energy > localAverage * ANALYSIS_ACCENT_ENERGY_MULTIPLIER &&
          frame.energy > ANALYSIS_ACCENT_MIN_ENERGY &&
          frame.peak > ANALYSIS_ACCENT_MIN_PEAK;

        if (!isAccent) {
          return null;
        }

        const strength = this.clamp01(
          (frame.energy - localAverage) / Math.max(0.001, 1 - localAverage),
        );

        return {
          index,
          timeMs: index * AUDIO_ANALYSIS_FRAME_MS,
          strength,
          energy: frame.energy,
        };
      })
      .filter(
        (
          candidate,
        ): candidate is { index: number; timeMs: number; strength: number; energy: number } =>
          candidate !== null,
      );

    const accents: Array<[number, number]> = [];
    let lastAcceptedIndex = -minimumDistanceFrames - 1;

    for (const candidate of candidates) {
      if (candidate.index - lastAcceptedIndex >= minimumDistanceFrames) {
        accents.push([candidate.timeMs, candidate.strength]);
        lastAcceptedIndex = candidate.index;
        continue;
      }

      const lastAccent = accents[accents.length - 1];
      if (lastAccent && candidate.strength > lastAccent[1]) {
        accents[accents.length - 1] = [candidate.timeMs, candidate.strength];
        lastAcceptedIndex = candidate.index;
      }
    }

    return accents;
  }

  private computeLocalAverage(
    frames: NormalizedAudioAnalysisFrame[],
    centerIndex: number,
    radius: number,
  ): number {
    const start = Math.max(0, centerIndex - radius);
    const end = Math.min(frames.length - 1, centerIndex + radius);
    let sum = 0;
    let count = 0;

    for (let index = start; index <= end; index += 1) {
      sum += frames[index].energy;
      count += 1;
    }

    return sum / Math.max(1, count);
  }

  private fft(real: Float64Array, imaginary: Float64Array): void {
    const length = real.length;
    let bitReversedIndex = 0;

    for (let index = 1; index < length; index += 1) {
      let bit = length >> 1;
      while (bitReversedIndex & bit) {
        bitReversedIndex ^= bit;
        bit >>= 1;
      }
      bitReversedIndex ^= bit;

      if (index < bitReversedIndex) {
        [real[index], real[bitReversedIndex]] = [real[bitReversedIndex], real[index]];
        [imaginary[index], imaginary[bitReversedIndex]] = [
          imaginary[bitReversedIndex],
          imaginary[index],
        ];
      }
    }

    for (let size = 2; size <= length; size <<= 1) {
      const halfSize = size >> 1;
      const theta = (-2 * Math.PI) / size;
      const phaseShiftStepReal = Math.cos(theta);
      const phaseShiftStepImaginary = Math.sin(theta);

      for (let offset = 0; offset < length; offset += size) {
        let currentPhaseReal = 1;
        let currentPhaseImaginary = 0;

        for (let index = 0; index < halfSize; index += 1) {
          const evenIndex = offset + index;
          const oddIndex = evenIndex + halfSize;
          const oddReal =
            currentPhaseReal * real[oddIndex] - currentPhaseImaginary * imaginary[oddIndex];
          const oddImaginary =
            currentPhaseReal * imaginary[oddIndex] + currentPhaseImaginary * real[oddIndex];

          real[oddIndex] = real[evenIndex] - oddReal;
          imaginary[oddIndex] = imaginary[evenIndex] - oddImaginary;
          real[evenIndex] += oddReal;
          imaginary[evenIndex] += oddImaginary;

          const nextPhaseReal =
            currentPhaseReal * phaseShiftStepReal -
            currentPhaseImaginary * phaseShiftStepImaginary;
          const nextPhaseImaginary =
            currentPhaseReal * phaseShiftStepImaginary +
            currentPhaseImaginary * phaseShiftStepReal;
          currentPhaseReal = nextPhaseReal;
          currentPhaseImaginary = nextPhaseImaginary;
        }
      }
    }
  }

  private toByte(value: number): number {
    return Math.round(this.clamp01(value) * 255);
  }

  private clamp01(value: number): number {
    if (value <= 0) {
      return 0;
    }

    if (value >= 1) {
      return 1;
    }

    return value;
  }

  private async createWorkingDirectory(): Promise<string> {
    const baseDirectory = join(tmpdir(), 'eter-poetry-audio-analysis');
    await mkdir(baseDirectory, { recursive: true });
    return mkdtemp(join(baseDirectory, 'job-'));
  }

  private wrapCommandError(error: unknown, fallbackMessage: string): InternalServerErrorException {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return new InternalServerErrorException(
        'Audio processing tools are not available. Install ffmpeg on the server.',
      );
    }

    return new InternalServerErrorException(fallbackMessage);
  }
}
