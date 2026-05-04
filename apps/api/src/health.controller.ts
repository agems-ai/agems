import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { Public } from './common/decorators/roles.decorator';
import { PrismaService } from './config/prisma.service';
import { REDIS_CLIENT } from './config/redis.module';

type CheckStatus = 'ok' | string;
type HealthBody = {
  status: 'ok' | 'degraded';
  timestamp: string;
  checks: { database: CheckStatus; redis: CheckStatus };
};

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  @Public()
  async check(): Promise<HealthBody> {
    const checks: HealthBody['checks'] = {
      database: 'ok',
      redis: 'ok',
    };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      checks.database = `error: ${(e as Error).message}`;
    }

    try {
      const pong = await this.redis.ping();
      if (pong !== 'PONG') checks.redis = `unexpected: ${pong}`;
    } catch (e) {
      checks.redis = `error: ${(e as Error).message}`;
    }

    const allOk = checks.database === 'ok' && checks.redis === 'ok';
    const body: HealthBody = {
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    };

    if (!allOk) {
      // 503 so Docker / K8s healthchecks fail when a dependency is down.
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }
}
