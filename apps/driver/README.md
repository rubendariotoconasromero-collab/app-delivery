# AppDelivery Conductor

App Flutter Android/iOS de conductores. Bundle ID provisional: `bo.appdelivery.driver`.
El loop 2 incorpora registro, acceso y recuperación por teléfono, sesión segura,
perfil de conductor, carga privada de identidad/licencia y registro del vehículo,
alta/edición de vehículos, modalidades y envío a revisión. Muestra estados y
motivos; permite seleccionar un vehículo solo tras las aprobaciones necesarias.
Las modificaciones revisadas requieren nueva aprobación en el backend. El OTP
visible es exclusivamente de desarrollo y no envía SMS. Disponibilidad, GPS y
ofertas se implementan en loops posteriores.

Desde esta carpeta:

```powershell
flutter pub get
flutter analyze
flutter test
flutter run --dart-define-from-file=config/development.android.json
```

Para el simulador iOS, usar `config/development.ios.json` desde macOS con Xcode.
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
