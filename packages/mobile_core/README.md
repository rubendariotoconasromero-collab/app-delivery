# mobile_core

Paquete Flutter compartido por cliente y conductor. Incluye configuración pública
por dart-defines, modelos de mercado/disponibilidad, cliente HTTP con timeout y
errores traducidos, autenticación por OTP, habilitación de conductores y viajes
de pasajeros del loop 3.

Loop 2: las apps fijan su rol público (`client`/`driver`), registran o recuperan
el acceso por teléfono E.164 y verifican desafíos emitidos por el backend. El
código de desarrollo solo se muestra con `kDebugMode` y `APP_ENV=development`.
El servidor sigue siendo responsable de vencimiento, intentos y permisos.

`SessionController` restaura mediante `/auth/me`, comprueba rol, estado y fecha,
vence la sesión localmente y elimina el token ante un 401. `SessionStore` permite
dobles en tests; la implementación real usa `flutter_secure_storage` 11.2.0:
Keychain en iOS y almacenamiento cifrado en Android. No se usa almacenamiento
plano ni se imprimen credenciales. El cierre requiere revocación en el servidor;
si falta conexión se presenta el error y puede reintentarse.

`file_picker` 13.1.0 selecciona documentos del sistema sin permisos generales
de archivos ni rutas públicas. Se valida tamaño (5 MiB) y tipo permitido antes
de subir mediante multipart autenticado; el backend verifica contenido y reglas.
La selección de un vehículo es distinta de ponerse en línea; el módulo de viajes
comprueba ambas condiciones mediante la API.

Loop 3: `PassengerTrips` permite seleccionar puntos en OpenStreetMap, introducir
referencias, cotizar con OSRM en el backend, confirmar, recuperar/cancelar y
consultar el PIN privado. `DriverTrips` atiende propuestas, llegada, inicio con
PIN, finalización y efectivo exacto en centavos. Los recibos distinguen declaración
de cobro y conciliación. Se consulta `/auth/me` durante el sondeo para limitar
nuevas acciones tras suspensión; se conserva el viaje existente con el token
restringido hasta su cierre, según autorización del servidor.

`TripApi` incorpora idempotencia a todas las mutaciones de servicio.
`SecureTripJournal` conserva UUID por operación/usuario/API en almacenamiento
seguro ante resultados inciertos, incluso tras reconstruir la app; las claves se
derivan con SHA-256 y no exponen el PIN. Solo se eliminan tras respuesta confirmada.
Los tests inyectan `MemoryTripJournal`, que nunca guarda sesiones reales.

`flutter_map` 8.3.2 usa la URL HTTPS recibida de la API, identificación de app,
atribución visible y caché nativa según cabeceras HTTP (siete días si faltan).
No hay descarga masiva ni precarga offline. `geolocator` 14.1.2 pide ubicación
cuando se usa la app, valida frescura/precisión y no sustituye posiciones si se
deniega acceso. Android declara permisos coarse/fine; iOS incluye la explicación
when-in-use tanto en Info.plist como Info-Debug.plist. No se solicita ubicación
en segundo plano. La implementación sigue las [APIs de flutter_map](https://pub.dev/packages/flutter_map),
[geolocator](https://pub.dev/packages/geolocator) y la [política de teselas OSM](https://operations.osmfoundation.org/policies/tiles/).
En macOS/Xcode con Swift Package Manager, exportar
`BYPASS_PERMISSION_LOCATION_ALWAYS=1` al ejecutar/compilar iOS, según el
`Package.swift` del plugin; evita compilar la solicitud permanente no utilizada.

Android tiene minSdk 23 y copias automáticas deshabilitadas para evitar copiar
material cifrado no restaurable. iOS mantiene destino 15 y entitlements Keychain
de cada app. Las compilaciones nativas requieren Android SDK/JDK o macOS/Xcode;
las pruebas de canal seguro no reemplazan una prueba en dispositivos reales.

El mercado mostrado por la conexión se obtiene de `/api/v1/info`. La disponibilidad
consulta `/api/v1/health/ready`: 200 significa disponible, 503 significa degradado.
El paquete valida estados, dependencias y estructura JSON antes de mostrarlos.

```powershell
flutter pub get
flutter analyze
flutter test
```

Las pruebas usan `http.MockClient` para comprobar parsing, respuestas inválidas,
errores de red, timeout, estado degradado y la recuperación mediante Reintentar.
También cubren contrato OTP/recuperación, persistencia segura, restauración,
vencimiento, 401, fallos de almacenamiento, subida privada y formularios de alta.
Loop 3 añade el recorrido de cotización/confirmación/PIN del cliente, aceptación,
GPS, llegada, PIN fallido/correcto, finalización y efectivo parcial del conductor,
GPS denegado, cálculo exacto de centavos, reintento de una petición incierta con
el mismo UUID y reconstrucción del journal seguro. No reemplazan una prueba con
la API, PostGIS y Redis ejecutándose ni permisos reales en dispositivos.

Con el backend iniciado, la prueba opcional de contrato real se ejecuta así:

```powershell
flutter test test/api_integration_test.dart --dart-define=RUN_API_INTEGRATION=true --dart-define=API_BASE_URL=http://127.0.0.1:3000/api/v1
```

Está omitida por defecto para que las pruebas normales no dependan de red.
Acepta disponibilidad degradada (503) y comprueba el contrato del backend real;
la disponibilidad completa requiere que PostgreSQL/PostGIS y Redis estén activos.

En este workspace Windows puede usarse el SDK local sin el wrapper `.bat`:

```powershell
# Ejecutar desde la raíz del repositorio y conservar estas variables para las tres carpetas.
$env:PUB_CACHE = "$PWD/.cache/pub-cache"
$env:TEMP = "$PWD/.cache/flutter-temp"
$env:TMP = $env:TEMP
$env:APPDATA = "$PWD/.cache/flutter-roaming"
$env:LOCALAPPDATA = "$PWD/.cache/flutter-local"
$env:CI = 'true'
$taskDart = "$PWD/.tools/flutter/bin/cache/dart-sdk/bin/dart.exe"
$taskFlutter = "$PWD/.tools/flutter/bin/cache/flutter_tools.snapshot"
Push-Location packages/mobile_core
& $taskDart $taskFlutter pub get
& $taskDart $taskFlutter analyze --no-pub
& $taskDart $taskFlutter test --no-pub
Pop-Location
# Repetir los tres comandos desde apps/client y apps/driver.
```
