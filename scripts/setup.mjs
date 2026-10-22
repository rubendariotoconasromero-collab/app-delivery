import { copyFile, access, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
for (const [source, target] of [
  ['.env.example', '.env'],
  ['.env.test.example', '.env.test'],
]) {
  const destination = new URL(target, root);
  try {
    await access(destination);
    console.log(`${target} ya existe; se conserva.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await copyFile(new URL(source, root), destination, constants.COPYFILE_EXCL);
    console.log(`Creado ${fileURLToPath(destination)}.`);
  }
  let content = await readFile(destination, 'utf8');
  if (!content.match(/^AUTH_SECRET=([^\r\n]*)/m)?.[1].trim()) {
    const setting = `AUTH_SECRET=${randomBytes(32).toString('base64url')}`;
    content = /^AUTH_SECRET=/m.test(content)
      ? content.replace(/^AUTH_SECRET=[^\r\n]*/m, setting)
      : `${content.trimEnd()}\n${setting}\n`;
  }
  if (!/^AUTH_OTP_DELIVERY=/m.test(content)) content += '\nAUTH_OTP_DELIVERY=development\n';
  if (!/^UPLOAD_DIR=/m.test(content))
    content += `UPLOAD_DIR=.cache/${target === '.env.test' ? 'test-' : ''}uploads\n`;
  const template = await readFile(new URL(source, root), 'utf8');
  for (const line of template.split(/\r?\n/)) {
    const key = line.match(/^(TRIP_[A-Z_]+)=/m)?.[1];
    if (key && !new RegExp(`^${key}=`, 'm').test(content)) content += `${line}\n`;
  }
  await writeFile(destination, content, { mode: 0o600 });
}
console.log('AUTH_SECRET generado donde faltaba; las credenciales existentes se conservan.');
console.log('Siguiente: npm install, npm run infra:up y npm run db:migrate.');
