import { Injectable, Inject, Logger } from '@nestjs/common';
import { REDIS_CLIENT } from '../config/redis.module';
import type Redis from 'ioredis';
import { randomUUID } from 'crypto';

@Injectable()
export class RedisLockService {
  private readonly logger = new Logger(RedisLockService.name);

  constructor(@Inject(REDIS_CLIENT) private redis: Redis) {}

  /**
   * Try to acquire a distributed lock. Returns a release function if acquired, null if not.
   * Lock auto-expires after ttlMs to prevent deadlocks.
   */
  async tryAcquire(key: string, ttlMs = 60000): Promise<(() => Promise<void>) | null> {
    const lockKey = `lock:${key}`;
    const lockValue = randomUUID();

    const acquired = await this.redis.set(lockKey, lockValue, 'PX', ttlMs, 'NX');
    if (!acquired) return null;

    const release = async () => {
      // Only release if we still own the lock (compare-and-delete via Lua)
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await this.redis.eval(script, 1, lockKey, lockValue);
    };

    return release;
  }

  /**
   * Check if a lock is currently held
   */
  async isLocked(key: string): Promise<boolean> {
    const exists = await this.redis.exists(`lock:${key}`);
    return exists === 1;
  }

  /**
   * Track a mapping (e.g., executionId → channelId) in Redis with TTL
   */
  async addToSet(key: string, value: string, ttlMs = 3600000): Promise<void> {
    const setKey = `set:${key}`;
    await this.redis.sadd(setKey, value);
    await this.redis.pexpire(setKey, ttlMs);
  }

  /**
   * Get all members of a set
   */
  async getSetMembers(key: string): Promise<string[]> {
    return this.redis.smembers(`set:${key}`);
  }

  /**
   * Remove a member from a set
   */
  async removeFromSet(key: string, value: string): Promise<void> {
    await this.redis.srem(`set:${key}`, value);
  }

  /**
   * Delete a set entirely
   */
  async deleteSet(key: string): Promise<void> {
    await this.redis.del(`set:${key}`);
  }

  /**
   * Increment a counter with TTL (for rate limiting agent-to-agent exchanges)
   */
  async incrementWithTtl(key: string, ttlMs: number): Promise<number> {
    const counterKey = `counter:${key}`;
    const count = await this.redis.incr(counterKey);
    if (count === 1) {
      await this.redis.pexpire(counterKey, ttlMs);
    }
    return count;
  }

  /**
   * Get current counter value
   */
  async getCounter(key: string): Promise<number> {
    const val = await this.redis.get(`counter:${key}`);
    return val ? parseInt(val, 10) : 0;
  }
}
