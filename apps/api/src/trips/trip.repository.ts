import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { AppConfig } from '../config/app-config';

@Injectable()
export class TripRepository implements OnModuleDestroy {
  readonly pool: Pool;
  constructor(@Inject(AppConfig) config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.values.DATABASE_URL,
      max: 8,
      connectionTimeoutMillis: 3000,
      statement_timeout: 10000,
      query_timeout: 12000,
      application_name: 'appdelivery-trips',
    });
    this.pool.on('error', () => undefined);
  }
  async run<T>(
    operation: (client: PoolClient) => Promise<T>,
    transaction: boolean | 'snapshot' = true,
  ): Promise<T> {
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      if (transaction)
        await client.query(
          transaction === 'snapshot' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN',
        );
      const result = await operation(client);
      if (transaction) await client.query('COMMIT');
      return result;
    } catch (error) {
      if (transaction && client) await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof HttpException) throw error;
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException(
          'Ya existe una reserva o solicitud activa. Actualiza el estado del viaje.',
        );
      throw new ServiceUnavailableException(
        'No se pudo consultar o guardar el viaje. Inténtalo nuevamente.',
      );
    } finally {
      client?.release();
    }
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
  async rateLimit(key: string, max: number, seconds: number): Promise<boolean> {
    return this.run(async (client) => {
      const result = await client.query<{ attempts: number }>(
        `INSERT INTO auth_rate_limits(key,window_start,attempts) VALUES($1,NOW(),1)
        ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.window_start<=NOW()-make_interval(secs=>$2) THEN 1 ELSE LEAST(auth_rate_limits.attempts+1,$3+1) END,
        window_start=CASE WHEN auth_rate_limits.window_start<=NOW()-make_interval(secs=>$2) THEN NOW() ELSE auth_rate_limits.window_start END RETURNING attempts`,
        [key, seconds, max],
      );
      return result.rows[0]!.attempts <= max;
    });
  }
}
