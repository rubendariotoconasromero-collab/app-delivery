# AppDelivery

Base de desarrollo para transporte de pasajeros y encomiendas en Santa Cruz de la Sierra, Bolivia. Las apps de cliente y conductor usan Flutter; la API usa NestJS; el panel usa Angular; los datos se guardan en PostgreSQL/PostGIS y Redis. La moneda del producto es BOB, presentada como Bs.

## Estructura

```text
apps/
  api/                 NestJS: identidad, permisos, habilitación, OpenAPI y migraciones
  admin/               Angular: acceso del personal, revisión y administración de usuarios
  client/              App Flutter de cliente para Android e iOS
  driver/              App Flutter de conductor para Android e iOS
packages/
  mobile_core/         HTTP, OTP, sesión segura y componentes Flutter compartidos
contracts/             Contratos iniciales y referencia de exportación OpenAPI
infra/postgres/init/   Inicialización de PostGIS en desarrollo
scripts/               Preparación y verificación local
docs/loop-0/           Alcance funcional, estados y backlog del MVP
docs/loop-1/           Guía y estado de verificación de esta entrega
docs/loop-2/           Cuentas, permisos, alta y aprobación de conductores y vehículos
compose.yaml          PostgreSQL/PostGIS y Redis para desarrollo
```

## Requisitos

- Node 24.21.0 y npm 11; versiones del proyecto en `.nvmrc` y `package.json`.
- Docker con Compose v2 y motor Linux para levantar PostgreSQL/PostGIS y Redis.
- Flutter 3.47.7 estable, con Android SDK/JDK para Android; macOS y Xcode para compilar iOS.

Si existe un SDK Flutter en `.tools/flutter`, es local al equipo y está excluido del código. Para usarlo en la sesión actual de PowerShell:

```powershell
$env:Path = "$((Get-Location).Path)\.tools\flutter\bin;$env:Path"
flutter doctor
```

## Preparar y ejecutar

Desde la raíz del proyecto:

```powershell
npm run setup
npm ci
npm run doctor
npm run infra:up
npm run db:migrate
npm run infra:verify
```

`setup` crea `.env` y `.env.test` si faltan, genera un `AUTH_SECRET` aleatorio por entorno y añade las nuevas opciones ausentes sin reemplazar valores existentes. Las credenciales de ejemplo y `AUTH_OTP_DELIVERY=development` son exclusivas del entorno local. `infra:up` espera contenedores saludables; las migraciones se ejecutan explícitamente y conservan su historial. `infra:verify` comprueba PostGIS mediante una consulta espacial y Redis mediante escritura y lectura de una clave temporal propia.

En una terminal inicia la API y en otra el panel:

```powershell
npm run dev:api
```

```powershell
npm run dev:admin
```

| Dirección | Uso |
| --- | --- |
| `http://localhost:4200` | Panel Angular. Su proxy reenvía `/api` a `127.0.0.1:3000`. |
| `http://localhost:3000/api/v1/info` | Entorno y mercado configurados. |
| `http://localhost:3000/api/v1/health/live` | Estado del proceso HTTP. |
| `http://localhost:3000/api/v1/health/ready` | Estado de PostgreSQL, PostGIS y Redis. |
| `http://localhost:3000/api/docs` | Documentación de la API. |

La API puede iniciar para diagnóstico sin PostgreSQL o Redis. En ese caso `info` y `live` responden y `ready` devuelve 503. El registro, las sesiones y las aprobaciones requieren PostgreSQL real. Para crear el primer administrador y configurar su TOTP, sigue la [guía del loop 2](docs/loop-2/README.md).

## Apps Flutter

Desde `apps/client` o `apps/driver`:

```powershell
flutter pub get
flutter run --dart-define=APP_ENV=development --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

`10.0.2.2` corresponde al host desde el emulador Android. Para el simulador iOS usa `http://localhost:3000/api/v1`; para un teléfono físico usa la IP local del equipo que ejecuta NestJS. Ambos equipos necesitan conectividad y el puerto de la API debe estar accesible desde esa red. La API escucha en `API_BIND_HOST`, inicialmente `0.0.0.0` para desarrollo.

Las apps tienen identidades provisionales `bo.appdelivery.client` y `bo.appdelivery.driver`. Incorporan registro e inicio por teléfono, recuperación y sesión segura. La app del conductor permite presentar documentos y vehículos a revisión. En Debug se muestra el OTP devuelto por la API de desarrollo; el modo de desarrollo no se admite en producción. El diagnóstico se abre desde una ruta separada. Una compilación de producción debe recibir una URL HTTPS real y `APP_ENV=production`.

No se incluyen secretos en `--dart-define`: sus valores forman parte de la aplicación compilada. El dominio `api.example.invalid` usado en CI es un marcador de compilación, no un servicio desplegado.

## Entornos y datos

PostgreSQL/PostGIS utiliza `postgis/postgis:18-3.6` y conserva datos en `/var/lib/postgresql`, la ubicación del volumen para PostgreSQL 18. Redis usa `redis:8.4.7-alpine`, AOF y política `noeviction`. Ambos puertos se publican solo en `127.0.0.1`; son accesibles por la API local, no directamente por las apps móviles.

`npm run infra:down` detiene contenedores y conserva volúmenes. Para evitar pérdida de datos, los scripts no incluyen una eliminación de volúmenes. Cambiar nombre de base o credenciales en `.env` no modifica automáticamente un volumen de PostgreSQL ya inicializado.

Las pruebas con infraestructura pueden usar un proyecto Compose independiente, puertos 55432 y 56379 y volúmenes diferentes:

```powershell
npm run infra:test:up
$env:ENV_FILE = ".env.test"
npm run db:migrate
npm run infra:verify
$env:RUN_DB_INTEGRATION = "true"
npm run test --workspace @appdelivery/api
Remove-Item Env:RUN_DB_INTEGRATION
Remove-Item Env:ENV_FILE
npm run infra:test:down
```

`ENV_FILE` selecciona el archivo para las herramientas de la API. Los valores ya presentes en variables de entorno tienen precedencia. Si cambias puertos o credenciales, actualiza también `DATABASE_URL` y `REDIS_URL` del archivo correspondiente.

## Comprobaciones

```powershell
npm run typecheck
npm run format:check
npm test
npm run build
npm run api:openapi
npm run smoke -- --require-ready
```

Con la API iniciada y sin infraestructura, `npm run smoke` verifica el contrato y reporta el estado degradado; `--require-ready` exige que las tres dependencias estén disponibles.

En `packages/mobile_core`, `apps/client` y `apps/driver` ejecuta `flutter analyze` y `flutter test`. Para Android usa `flutter build apk --debug`; para iOS, en macOS, `flutter build ios --release --no-codesign` con la configuración HTTPS del entorno. La compilación sin firma comprueba el proyecto iOS y no lo publica.

El flujo [CI](.github/workflows/ci.yml) prepara comprobaciones de API/panel, migraciones repetibles, infraestructura real y builds Android/iOS. Su ejecución requiere alojar este código en GitHub y habilitar Actions; la presencia del archivo no significa que esos trabajos ya hayan pasado.

El alcance del producto está en [loop 0](docs/loop-0/README.md). La infraestructura inicial se documenta en [loop 1](docs/loop-1/README.md) y la entrega actual de identidad y habilitación en [loop 2](docs/loop-2/README.md).

## Control de versiones

El proyecto usa Git con la rama principal `main`. Se versionan el código de las cuatro aplicaciones, el paquete Flutter compartido, las migraciones, los contratos, la documentación, la configuración de ejemplo, el CI y los lockfiles. `.gitattributes` normaliza los finales de línea entre Windows, Linux y macOS.

Los archivos `.env`, secretos, SDK, dependencias, cachés, compilaciones y directorios locales `output` y `tmp` permanecen en el equipo y están excluidos mediante `.gitignore`. Un commit no respalda las bases de datos, los documentos privados cargados ni los secretos del entorno; requieren sus propias copias de respaldo.

```powershell
git status
git add .
git commit -m "Describe el cambio realizado"
git log --oneline
```

El repositorio es local. Para guardar otra copia en GitHub, GitLab u otro servidor, primero debe configurarse el remoto correspondiente.
