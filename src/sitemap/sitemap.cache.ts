import { Injectable } from '@nestjs/common';

type CacheEntry = {
  value: string;
  expiresAt: number;
};

@Injectable()
export class SitemapCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<string>>();

  async getOrSet(key: string, ttlSeconds: number, build: () => Promise<string>): Promise<string> {
    const cached = this.get(key);
    if (cached !== null) return cached;

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = build()
      .then((value) => {
        this.set(key, value, ttlSeconds);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  private get(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  private set(key: string, value: string, ttlSeconds: number): void {
    this.cache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}
