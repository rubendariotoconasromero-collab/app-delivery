import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { AppConfig } from '../config/app-config';

export type DependencyStatus = { status: 'up' | 'down' };
export type Readiness = {
  status: 'ok' | 'degraded';
  dependencies: {
    postgres: DependencyStatus;
    postgis: DependencyStatus;
    redis: DependencyStatus;
  };
};

const TIMEOUT_MS = 1500;

@Injectable()
export class DependencyProbe implements OnModuleDestroy {
  private readonly postgres: Pool;
  private readonly redis: ReturnType<typeof createClient>;
  private connectingRedis: Promise<void> | undefined;

  constructor(@Inject(AppConfig) config: AppConfig) {
    this.postgres = new Pool({
      connectionString: config.values.DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: TIMEOUT_MS,
      idleTimeoutMillis: 10000,
      statement_timeout: TIMEOUT_MS,
      query_timeout: TIMEOUT_MS,
      application_name: 'appdelivery-api',
    });
    this.postgres.on('error', () => undefined);
    this.redis = createClient({
      url: config.values.REDIS_URL,
      disableOfflineQueue: true,
      socket: { connectTimeout: TIMEOUT_MS, reconnectStrategy: false },
    });
    // Network failures are represented by readiness, without exposing URLs.
    this.redis.on('error', () => undefined);
  }

  private async checkPostgres(): Promise<{
    postgres: DependencyStatus;
    postgis: DependencyStatus;
  }> {
    try {
      await this.postgres.query('SELECT 1');
    } catch {
      return { postgres: { status: 'down' }, postgis: { status: 'down' } };
    }
    try {
      await this.postgres.query('SELECT postgis_version()');
      return { postgres: { status: 'up' }, postgis: { status: 'up' } };
    } catch {
      return { postgres: { status: 'up' }, postgis: { status: 'down' } };
    }
  }

  private async checkRedis(): Promise<DependencyStatus> {
    try {
      if (!this.redis.isReady) {
        this.connectingRedis ??= this.redis
          .connect()
          .then(() => undefined)
          .finally(() => {
            this.connectingRedis = undefined;
          });
        await this.connectingRedis;
      }
      const reply = await this.redis.ping();
      return { status: reply === 'PONG' ? 'up' : 'down' };
    } catch {
      return { status: 'down' };
    }
  }

  async check(): Promise<Readiness> {
    const [database, redis] = await Promise.all([
      this.checkPostgres(),
      // Bound even an established connection that stops responding.
      this.withTimeout(this.checkRedis(), { status: 'down' } as DependencyStatus, () => {
        if (this.redis.isOpen) this.redis.destroy();
      }),
    ]);
    const dependencies = { ...database, redis };
    return {
      status: Object.values(dependencies).every((dependency) => dependency.status === 'up')
        ? 'ok'
        : 'degraded',
      dependencies,
    };
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    fallback: T,
    onTimeout: () => void,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((resolve) => {
          timer = setTimeout(() => {
            onTimeout();
            resolve(fallback);
          }, TIMEOUT_MS + 200);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.isOpen) this.redis.destroy();
    await this.postgres.end();
  }
}
