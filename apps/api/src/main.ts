import { Logger } from '@nestjs/common';
import { createApplication } from './application';
import { AppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  app.enableShutdownHooks();
  const { API_PORT, API_BIND_HOST } = app.get(AppConfig).values;
  await app.listen(API_PORT, API_BIND_HOST);
  Logger.log(`API listening on port ${API_PORT}. Documentation: /api/docs`, 'Bootstrap');
}

void bootstrap().catch((error: unknown) => {
  // Configuration errors name fields only; other startup errors must not print secrets.
  const message =
    error instanceof Error && error.message.startsWith('Invalid configuration fields:')
      ? error.message
      : 'API startup failed. Check local configuration and port availability.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
