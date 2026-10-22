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
export class DriverRepository implements OnModuleDestroy {
  readonly pool: Pool;
  constructor(@Inject(AppConfig) config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.values.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 3000,
      statement_timeout: 10000,
      query_timeout: 12000,
      application_name: 'appdelivery-onboarding',
    });
    this.pool.on('error', () => undefined);
  }

  async run<T>(
    operation: (client: PoolClient) => Promise<T>,
    transaction: boolean | 'snapshot' = false,
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
        throw new ConflictException('La matrícula o el registro ya existe. Actualiza los datos.');
      throw new ServiceUnavailableException(
        'No se pudo guardar o consultar la habilitación. Comprueba la base de datos e inténtalo de nuevo.',
      );
    } finally {
      client?.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
