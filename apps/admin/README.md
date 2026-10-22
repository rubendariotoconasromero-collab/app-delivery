# Panel administrativo

Angular standalone, TypeScript estricto y estilos SCSS. El loop 2 incorpora acceso del personal con contraseña y TOTP, revisión de conductores y vehículos, documentos privados y administración de roles y cuentas. El diagnóstico de NestJS, PostgreSQL/PostGIS y Redis se conserva en el inicio.

## Desarrollo

Desde la raíz del repositorio:

```powershell
npm install
npm run start --workspace @appdelivery/admin
```

Abrir http://127.0.0.1:4200. El proxy de desarrollo reenvía `/api/**` a `http://127.0.0.1:3000` (configuración en `proxy.conf.json`). El backend y sus dependencias deben iniciarse por separado según el README de la raíz.

## Acceso y operación

- `/login`: correo, contraseña y TOTP del personal. El administrador inicial se crea explícitamente mediante `staff:create` del backend; consultar sus opciones en `apps/api/scripts/create-staff.ts`. No hay cuenta ni secreto TOTP predeterminados. Los códigos de desarrollo por teléfono pertenecen a las apps móviles y no reemplazan el MFA del panel.
- `/`: inicio para cuentas activas `operator`, `finance` o `admin` con sesión del panel.
- `/conductores`: listado de administradores con filtro de revisión y páginas de hasta 50 registros.
- `/conductores/:id`: expediente de conductor, vehículos, documentación e historial. Aprobar o rechazar solicitudes pendientes y suspender aprobaciones requiere motivo y una confirmación en el formulario. El servidor valida los requisitos y devuelve el expediente actualizado; una aprobación no garantiza elegibilidad sin vehículo y documentos válidos.
- `/usuarios`: administración de roles y suspensión de cuentas, exclusiva de `admin`. Asignar un rol del personal no crea sus credenciales ni habilita acceso del panel mediante un token móvil.

El panel utiliza una cookie HttpOnly recibida del backend y conserva el token CSRF únicamente en memoria. Al recargar restaura la sesión desde `GET /auth/me`; no almacena contraseñas, TOTP ni tokens en localStorage. Las mutaciones a `/api/v1` incluyen `X-CSRF-Token`. Los HTTP 401 limpian la sesión y devuelven al acceso; HTTP 403 y conflictos se presentan sin simular éxito. El backend debe comprobar permisos en cada petición.

Los documentos se solicitan como Blob autenticado a `/documents/:id`. El operador autorizado prepara el archivo y usa el enlace temporal para abrirlo o descargarlo. Las URL temporales se revocan al cerrar su acceso, cambiar el expediente o destruir la pantalla. Ninguna ruta de disco se expone al navegador.

El panel consulta `GET /api/v1/info` y `GET /api/v1/health/ready`. Un HTTP 503 conserva el diagnóstico de las dependencias; una API desconectada se presenta como tal. El contexto estático de Santa Cruz/BOB está identificado como alcance del MVP y no reemplaza la respuesta del servidor.

## Validación

```powershell
npm run build --workspace @appdelivery/admin
npm run typecheck --workspace @appdelivery/admin
npm run test --workspace @appdelivery/admin
```

Las pruebas Vitest/JSDOM usan HttpTestingController para verificar restauración y expiración de sesión, contraseña/TOTP, CSRF, permisos por rol, revisiones, errores, documentos privados, administración de usuarios y diagnóstico. No requieren un backend real. Dentro de entornos sandbox cuyo directorio temporal desaparece entre llamadas, asignar TEMP y TMP a una carpeta persistente como `apps/admin/.angular/test-tmp` antes de ejecutar el runner.

Desde la raíz, en PowerShell:

```powershell
New-Item -ItemType Directory -Force -Path apps/admin/.angular/test-tmp | Out-Null
$env:TEMP = (Resolve-Path apps/admin/.angular/test-tmp).Path
$env:TMP = $env:TEMP
npm run test --workspace @appdelivery/admin
```

Estas variables se aplican únicamente al proceso de PowerShell actual y sus hijos; no cambian la configuración global de Windows.

## Despliegue posterior

`ng build` genera archivos estáticos en `dist/admin/browser`. En producción, configurar un reverse proxy HTTPS del mismo origen para `/api` y una regla de retorno a `index.html` para rutas del panel. El proxy del CLI solo funciona en desarrollo. Las cookies deben ser Secure en producción; la configuración correspondiente pertenece al backend. Los flujos de viajes, cobros y asignación pertenecen a los siguientes loops.
