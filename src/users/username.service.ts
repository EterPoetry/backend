import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { createUserConflictException } from './user-conflict.util';
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from './username.constants';

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'h',
  ґ: 'g',
  д: 'd',
  е: 'e',
  є: 'ye',
  ж: 'zh',
  з: 'z',
  и: 'y',
  і: 'i',
  ї: 'yi',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ь: '',
  ю: 'yu',
  я: 'ya',
  ё: 'yo',
  ы: 'y',
  э: 'e',
  ъ: '',
};

@Injectable()
export class UsernameService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async resolveUsername(
    username: string | null | undefined,
    fallbacks: Array<string | null | undefined>,
    excludeUserId?: number,
  ): Promise<string> {
    if (username !== undefined && username !== null) {
      return this.validateAndReserveUsername(username, excludeUserId);
    }

    return this.generateUniqueUsername(fallbacks, excludeUserId);
  }

  async validateAndReserveUsername(username: string, excludeUserId?: number): Promise<string> {
    const normalizedUsername = this.normalizeUsername(username);

    if (normalizedUsername.length < USERNAME_MIN_LENGTH) {
      throw new BadRequestException(
        `Username must contain at least ${USERNAME_MIN_LENGTH} latin letters or digits.`,
      );
    }

    await this.assertUsernameAvailable(normalizedUsername, excludeUserId);
    return normalizedUsername;
  }

  async generateUniqueUsername(
    fallbacks: Array<string | null | undefined>,
    excludeUserId?: number,
  ): Promise<string> {
    const normalizedFallbacks = fallbacks
      .map((value) => this.normalizeUsername(value))
      .filter((value) => value.length > 0);

    const baseUsername =
      normalizedFallbacks.find((value) => value.length >= USERNAME_MIN_LENGTH) ?? 'user';

    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const candidate = this.buildUsernameCandidate(baseUsername, attempt);
      const existingUser = await this.usersRepository.findOne({
        where: { username: candidate },
      });

      if (!existingUser || existingUser.userId === excludeUserId) {
        return candidate;
      }
    }

    throw new ServiceUnavailableException('Unable to generate unique username.');
  }

  normalizeUsername(value: string | null | undefined): string {
    if (!value) {
      return '';
    }

    const transliteratedValue = Array.from(value.trim().toLowerCase())
      .map((character) => CYRILLIC_TO_LATIN[character] ?? character)
      .join('');

    return transliteratedValue
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_')
      .slice(0, USERNAME_MAX_LENGTH);
  }

  private buildUsernameCandidate(baseUsername: string, attempt: number): string {
    if (attempt === 0) {
      return baseUsername.slice(0, USERNAME_MAX_LENGTH);
    }

    const suffix = `_${attempt + 1}`;
    const maxBaseLength = USERNAME_MAX_LENGTH - suffix.length;
    return `${baseUsername.slice(0, Math.max(USERNAME_MIN_LENGTH, maxBaseLength))}${suffix}`;
  }

  private async assertUsernameAvailable(
    username: string,
    excludeUserId?: number,
  ): Promise<void> {
    const existingUser = await this.usersRepository.findOne({
      where: { username },
    });

    if (existingUser && existingUser.userId !== excludeUserId) {
      throw createUserConflictException('username');
    }
  }
}
