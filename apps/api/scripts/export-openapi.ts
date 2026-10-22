import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApplication, createOpenApiDocument } from '../src/application';

async function exportOpenApi(): Promise<void> {
  const app = await createApplication({ logger: false });
  try {
    await app.init();
    const outputDirectory = resolve(__dirname, '../openapi');
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      resolve(outputDirectory, 'openapi.json'),
      `${JSON.stringify(createOpenApiDocument(app), null, 2)}\n`,
      'utf8',
    );
    process.stdout.write('Exported apps/api/openapi/openapi.json\n');
  } finally {
    await app.close();
  }
}

void exportOpenApi().catch(() => {
  process.stderr.write('OpenAPI export failed. Verify API configuration.\n');
  process.exitCode = 1;
});
