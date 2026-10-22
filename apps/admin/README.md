# Panel administrativo

Angular standalone, TypeScript estricto y estilos SCSS. El loop 3 incorpora operación de viajes de pasajeros con asignación manual, mapa del recorrido, hitos, efectivo declarado y auditoría. Se conservan el acceso con contraseña/TOTP, revisión de conductores y vehículos, documentos privados, administración de cuentas y diagnóstico de infraestructura del loop 2.

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
- `/viajes`: solicitudes e historial operativo para `operator` y `admin`, con filtro por estado y páginas de 50 registros. La lista consulta al servidor cada 15 segundos mientras la página está visible y permite actualización manual.
- `/viajes/:id`: origen/destino, ruta OSRM, tarifa contratada en Bs, candidato/asignación, hitos, declaración de efectivo e historial. La propuesta manual exige conductor disponible y motivo; reserva al candidato, pero el viaje continúa buscando hasta que el conductor acepta desde su app. Si rechaza o vence la oferta, se pueden consultar otros candidatos dentro del plazo de búsqueda. El panel puede cancelar antes del inicio con motivo; no cambia el precio ni registra el efectivo por el conductor.
- `/conductores`: listado de administradores con filtro de revisión y páginas de hasta 50 registros.
- `/conductores/:id`: expediente de conductor, vehículos, documentación e historial. Aprobar o rechazar solicitudes pendientes y suspender aprobaciones requiere motivo y una confirmación en el formulario. El servidor valida los requisitos y devuelve el expediente actualizado; una aprobación no garantiza elegibilidad sin vehículo y documentos válidos.
- `/usuarios`: administración de roles y suspensión de cuentas, exclusiva de `admin`. Asignar un rol del personal no crea sus credenciales ni habilita acceso del panel mediante un token móvil.

El panel utiliza una cookie HttpOnly recibida del backend y conserva el token CSRF únicamente en memoria. Al recargar restaura la sesión desde `GET /auth/me`; no almacena contraseñas, TOTP ni tokens en localStorage. Las mutaciones a `/api/v1` incluyen `X-CSRF-Token`. Los HTTP 401 limpian la sesión y devuelven al acceso; HTTP 403 y conflictos se presentan sin simular éxito. El backend debe comprobar permisos en cada petición.

Las propuestas y cancelaciones guardan temporalmente su UUID y payload en `sessionStorage`, separados por cuenta, viaje y operación. Si hay un error de red o un HTTP 5xx, se conserva el mismo intento; al recargar se consulta el estado vigente y se recupera la acción pendiente. Un reintento conserva UUID y contenido. Los resultados confirmados, errores definitivos, cierre de sesión y HTTP 401 limpian los intentos correspondientes. Este almacenamiento no contiene credenciales.

El mapa muestra las teselas y la atribución configuradas por `GET /trips/config` y el recorrido guardado al cotizar. Es una vista encuadrada del recorrido contratado; no representa seguimiento GPS del conductor en tiempo real. Se usan las cachés normales del navegador y no se descargan mapas para uso sin conexión. El panel nunca presenta el PIN del pasajero. El efectivo distingue pendiente, declarado cobrado, parcial e impago; una declaración permanece pendiente de conciliación financiera, que corresponde a un loop posterior.

Los documentos se solicitan como Blob autenticado a `/documents/:id`. El operador autorizado prepara el archivo y usa el enlace temporal para abrirlo o descargarlo. Las URL temporales se revocan al cerrar su acceso, cambiar el expediente o destruir la pantalla. Ninguna ruta de disco se expone al navegador.

El panel consulta `GET /api/v1/info` y `GET /api/v1/health/ready`. Un HTTP 503 conserva el diagnóstico de las dependencias; una API desconectada se presenta como tal. El contexto estático de Santa Cruz/BOB está identificado como alcance del MVP y no reemplaza la respuesta del servidor.

## Validación

```powershell
npm run build --workspace @appdelivery/admin
npm run typecheck --workspace @appdelivery/admin
npm run test --workspace @appdelivery/admin
```

Las pruebas Vitest/JSDOM usan HttpTestingController para verificar sesión, MFA, CSRF, permisos por rol, revisiones, documentos privados, usuarios y diagnóstico. Para viajes verifican propuestas pendientes sin asignación simulada, conflictos, UUID estable al recuperar un intento tras recarga, efectivo separado, cancelaciones, filtros y encuadre del mapa. No requieren un backend real. Dentro de entornos sandbox cuyo directorio temporal desaparece entre llamadas, asignar TEMP y TMP a una carpeta persistente como `apps/admin/.angular/test-tmp` antes de ejecutar el runner.

Desde la raíz, en PowerShell:

```powershell
New-Item -ItemType Directory -Force -Path apps/admin/.angular/test-tmp | Out-Null
$env:TEMP = (Resolve-Path apps/admin/.angular/test-tmp).Path
$env:TMP = $env:TEMP
npm run test --workspace @appdelivery/admin
```

Estas variables se aplican únicamente al proceso de PowerShell actual y sus hijos; no cambian la configuración global de Windows.

## Despliegue posterior

`ng build` genera archivos estáticos en `dist/admin/browser`. En producción, configurar un reverse proxy HTTPS del mismo origen para `/api` y una regla de retorno a `index.html` para rutas del panel. El proxy del CLI solo funciona en desarrollo. Las cookies deben ser Secure en producción; la configuración correspondiente pertenece al backend. El modo de viajes y sus tarifas de este loop son de desarrollo; cobertura operativa definitiva, asignación automática, seguimiento en segundo plano y conciliación se incorporan en los siguientes loops.
