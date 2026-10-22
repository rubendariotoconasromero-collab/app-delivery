# Loop 2: identidad, permisos y habilitación

Entrega de desarrollo del 22 de octubre de 2026 para Santa Cruz de la Sierra, Bolivia. Usa las apps Flutter, API NestJS y panel Angular creados en el loop 1. El [contrato](../../contracts/loop-2.md) describe los endpoints; la documentación ejecutable está en `/api/docs` y la [exportación OpenAPI](../../apps/api/openapi/openapi.json).

## Funcionalidad entregada

- Cliente y conductor: registro, acceso y recuperación por teléfono E.164. Un teléfono mantiene una identidad y puede registrar ambos roles mediante verificación. El cliente público solo puede solicitar `client` o `driver`.
- OTP de desarrollo aleatorio de seis dígitos, vencimiento de cinco minutos, un solo uso atómico y cinco intentos. Reenvío mínimo de 60 segundos, cinco solicitudes por teléfono/hora y límites persistentes por IP. El código se guarda como HMAC, nunca en texto plano.
- Sesión móvil revocable de siete días; restauración, caducidad y cierre. Flutter guarda la credencial en Keychain/almacenamiento seguro de Android. HTTP 401 elimina la sesión local. Recuperar la cuenta revoca las sesiones móviles anteriores.
- Personal: acceso con correo, contraseña scrypt y TOTP real, sesión de doce horas en cookie HttpOnly/SameSite Strict, Secure en producción y CSRF en mutaciones. El código TOTP no puede reutilizarse. El panel restaura la sesión con `/auth/me` y mantiene CSRF en memoria.
- Conductor: nombre legal separado del alias, documento de identidad, licencia vigente, vehículos, capacidad y modalidades de pasajeros/encomiendas. Registro del vehículo con vencimiento obligatorio. Envío a revisión y visualización del motivo de rechazo o suspensión.
- Administrador: listar expedientes y usuarios con paginación, consultar archivos privados, aprobar/rechazar/suspender con motivo obligatorio y administrar roles/estado. Las decisiones registran responsable y fecha. Las suspensiones de cuenta revocan las sesiones; los permisos se consultan en cada petición.

No hay cuentas, contraseñas ni códigos MFA predeterminados. Otorgar un rol del personal a una identidad móvil no habilita el acceso al panel sin credenciales del personal y MFA.

## Roles y estados

| Rol | Permisos de este loop |
| --- | --- |
| `client` | Cuenta y sesión de la app cliente. |
| `driver` | Su propio perfil, archivos y vehículos; envío a revisión y selección de vehículo aprobado. |
| `operator`, `finance` | Acceso autenticado al inicio y diagnóstico del panel. Sus funciones operativas y financieras llegan en loops posteriores. |
| `admin` | Revisión de conductores/vehículos, documentos privados y administración de usuarios. Requiere sesión del panel con MFA. |

Los estados de conductor y vehículo son `draft`, `pending`, `approved`, `rejected`, `suspended`. Aprobar o rechazar exige estado pendiente. Cambiar nombre legal, datos de vehículo o documentos devuelve el recurso a borrador e invalida la selección activa afectada. El administrador no puede cambiar sus propios roles ni suspenderse; también se protege la permanencia de un administrador activo.

La habilitación exige cuenta activa con rol conductor, perfil aprobado, vehículo aprobado seleccionado y documentos actuales vigentes. El vencimiento se evalúa en America/La_Paz en cada consulta y activación. El expediente se lee con una instantánea transaccional consistente; las mutaciones de un conductor se serializan mediante locks de PostgreSQL. El loop 3 deberá exigir nuevamente esta habilitación al aceptar servicios.

Los archivos admiten PDF, JPEG y PNG, comprobando la firma del contenido, hasta 5 MiB. El límite acumulado es de 100 documentos y 100 MiB por conductor, incluidos históricos. Solo el propietario o un administrador con sesión del panel acceden a la descarga; las rutas de disco no se exponen. El reemplazo conserva el archivo anterior como evidencia. `UPLOAD_DIR` requiere respaldo junto con PostgreSQL; en despliegues con varias instancias deberá usarse almacenamiento privado compartido.

La lista de documentos implementa el alcance técnico del MVP; confirmar las exigencias documentales locales antes del lanzamiento comercial sigue pendiente del loop 0.

## Preparación y administrador inicial

Desde la raíz, con PostgreSQL/PostGIS y Redis disponibles según el README principal:

```powershell
npm ci
npm run setup
npm run infra:up
npm run db:migrate
```

`setup` genera secretos diferentes para desarrollo y pruebas, sin imprimirlos ni reemplazar los existentes. Conservar `AUTH_SECRET`: cifra los secretos TOTP del personal; cambiarlo sin migración invalida sus inscripciones. `.env` y `.env.test` están excluidos del código.

Para crear el administrador, guarda una contraseña propia de al menos 14 caracteres en un archivo local protegido, por ejemplo `.cache/admin-password.txt`. Después ejecuta:

```powershell
npm run staff:create -- --email admin@tu-dominio.bo --name "Administración" --roles admin --password-file .cache/admin-password.txt --mfa-output .cache/admin-mfa.json
```

El CLI crea la cuenta y escribe la inscripción TOTP en un archivo nuevo con acceso restringido donde el sistema lo permite; nunca imprime la contraseña ni el secreto. Importa el `otpauthUri` o `secret` en una aplicación de autenticación y resguarda su copia de recuperación. Retira los archivos locales de provisión y contraseña una vez inscritos y respaldados. Si hay un error de conexión con resultado incierto, verifica la cuenta antes de repetir: el archivo MFA se conserva para evitar perder la inscripción tras un COMMIT confirmado sin respuesta.

Inicia API y panel en terminales separadas:

```powershell
npm run dev:api
npm run dev:admin
```

Abre `http://127.0.0.1:4200/login`, ingresa las credenciales del personal y un código TOTP actual. Las rutas `/conductores` y `/usuarios` son exclusivas de administradores. En producción sirve el panel y `/api` bajo el mismo origen HTTPS mediante reverse proxy; el proxy del CLI Angular solo funciona en desarrollo.

Las apps se ejecutan con los comandos de sus respectivos README. Registra el teléfono con prefijo `+591`, solicita el código y usa el OTP mostrado en Debug. En la app conductor completa el perfil, adjunta los documentos, registra y presenta el vehículo; envía ambos a revisión. En el panel revisa el expediente y confirma cada decisión con motivo. Después selecciona el vehículo aprobado desde la app conductor.

`AUTH_OTP_DELIVERY=development` responde con `developmentCode`, según lo solicitado para este loop. El backend rechaza esta configuración en producción. Con `disabled`, el teléfono devuelve 503 hasta conectar un proveedor de SMS. La sesión del personal con TOTP funciona independientemente del proveedor de SMS.

## Verificación

| Comprobación | Resultado local |
| --- | --- |
| API: pruebas unitarias, HTTP e integración PostgreSQL | 17 aprobadas, incluidas dos pruebas integrales con PostgreSQL real. |
| Panel Angular | 21 pruebas aprobadas; typecheck y build de producción correctos. |
| Flutter: mobile_core y ambas apps | 29 pruebas aprobadas; análisis sin incidencias. Una integración HTTP opcional omitida por defecto. |
| TypeScript API y exportación OpenAPI | Typecheck y compilación correctos; contrato exportado. |
| Panel conectado a la API y PostgreSQL reales | Acceso con TOTP, revisión de conductor y vehículo, habilitación, filtros, navegación, documento privado y cierre de sesión comprobados en navegador. |

La integración verifica consumo concurrente del OTP, expiración, bloqueo tras cinco fallos, recuperación, MFA y su antirrepetición, CSRF, permisos inmediatos, aislamiento entre propietarios, archivos privados, aprobación de conductor y vehículo, activación, documentos vencidos, invalidación por reemplazo, historial y cuotas de almacenamiento.

La prueba visual usó cuentas y documentos ficticios, retirados después de comprobar el resultado. La [captura local](../../.cache/loop-2-admin.png) muestra el estado aprobado/habilitado alcanzado. El panel queda en la pantalla de acceso; crea tu propia cuenta administrativa con el CLI descrito arriba.

Para repetir con el entorno de pruebas aislado:

```powershell
npm run infra:test:up
$env:ENV_FILE = '.env.test'
npm run db:migrate
$env:RUN_DB_INTEGRATION = 'true'
npm run test --workspace @appdelivery/api
Remove-Item Env:RUN_DB_INTEGRATION
Remove-Item Env:ENV_FILE
```

Sin el indicador explícito, las dos integraciones de base se omiten. Las pruebas requieren sockets locales; las de Angular pueden necesitar un TEMP/TMP persistente, como explica [su README](../../apps/admin/README.md). El CI ejecuta las integraciones después de migrar la base PostGIS; su configuración no equivale a un resultado remoto ejecutado.

En este equipo se verificaron los esquemas 0002/0003 con PostgreSQL 18.4 temporal en loopback y bases separadas, instalado únicamente dentro de `.tools` y `.cache`. Docker, PostGIS y Redis 8 siguen pendientes del entorno del loop 1; no se declara probado aquí el conjunto completo de migraciones ni la consulta espacial. Las bases temporales ocupan los puertos 5432 y 55432; antes de iniciar Compose se pueden detener desde la raíz:

```powershell
& .tools/postgres/package/native/bin/pg_ctl.exe -D .cache/postgres-loop2-dev stop -m fast
& .tools/postgres/package/native/bin/pg_ctl.exe -D .cache/postgres-loop2-test stop -m fast
```

También quedan pendientes las compilaciones y la validación del almacenamiento seguro/selector de archivos en dispositivos Android/iOS, por falta de Android SDK/JDK y macOS/Xcode locales. Los proyectos nativos y el CI incluyen esos builds. Asignación, disponibilidad, ubicación, solicitudes, viajes, encomiendas y cobros operativos corresponden a los siguientes loops.
