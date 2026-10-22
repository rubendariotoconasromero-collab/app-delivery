# API NestJS — loop 1

API de desarrollo para pasajeros y encomiendas en Santa Cruz de la Sierra (BOB). Los módulos de negocio se implementan en los siguientes loops; este arranque no crea usuarios, viajes, pagos ni envíos ficticios.

Desde la raíz, después de instalar dependencias de los workspaces y copiar `.env.example` a `.env`:

```powershell
npm run start:dev --workspace @appdelivery/api
```

La configuración se lee desde `.env` en la raíz, sin depender del directorio actual; las variables del proceso tienen prioridad. `ENV_FILE=.env.test` selecciona otro archivo relativo a la raíz para el entorno de pruebas. Valores inválidos impiden arrancar y el mensaje identifica campos sin mostrar credenciales. PostgreSQL y Redis se conectan al consultar readiness: su indisponibilidad no bloquea el servidor.

| Recurso | Función |
| --- | --- |
| `GET /api/v1/info` | Metadatos de mercado y modalidades |
| `GET /api/v1/health/live` | Proceso activo; HTTP 200 sin dependencias |
| `GET /api/v1/health/ready` | PostgreSQL, extensión PostGIS y Redis; HTTP 200 o 503 |
| `/api/docs` | Interfaz OpenAPI |
| `/api/docs-json` | Documento OpenAPI en JSON |

Los chequeos limitan los tiempos de conexión/consulta. Una base accesible sin la extensión PostGIS da `postgres: up`, `postgis: down` y HTTP 503. Los orígenes web autorizados se declaran explícitamente en `CORS_ORIGINS`; CORS no sustituye la autenticación de futuros loops.

## Migraciones

Con PostgreSQL/PostGIS de desarrollo disponible:

```powershell
npm run db:status --workspace @appdelivery/api
npm run db:migrate --workspace @appdelivery/api
npm run db:migrate --workspace @appdelivery/api
```

La segunda ejecución no vuelve a aplicar SQL. `migrations/0001_enable_postgis.sql` habilita PostGIS si todavía no existe. La única tabla propia de este loop es `app_schema_migrations`, que registra versiones, nombres, checksums y fecha. Cada archivo se aplica en una transacción; un bloqueo asesor serializa migradores. Cambiar o quitar migraciones aplicadas, duplicar versiones o insertar versiones antiguas genera error. Añade archivos `NNNN_nombre.sql` posteriores; no edites archivos ya aplicados. No se incluyen operaciones de borrado ni rollback destructivo.

El usuario de desarrollo debe poder crear la extensión o esta debe estar preinstalada por el administrador de PostgreSQL. Los scripts están orientados al entorno de desarrollo y utilizan `tsx`, instalado como dependencia de desarrollo. No ejecutar migraciones automáticamente en cada réplica del servidor.

## Verificación

```powershell
npm run typecheck --workspace @appdelivery/api
npm run test --workspace @appdelivery/api
npm run build --workspace @appdelivery/api
npm run openapi:export --workspace @appdelivery/api
```

El documento exportado se guarda en `openapi/openapi.json` sin requerir PostgreSQL ni Redis activos. Las pruebas HTTP usan un servidor Nest real; comprueban el contrato, CORS, diagnóstico sin dependencias, timeout ante sockets que no responden y la ruta de readiness saludable con un probe sustituido. También se comprueba configuración sin filtración de secretos y consistencia de migraciones. La ruta saludable sustituida no demuestra conectividad real: debe verificarse con los servicios locales y las migraciones antes de cerrar la integración.

Los módulos se separan en `config`, `info`, `health` e `infrastructure`. `database` contiene el ejecutor de migraciones. `API_BIND_HOST=0.0.0.0` habilita acceso desde emuladores y red local; la URL usada por las apps se configura en cada aplicación. Este loop no incorpora autenticación ni habilita operaciones del negocio.
