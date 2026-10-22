# AppDelivery Conductor

App Flutter Android/iOS de conductores. Bundle ID provisional: `bo.appdelivery.driver`.
El loop 2 incorpora registro, acceso y recuperación por teléfono, sesión segura,
perfil de conductor, carga privada de identidad/licencia y registro del vehículo,
alta/edición de vehículos, modalidades y envío a revisión. Muestra estados y
motivos; permite seleccionar un vehículo solo tras las aprobaciones necesarias.
Las modificaciones revisadas requieren nueva aprobación en el backend. El OTP
visible es exclusivamente de desarrollo y no envía SMS.
El loop 3 incorpora GPS en primer plano, disponibilidad real, propuestas manuales
del panel y el flujo de pasajeros: aceptar/rechazar, llegar al origen, validar el
PIN que entrega el pasajero, finalizar en destino y declarar efectivo recibido.
El perfil y los vehículos se conservan en **Perfil, documentos y vehículos**.

Desde esta carpeta:

```powershell
flutter pub get
flutter analyze
flutter test
flutter run --dart-define-from-file=config/development.android.json
```

Para el simulador iOS, usar `config/development.ios.json` desde macOS con Xcode.
Con Swift Package Manager, exportar `BYPASS_PERMISSION_LOCATION_ALWAYS=1`
antes de `flutter run` o `flutter build ios`, para compilar el plugin GPS con
permiso when-in-use y sin solicitud de ubicación permanente.
Para un teléfono físico, usar la IP LAN del backend:
`--dart-define=APP_ENV=development --dart-define=API_BASE_URL=http://IP_DEL_EQUIPO:3000/api/v1`.

HTTP local se permite solo en debug mediante configuración nativa por plataforma.
Release exige `APP_ENV=production` y API HTTPS. `config/production.example.json`
usa un dominio inválido de ejemplo que debe reemplazarse por el dominio operativo.
Los dart-defines son públicos; no incluir secretos, tokens ni claves privadas.

```powershell
flutter build apk --release --dart-define=APP_ENV=production --dart-define=API_BASE_URL=https://API_REAL/api/v1
```

La firma Android generada es de desarrollo. Configurar firma de distribución y
equipo/perfiles iOS antes de publicar. El código compartido y sus pruebas viven
en `packages/mobile_core`.
Android requiere API 23 y deshabilita copias automáticas del token cifrado. iOS
incluye entitlements Keychain y destino 15 (compatible con file_picker). Los
archivos PDF/JPEG/PNG se seleccionan con el selector del sistema, hasta 5 MiB,
sin permisos amplios de almacenamiento. La licencia y el registro requieren fecha
futura; el servidor mantiene la autoridad sobre vigencia y elegibilidad. Ver el
README del paquete compartido para comandos del SDK local y pruebas.

Para recibir propuestas debes tener cuenta, documentos, conductor y vehículo
aprobados, vehículo de pasajeros seleccionado, capacidad suficiente y ubicación
reciente con precisión aceptable. Al activar disponibilidad se solicita permiso
de ubicación y una posición real; si falla, la app no se declara en línea. El
panel operativo elige un candidato y la propuesta vence según el plazo de la API.

Con la app abierta, el estado se consulta cada ocho segundos y el GPS se renueva
cada 20–24 segundos. Al ocultarla se solicita desconexión, se detienen los sondeos
y se conserva el servicio actual. El servidor también impide disponibilidad con
GPS vencido. Este loop no ofrece ubicación ni recepción en segundo plano.
La llegada y finalización obtienen un nuevo GPS y el servidor comprueba cercanía
al origen/destino; no hay ubicación simulada de respaldo ni bypass de permisos.

Después de finalizar registra el importe realmente recibido para el viaje,
descontando el cambio: de Bs 0 al total, con dos decimales como máximo. La API
deriva impago/parcial/cobrado y acepta una declaración única. El historial permite
recuperar cobros pendientes tras reabrir. La conciliación corresponde al loop 9.
Los UUID de mutaciones pendientes permanecen en almacenamiento seguro para que
los reintentos no dupliquen estados o declaraciones. Una cuenta restringida puede
atender su viaje ya asignado y registrar su efectivo; no puede recibir otro.
