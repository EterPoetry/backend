import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { StoredFile } from '../storage/file-storage.service';

const execFileAsync = promisify(execFile);
const MAX_AUDIO_DURATION_SECONDS = 7 * 60;

@Injectable()
export class PostAudioTranscodingService {
  async ensureDurationWithinLimit(audio: StoredFile): Promise<void> {
    const workingDirectory = await this.createWorkingDirectory();
    const inputPath = join(workingDirectory, `probe-${randomUUID()}`);

    try {
      await writeFile(inputPath, audio.buffer);
      const durationSeconds = await this.probeDurationSeconds(inputPath);
      if (durationSeconds > MAX_AUDIO_DURATION_SECONDS) {
        throw new BadRequestException('Audio duration exceeds 7 minutes.');
      }
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

      await execFileAsync('ffmpeg', [
        '-y',
        '-i',
        inputPath,
        '-vn',
        '-map_metadata',
        '-1',
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
}
