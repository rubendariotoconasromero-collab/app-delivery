# Estructura y entorno de desarrollo del loop 1

La estructura del proyecto está implementada para las apps de cliente y conductor, la API y el panel. La API y Angular se ejecutaron juntos y las apps Flutter comparten un cliente HTTP comprobado contra esa API real. La ejecución de PostgreSQL/PostGIS y Redis mediante Docker, y las compilaciones nativas Android/iOS, requieren herramientas no disponibles en este equipo.

Fecha de verificación local: 22 de octubre de 2026. Alcance funcional de referencia: [loop 0](../loop-0/README.md).

## Componentes entregados

| Ubicación | Contenido |
| --- | --- |
| `apps/api` | NestJS 12, TypeScript estricto, configuración validada, módulos de información y diagnóstico, OpenAPI, clientes PostgreSQL/Redis y migraciones SQL versionadas. |
| `apps/admin` | Angular 22.2 standalone, pantalla de inicio en español, proxy de desarrollo, respuesta real de la API, diagnóstico de dependencias y reintento. |
| `apps/client` | Flutter Android/iOS, identidad provisional `bo.appdelivery.client`, presentación para pasajeros y encomiendas y comprobación de conexión. |
| `apps/driver` | Flutter Android/iOS, identidad provisional `bo.appdelivery.driver`, presentación del conductor y comprobación de conexión. |
| `packages/mobile_core` | Configuración por entorno, modelos del contrato, cliente HTTP, errores y timeouts, componentes comunes en español. |
| `compose.yaml` | PostgreSQL 18 con PostGIS 3.6 y Redis 8.4.7; puertos publicados en loopback y volúmenes persistentes. |
| `scripts` | Creación de configuración sin sobrescritura, diagnóstico de herramientas, verificación HTTP y comprobación real de infraestructura. |
| `.github/workflows/ci.yml` | Verificación de formato, análisis, pruebas, builds, migraciones repetidas, PostGIS/Redis reales y compilaciones Android/iOS. Preparado; todavía no ejecutado en GitHub. |

Se conserva un lockfile npm en la raíz y lockfiles Flutter por app y paquete compartido. Los SDK, dependencias, archivos `.env`, cachés y resultados locales están excluidos del código mediante `.gitignore`. Los documentos y presupuestos previos permanecen en sus ubicaciones.

## Configuración y contratos

El mercado se configura como BO, Santa Cruz de la Sierra, moneda BOB, símbolo Bs y zona horaria America/La_Paz. El backend lee `.env` desde la raíz; `ENV_FILE` selecciona otro archivo y las variables del proceso tienen precedencia. Los mensajes de configuración y diagnóstico no exponen credenciales.

- `GET /api/v1/info` responde con entorno, mercado y modalidades.
- `GET /api/v1/health/live` comprueba que el proceso responde HTTP.
- `GET /api/v1/health/ready` comprueba PostgreSQL, extensión PostGIS y Redis; devuelve 200 o 503 con estados separados y espera acotada.
- `/api/docs` y `/api/docs-json` publican el contrato de desarrollo; la copia exportada está en [OpenAPI](../../apps/api/openapi/openapi.json).

Las pantallas consultan estos endpoints y distinguen la API disponible de sus dependencias disponibles. Con los contenedores apagados muestran un estado degradado real. Los loops posteriores incorporarán identidad y operaciones de negocio.

Para móviles, `APP_ENV` y `API_BASE_URL` se proporcionan mediante dart-defines o los JSON de `config` en cada app. Android emulador usa `10.0.2.2`; iOS simulador usa `localhost`. HTTP está habilitado únicamente en Debug y Release exige entorno production y HTTPS. Las URLs de producción de ejemplo son marcadores que deben reemplazarse.

## Comprobaciones realizadas

| Comprobación | Resultado local |
| --- | --- |
| NestJS: typecheck y build | Correctos; ejecutable en `apps/api/dist/main.js`. |
| NestJS: pruebas | 7 aprobadas: configuración, HTTP, CORS, diagnóstico, timeout real y consistencia de migraciones. La ruta saludable de las pruebas usa un probe sustituido. |
| Exportación OpenAPI | Correcta, sin requerir base ni Redis disponibles. |
| Angular: typecheck y build de producción | Correctos. |
| Angular: pruebas | 3 aprobadas: respuesta saludable, diagnóstico 503 y desconexión con reintento. |
| Panel contra NestJS real | Verificado en navegador; muestra mercado Santa Cruz/BOB y PostgreSQL/PostGIS/Redis no disponibles. |
| Flutter: dependencias y análisis | Correctos en cliente, conductor y mobile_core con Flutter 3.47.7 y Dart 3.13.5 locales. |
| Flutter: pruebas unitarias y widget | 15 aprobadas: 13 en mobile_core y una por app. |
| Flutter: integración HTTP | Una aprobada contra la API NestJS real: mercado BO/BOB y readiness degradado. Omitida por defecto para no exigir una API durante las pruebas unitarias. |
| Formato | Prettier correcto; Dart comprobó 14 archivos sin cambios pendientes. |
| npm audit | Cero vulnerabilidades reportadas después de fijar Vite 8.3.5 mediante override compatible con las dependencias instaladas. |
| Compose y CI | Sintaxis YAML válida; no equivale a ejecución del motor Docker ni de GitHub Actions. |
| Separación de entornos | `.env.test` selecciona puerto API 3001, base y Redis separados; smoke no consulta accidentalmente la API de desarrollo en 3000. |

Las conexiones de pruebas HTTP y el runner Flutter requirieron permisos de ejecución fuera del sandbox, que restringe sockets locales. No se cambió PATH persistente ni se instaló un SDK global. La compilación y pruebas usan dependencias públicas oficiales y cachés locales del proyecto.

## Pendientes para cerrar toda la validación de MVP 01

1. Instalar y ejecutar Docker con motor Linux y Compose en este equipo o usar un entorno que ya disponga de ellos.
2. Ejecutar `npm run infra:up`, aplicar `npm run db:migrate` dos veces, revisar `npm run db:status` y ejecutar `npm run infra:verify`.
3. Con la API activa, comprobar `npm run smoke -- --require-ready`. Debe informar las tres dependencias disponibles. Una respuesta 503 no cumple esta verificación.
4. Configurar Android SDK y JDK, y generar ambos APK con `flutter build apk --debug`. `flutter doctor` confirmó que el Android SDK no está disponible localmente.
5. En macOS con Xcode, compilar ambas apps iOS sin firma; configurar firma de distribución posteriormente cuando corresponda publicar.
6. Ejecutar el flujo CI al alojar el código en GitHub. El archivo está preparado, pero no hay un resultado remoto comprobado en esta entrega.

La prueba de migraciones comprueba archivos, orden y checksums; la aplicación contra PostgreSQL/PostGIS real queda pendiente. La verificación HTTP degradada y los tests con probe sustituido no se presentan como prueba de conectividad saludable.

## Comandos de trabajo

La guía completa está en [README principal](../../README.md). Para ejecutar API y panel después de instalar dependencias:

```powershell
npm run setup
npm ci
npm run dev:api
# En otra terminal:
npm run dev:admin
```

Para las pruebas Flutter, desde cada carpeta ejecutar `flutter pub get`, `flutter analyze` y `flutter test`. La integración HTTP opcional se ejecuta desde `packages/mobile_core` con la API activa:

```powershell
flutter test test/api_integration_test.dart --dart-define=RUN_API_INTEGRATION=true --dart-define=API_BASE_URL=http://127.0.0.1:3000/api/v1
```

La siguiente entrega funcional es el loop 2: cuentas, permisos y alta de conductores y vehículos. La estructura y los contratos de este loop permiten empezar ese desarrollo mientras se habilitan las herramientas de compilación e infraestructura pendientes.
