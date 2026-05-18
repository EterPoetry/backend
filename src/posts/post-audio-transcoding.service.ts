import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { StoredFile } from '../storage/file-storage.service';

const execFileAsync = promisify(execFile);
const DEFAULT_NORMALIZATION_TARGET_LUFS = -16;
const DEFAULT_NORMALIZATION_TARGET_LRA = 7;
const DEFAULT_NORMALIZATION_TARGET_TRUE_PEAK_DB = -1.5;
const DEFAULT_NORMALIZATION_MAX_BOOST_DB = 12;

interface LoudnessAnalysisResult {
  inputIntegratedLufs: number;
  inputTruePeakDb: number;
  inputLra: number;
  inputThresholdDb: number;
  targetOffsetDb: number;
}

@Injectable()
export class PostAudioTranscodingService {
  private readonly logger = new Logger(PostAudioTranscodingService.name);

  constructor(private readonly configService: ConfigService) {}

  async ensureDurationWithinLimit(
    audio: StoredFile,
    maxDurationMinutes: number,
  ): Promise<number> {
    const workingDirectory = await this.createWorkingDirectory();
    const inputPath = join(workingDirectory, `probe-${randomUUID()}`);

    try {
      await writeFile(inputPath, audio.buffer);
      const durationSeconds = await this.probeDurationSeconds(inputPath);
      if (durationSeconds > maxDurationMinutes * 60) {
        throw new BadRequestException(`Audio duration exceeds ${maxDurationMinutes} minutes.`);
      }

      return Math.ceil(durationSeconds);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }

      throw this.wrapCommandError(error, 'Unable to inspect audio duration.');
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }

  async convertToOpus(audio: StoredFile): Promise<StoredFile> {
    const workingDirectory = await this.createWorkingDirectory();
    const inputPath = join(workingDirectory, `input-${randomUUID()}`);
    const outputPath = join(workingDirectory, 'output.opus');

    try {
      await writeFile(inputPath, audio.buffer);
      const configuredTargetIntegratedLufs = this.getConfiguredNumber(
        'POST_AUDIO_NORMALIZATION_TARGET_LUFS',
        DEFAULT_NORMALIZATION_TARGET_LUFS,
      );
      const initialLoudnessAnalysis = await this.measureLoudness(
        inputPath,
        configuredTargetIntegratedLufs,
      );
      const targetIntegratedLufs = this.getEffectiveTargetIntegratedLufs(
        initialLoudnessAnalysis.inputIntegratedLufs,
      );
      const loudnessAnalysis =
        targetIntegratedLufs === configuredTargetIntegratedLufs
          ? initialLoudnessAnalysis
          : await this.measureLoudness(inputPath, targetIntegratedLufs);
      const normalizationFilter = this.buildNormalizationFilter(
        targetIntegratedLufs,
        loudnessAnalysis,
      );

      await execFileAsync('ffmpeg', [
        '-y',
        '-i',
        inputPath,
        '-vn',
        '-map_metadata',
        '-1',
        '-af',
        normalizationFilter,
        '-c:a',
        'libopus',
        '-b:a',
        '96k',
        '-vbr',
        'on',
        '-application',
        'audio',
        outputPath,
      ]);

      this.logger.log(
        `Normalized post audio to ${targetIntegratedLufs.toFixed(1)} LUFS (input ${loudnessAnalysis.inputIntegratedLufs.toFixed(1)} LUFS, true peak ${loudnessAnalysis.inputTruePeakDb.toFixed(1)} dBTP).`,
      );

      return {
        buffer: await readFile(outputPath),
        mimetype: 'audio/opus',
        originalname: 'audio.opus',
      };
    } catch (error) {
      throw this.wrapCommandError(error, 'Unable to convert audio to Opus.');
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }

  private async probeDurationSeconds(filePath: string): Promise<number> {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const durationSeconds = Number.parseFloat(stdout.trim());

    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error('Invalid duration received from ffprobe.');
    }

    return durationSeconds;
  }

  private async measureLoudness(
    filePath: string,
    targetIntegratedLufs: number,
  ): Promise<LoudnessAnalysisResult> {
    const targetLra = this.getConfiguredNumber(
      'POST_AUDIO_NORMALIZATION_TARGET_LRA',
      DEFAULT_NORMALIZATION_TARGET_LRA,
    );
    const targetTruePeakDb = this.getConfiguredNumber(
      'POST_AUDIO_NORMALIZATION_TARGET_TRUE_PEAK_DB',
      DEFAULT_NORMALIZATION_TARGET_TRUE_PEAK_DB,
    );
    const analysisFilter =
      `loudnorm=I=${targetIntegratedLufs}:LRA=${targetLra}:TP=${targetTruePeakDb}:print_format=json`;

    try {
      const { stderr } = await execFileAsync('ffmpeg', [
        '-hide_banner',
        '-nostats',
        '-i',
        filePath,
        '-vn',
        '-map_metadata',
        '-1',
        '-af',
        analysisFilter,
        '-f',
        'null',
        '-',
      ]);

      return this.parseLoudnessAnalysis(stderr);
    } catch (error) {
      throw this.wrapCommandError(error, 'Unable to analyze audio loudness.');
    }
  }

  private parseLoudnessAnalysis(stderr: string): LoudnessAnalysisResult {
    const jsonMatch = stderr.match(/\{[\s\S]*}/);
    if (!jsonMatch) {
      throw new Error('Missing loudnorm analysis output.');
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    return {
      inputIntegratedLufs: this.parseRequiredNumber(parsed.input_i, 'input_i'),
      inputTruePeakDb: this.parseRequiredNumber(parsed.input_tp, 'input_tp'),
      inputLra: this.parseRequiredNumber(parsed.input_lra, 'input_lra'),
      inputThresholdDb: this.parseRequiredNumber(parsed.input_thresh, 'input_thresh'),
      targetOffsetDb: this.parseRequiredNumber(parsed.target_offset, 'target_offset'),
    };
  }

  private buildNormalizationFilter(
    targetIntegratedLufs: number,
    loudnessAnalysis: LoudnessAnalysisResult,
  ): string {
    const targetLra = this.getConfiguredNumber(
      'POST_AUDIO_NORMALIZATION_TARGET_LRA',
      DEFAULT_NORMALIZATION_TARGET_LRA,
    );
    const targetTruePeakDb = this.getConfiguredNumber(
      'POST_AUDIO_NORMALIZATION_TARGET_TRUE_PEAK_DB',
      DEFAULT_NORMALIZATION_TARGET_TRUE_PEAK_DB,
    );

    return [
      `loudnorm=I=${targetIntegratedLufs}`,
      `LRA=${targetLra}`,
      `TP=${targetTruePeakDb}`,
      `measured_I=${loudnessAnalysis.inputIntegratedLufs}`,
      `measured_TP=${loudnessAnalysis.inputTruePeakDb}`,
      `measured_LRA=${loudnessAnalysis.inputLra}`,
      `measured_thresh=${loudnessAnalysis.inputThresholdDb}`,
      `offset=${loudnessAnalysis.targetOffsetDb}`,
      'linear=true',
      'print_format=summary',
    ].join(':');
  }

  private getEffectiveTargetIntegratedLufs(inputIntegratedLufs: number): number {
    const configuredTargetLufs = this.getConfiguredNumber(
      'POST_AUDIO_NORMALIZATION_TARGET_LUFS',
      DEFAULT_NORMALIZATION_TARGET_LUFS,
    );
    const maxBoostDb = this.getConfiguredNumber(
      'POST_AUDIO_NORMALIZATION_MAX_BOOST_DB',
      DEFAULT_NORMALIZATION_MAX_BOOST_DB,
    );

    return Math.min(configuredTargetLufs, inputIntegratedLufs + maxBoostDb);
  }

  private async createWorkingDirectory(): Promise<string> {
    const baseDirectory = join(tmpdir(), 'eter-poetry-audio');
    await mkdir(baseDirectory, { recursive: true });
    return mkdtemp(join(baseDirectory, 'job-'));
  }

  private wrapCommandError(error: unknown, fallbackMessage: string): InternalServerErrorException {
    if (this.isKnownBinaryMissingError(error)) {
      return new InternalServerErrorException(
        'Audio processing tools are not available. Install ffmpeg and ffprobe on the server.',
      );
    }

    const details = this.getCommandErrorDetails(error);
    if (details) {
      return new InternalServerErrorException(`${fallbackMessage} ${details}`);
    }

    return new InternalServerErrorException(fallbackMessage);
  }

  private isKnownBinaryMissingError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    );
  }

  private parseRequiredNumber(value: unknown, fieldName: string): number {
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new Error(`Missing loudnorm field ${fieldName}.`);
    }

    const parsed = Number.parseFloat(String(value));
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid loudnorm field ${fieldName}.`);
    }

    return parsed;
  }

  private getConfiguredNumber(key: string, defaultValue: number): number {
    const rawValue = this.configService.get<string>(key);
    if (!rawValue) {
      return defaultValue;
    }

    const parsed = Number.parseFloat(rawValue);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }

  private getCommandErrorDetails(error: unknown): string | null {
    if (typeof error !== 'object' || error === null) {
      return null;
    }

    const stderr =
      'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : null;
    if (stderr) {
      return stderr;
    }

    const message =
      'message' in error && typeof error.message === 'string' ? error.message.trim() : null;
    return message || null;
  }
}
