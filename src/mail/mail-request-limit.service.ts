import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import {
  MailRequestCounter,
  MailRequestCounterWindowType,
} from './entities/mail-request-counter.entity';

const DEFAULT_MAIL_REQUEST_LIMIT_PER_HOUR = 20;
const DEFAULT_MAIL_REQUEST_LIMIT_PER_WEEK = 100;
const DEFAULT_MAIL_REQUEST_LIMIT_PER_MONTH = 300;

interface MailRequestWindow {
  limit: number;
  windowStart: Date;
  windowType: MailRequestCounterWindowType;
}

@Injectable()
export class MailRequestLimitService {
  constructor(
    @InjectRepository(MailRequestCounter)
    private readonly mailRequestCountersRepository: Repository<MailRequestCounter>,
    private readonly configService: ConfigService,
  ) {}

  async registerAttemptAndCheckAllowed(ipAddress: string | null): Promise<boolean> {
    const normalizedIpAddress = this.normalizeIpAddress(ipAddress);
    if (!normalizedIpAddress) {
      return true;
    }

    return this.mailRequestCountersRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(MailRequestCounter);
      const windows = this.getWindows();

      await repository.upsert(
        windows.map((window) =>
          repository.create({
            ipAddress: normalizedIpAddress,
            windowType: window.windowType,
            windowStart: window.windowStart,
            requestsCount: 0,
          }),
        ),
        ['ipAddress', 'windowType', 'windowStart'],
      );

      const counters = await repository
        .createQueryBuilder('counter')
        .setLock('pessimistic_write')
        .where('counter.ipAddress = :ipAddress', {
          ipAddress: normalizedIpAddress,
        })
        .andWhere(
          new Brackets((qb) => {
            windows.forEach((window, index) => {
              const params = {
                [`windowType${index}`]: window.windowType,
                [`windowStart${index}`]: window.windowStart,
              };
              const clause =
                `counter.windowType = :windowType${index} ` +
                `AND counter.windowStart = :windowStart${index}`;

              if (index === 0) {
                qb.where(clause, params);
                return;
              }

              qb.orWhere(clause, params);
            });
          }),
        )
        .getMany();

      const countersByType = new Map(counters.map((counter) => [counter.windowType, counter]));
      const isAllowed = windows.every((window) => {
        const counter = countersByType.get(window.windowType);
        return counter ? Number(counter.requestsCount) < window.limit : true;
      });

      for (const counter of counters) {
        counter.requestsCount += 1;
      }

      await repository.save(counters);
      return isAllowed;
    });
  }

  private getWindows(): [MailRequestWindow, MailRequestWindow, MailRequestWindow] {
    const now = new Date();

    return [
      {
        windowType: 'hour',
        windowStart: this.getUtcHourStart(now),
        limit: this.getPositiveLimit(
          'MAIL_REQUEST_LIMIT_PER_HOUR',
          DEFAULT_MAIL_REQUEST_LIMIT_PER_HOUR,
        ),
      },
      {
        windowType: 'week',
        windowStart: this.getUtcWeekStart(now),
        limit: this.getPositiveLimit(
          'MAIL_REQUEST_LIMIT_PER_WEEK',
          DEFAULT_MAIL_REQUEST_LIMIT_PER_WEEK,
        ),
      },
      {
        windowType: 'month',
        windowStart: this.getUtcMonthStart(now),
        limit: this.getPositiveLimit(
          'MAIL_REQUEST_LIMIT_PER_MONTH',
          DEFAULT_MAIL_REQUEST_LIMIT_PER_MONTH,
        ),
      },
    ];
  }

  private getPositiveLimit(configKey: string, fallback: number): number {
    const rawValue = this.configService.get<string>(configKey);
    const parsedValue = rawValue ? Number(rawValue) : fallback;

    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      return fallback;
    }

    return Math.floor(parsedValue);
  }

  private getUtcHourStart(date: Date): Date {
    return new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours(),
      ),
    );
  }

  private getUtcWeekStart(date: Date): Date {
    const dayOfWeek = date.getUTCDay();
    const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - offset),
    );
  }

  private getUtcMonthStart(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }

  private normalizeIpAddress(ipAddress: string | null): string | null {
    if (!ipAddress) {
      return null;
    }

    const normalizedIpAddress = ipAddress.trim();
    return normalizedIpAddress ? normalizedIpAddress.slice(0, 64) : null;
  }
}
