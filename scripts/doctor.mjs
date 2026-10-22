import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const localFlutter = fileURLToPath(
  new URL(
    process.platform === 'win32'
      ? '../.tools/flutter/bin/flutter.bat'
      : '../.tools/flutter/bin/flutter',
    import.meta.url,
  ),
);
const localDart = join(
  dirname(localFlutter),
  'cache',
  'dart-sdk',
  'bin',
  process.platform === 'win32' ? 'dart.exe' : 'dart',
);
const flutterSnapshot = join(dirname(localFlutter), 'cache', 'flutter_tools.snapshot');
const npmCli =
  process.env.npm_execpath ??
  join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const flutterEnvironment = {
  ...process.env,
  CI: 'true',
  FLUTTER_SUPPRESS_ANALYTICS: 'true',
  DART_SUPPRESS_ANALYTICS: 'true',
};
if (existsSync(localFlutter)) {
  for (const [variable, directory] of Object.entries({
    PUB_CACHE: '.cache/pub-cache',
    APPDATA: '.cache/flutter-roaming',
    LOCALAPPDATA: '.cache/flutter-local',
    TEMP: '.cache/flutter-temp',
    TMP: '.cache/flutter-temp',
  })) {
    const value = join(root, directory);
    mkdirSync(value, { recursive: true });
    flutterEnvironment[variable] = value;
  }
}
const localToolReady = existsSync(localDart) && existsSync(flutterSnapshot);
const checks = [
  ['Node', process.execPath, ['--version']],
  [
    'npm',
    process.platform === 'win32' ? process.execPath : 'npm',
    process.platform === 'win32' ? [npmCli, '--version'] : ['--version'],
  ],
  ['Docker', 'docker', ['--version']],
  ['Docker Compose', 'docker', ['compose', 'version']],
  [
    'Flutter',
    localToolReady ? localDart : existsSync(localFlutter) ? localFlutter : 'flutter',
    localToolReady ? [flutterSnapshot, '--version'] : ['--version'],
  ],
];
let missing = false;
for (const [name, executable, args] of checks) {
  const usesWindowsBatch =
    process.platform === 'win32' && (executable.endsWith('.bat') || executable === 'flutter');
  const result = spawnSync(
    usesWindowsBatch ? 'powershell.exe' : executable,
    usesWindowsBatch
      ? [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '& $env:APPDELIVERY_CHECK_EXECUTABLE --version',
        ]
      : args,
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000,
      env:
        name === 'Flutter'
          ? { ...flutterEnvironment, APPDELIVERY_CHECK_EXECUTABLE: executable }
          : process.env,
      windowsHide: true,
    },
  );
  const available = !result.error && result.status === 0;
  console.log(
    `${available ? 'OK' : 'FALTA'} ${name}: ${available ? result.stdout.trim().split(/\r?\n/)[0] : 'no disponible'}`,
  );
  if (!available) missing = true;
}
const environmentExists = existsSync(new URL('../.env', import.meta.url));
console.log(`${environmentExists ? 'OK' : 'FALTA'} .env local`);
if (!environmentExists) missing = true;
console.log(
  'Android requiere Android SDK/JDK; iOS requiere macOS y Xcode. Ejecuta flutter doctor para comprobarlos.',
);
if (missing) process.exitCode = 1;
