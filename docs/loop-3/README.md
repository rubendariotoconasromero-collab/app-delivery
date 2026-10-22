# Loop 3: primer viaje de pasajeros

Implementación para desarrollo en Santa Cruz de la Sierra, Bolivia. Conecta la app cliente, la app conductor, NestJS, PostgreSQL y el panel Angular. El usuario confirmó OpenStreetMap/OSRM y tarifas de prueba. El [contrato compartido](../../contracts/loop-3.md) documenta las solicitudes y respuestas.

## Recorrido implementado

1. El cliente elige origen y destino en el mapa o introduce coordenadas, dirección y referencia. Puede seleccionar su ubicación actual con permiso del dispositivo. No se envían búsquedas de autocompletado a un geocodificador público.
2. NestJS valida cobertura y solicita a OSRM una ruta por calles. Guarda distancia, duración, geometría, tarifa, importe en centavos y vencimiento. Si no hay ruta válida, no cotiza ni sustituye el recorrido por una línea recta.
3. El cliente acepta la cotización y crea una solicitud. Una clave UUID permite recuperar el resultado sin crear otro viaje tras cortes de conexión. Solo mantiene un viaje activo.
4. Un operador o administrador abre `/viajes`, consulta candidatos compatibles y propone un conductor con motivo obligatorio. Solo aparecen habilitados para pasajeros, con capacidad suficiente, GPS reciente y disponibilidad efectiva.
5. El conductor recibe la propuesta en su app y acepta o rechaza. Una propuesta pendiente sigue en búsqueda; la aceptación confirma la asignación y la reserva exclusiva. Vencimiento o rechazo permiten otra propuesta dentro del plazo de búsqueda.
6. El conductor registra llegada cerca del origen, ingresa el código privado del cliente e inicia el viaje. Cinco intentos incorrectos bloquean ese código; el cliente puede renovarlo. El panel nunca recibe el código, aunque su cuenta también tenga rol cliente.
7. El conductor registra finalización cerca del destino. El servidor libera las reservas una sola vez. El viaje termina con el efectivo todavía pendiente de declaración.
8. El conductor declara cuánto recibió: total, parcial o cero. El registro es único por viaje, admite reintentos y queda pendiente de conciliación. Cliente, conductor y panel consultan el resultado por separado del estado del viaje.

Estados: `searching → assigned → arrived → in_progress → completed`. Se permite cancelar antes de iniciar, sin cargo automático. Una búsqueda vencida pasa a `no_driver`. Interrupciones, ausencia, reasignación avanzada y otras excepciones de pasajeros se amplían en el loop 7.

## Configuración de prueba

Ejecutar desde la raíz:

```powershell
npm run setup
npm run db:migrate
npm run dev:api
# En otra terminal:
npm run dev:admin
```

Las migraciones 0004/0005 incorporan cotizaciones, viajes, presencia, propuestas, efectivo, auditoría, comandos idempotentes y sesiones restringidas. Se conservan las migraciones previas. Las instrucciones de PostgreSQL/PostGIS y Redis y las compilaciones nativas siguen en el README principal y en los documentos de los loops 1 y 2.

`setup` añade opciones ausentes sin sobrescribir las existentes. `TRIP_DEVELOPMENT_ENABLED=true` habilita este recorrido de prueba; por defecto, sin esa opción, queda deshabilitado. La configuración de producción rechaza habilitar estas tarifas de desarrollo. La API publica la configuración vigente en `GET /api/v1/trips/config`.

| Parámetro inicial | Valor de prueba |
| --- | --- |
| Moneda | BOB; interfaz Bs con dos decimales. |
| Base | Bs 5,00. |
| Distancia | Bs 2,00 por km calculado por OSRM. |
| Tiempo | Bs 0,25 por minuto estimado por OSRM. |
| Mínimo | Bs 8,00 aplicado al total. |
| Cotización | 180 segundos. |
| Búsqueda | 600 segundos; el precio aceptado permanece congelado. |
| Propuesta | 60 segundos como máximo y nunca más allá de la búsqueda. |
| GPS | Hasta 60 segundos y precisión máxima de 100 m. |
| Proximidad de hitos | Hasta 200 m del punto contratado. |
| Cobertura | Rectángulo configurable: latitud −17,90 a −17,65; longitud −63,30 a −63,02. |

La cobertura es un área de prueba, no el polígono operativo definitivo. Los importes son parámetros técnicos confirmados para probar el flujo, no tarifas comerciales aprobadas. Cambiarlos no modifica precios ya aceptados.

`TRIP_OSRM_URL` y `TRIP_MAP_TILE_URL` permiten sustituir los proveedores. La ruta por defecto usa el servidor de demostración OSRM exclusivamente para pruebas no comerciales; respetamos su [política de uso](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server), incluido el máximo de una consulta por segundo. El piloto comercial necesitará una instancia propia o un proveedor adecuado. La integración sigue el [protocolo OSRM](https://project-osrm.org/docs/v5.24.0/api/).

Los mapas muestran atribución y usan HTTPS, identificación de aplicación y caché. No hay descarga masiva ni función offline de teselas públicas. Consultar la [política de OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/) antes de modificar el proveedor o su caché.

## Consistencia y permisos

- PostgreSQL es la autoridad para reservas, precios, códigos y dinero. Los índices únicos y locks evitan dos viajes activos por cliente/conductor y propuestas incompatibles simultáneas. La integridad no depende de que Redis conserve una clave.
- Los cambios de perfil, documentos y selección de vehículo se bloquean durante una propuesta pendiente o un viaje activo. Una revisión administrativa puede suspender la habilitación y bloquear servicios nuevos conservando el recorrido existente.
- Suspender una cuenta apaga su disponibilidad y revoca el panel. Si tiene un servicio activo, conserva únicamente las sesiones móviles necesarias para consultarlo, atenderlo y declarar un cobro pendiente. No puede contratar ni aceptar trabajo nuevo. Reactivar la cuenta no eleva una credencial restringida: requiere iniciar una nueva sesión.
- Cerrar sesión apaga la disponibilidad del conductor y revoca la credencial; no cancela el viaje. Desconectarse tampoco abandona una asignación.
- Cada comando sensible usa UUID y valida que un reintento conserve operación y datos. Su respuesta se reconstruye desde el estado vigente. Los resultados guardados se cifran para no persistir códigos privados en texto plano.
- Flutter conserva las claves de reintento en almacenamiento seguro, por cuenta/app/API. Angular conserva las acciones inciertas en sessionStorage por usuario y viaje, sin credenciales. La interfaz distingue errores de resultados confirmados.
- PIN, consultas, ofertas y archivos respetan propiedad y tipo de sesión. Solo el cliente propietario en sesión móvil recibe el código; operador/admin requieren cookie del panel, MFA y CSRF para operar.

El sondeo y el GPS en primer plano permiten esta primera entrega. Ubicación en segundo plano, notificaciones y continuidad avanzada corresponden a los loops 4 y 6.

## Verificación

Validación realizada el 22 de octubre de 2026:

| Componente | Resultado |
| --- | --- |
| API NestJS | 24 pruebas aprobadas, incluidas integraciones HTTP con PostgreSQL real; typecheck y build correctos. |
| Panel Angular | 32 pruebas aprobadas; typecheck y compilación de producción correctos. |
| Flutter | 41 pruebas distintas aprobadas entre el paquete compartido y ambas apps; análisis sin incidencias en los tres proyectos. Una integración HTTP opcional omitida. |
| Contrato y formato | OpenAPI regenerado, Prettier y `git diff --check` correctos. |
| Panel con API local | Propuesta creada desde la interfaz, aceptación por conductor, finalización con PIN y declaración de Bs 8,76 verificadas. |

La comprobación del panel usó cuentas, teléfonos, documentos y posiciones ficticios creados exclusivamente para QA. La cotización consultó OSRM real. Las acciones del conductor se ejercitaron por HTTP contra la API local; no se simula que se haya ejecutado Flutter en un dispositivo. Los datos y credenciales temporales se retiraron al terminar. Se conservan capturas del [estado final](panel-viaje.png) y del [efectivo declarado](panel-efectivo.png).

Las pruebas de PostgreSQL y HTTP cubren el recorrido completo, reintentos concurrentes, precio en centavos, protección de propietarios, reserva exclusiva, propuesta frente a aceptación, GPS, cinco intentos de código, renovación, suspensión durante el recorrido, finalización y efectivo independiente. También verifican permisos de una identidad con roles cliente/personal y que el cierre de sesión apague la disponibilidad.

Los tests de proveedor usan un servidor HTTP local con fixtures OSRM explícitos: no hay sustituto ficticio en la aplicación ejecutada. Se verificó además OSRM público con dos puntos públicos ficticios de Santa Cruz: respuesta válida, ruta por calles de aproximadamente 1,513 km y geometría de 30 puntos. No se ejecutan pruebas de carga contra servicios públicos.

Para ejecutar las integraciones con la base de pruebas:

```powershell
$env:ENV_FILE = '.env.test'
npm run db:migrate
$env:RUN_DB_INTEGRATION = 'true'
npm run test --workspace @appdelivery/api
Remove-Item Env:RUN_DB_INTEGRATION
Remove-Item Env:ENV_FILE
```

Las pruebas del panel y Flutter se describen en sus README. Los builds iOS deben recibir `BYPASS_PERMISSION_LOCATION_ALWAYS=1`, como configura el CI, porque este loop solicita ubicación solo durante el uso de la app.

En este equipo la validación de datos usa PostgreSQL local real con los esquemas 0002–0005; Docker/PostGIS/Redis y los builds nativos continúan pendientes del entorno. Esto no equivale a haber comprobado las migraciones espaciales completas ni el GPS o los permisos en dispositivos reales. Antes de un piloto deben verificarse esos componentes y conectar SMS real.
