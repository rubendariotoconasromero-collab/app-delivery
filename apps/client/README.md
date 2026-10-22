# AppDelivery Cliente

App Flutter Android/iOS de clientes. Bundle ID provisional: `bo.appdelivery.client`.
El loop 2 incorpora registro, acceso, recuperación por teléfono y cierre de sesión.
El token se restaura desde almacenamiento seguro y se valida contra `/auth/me`.
El OTP visible es exclusivamente de desarrollo, emitido por el backend; el modo
no envía SMS. La cuenta queda ligada al rol cliente, sin selección de roles del
personal. Las solicitudes de viajes y envíos pertenecen a los loops siguientes.
El icono de diagnóstico conserva la consulta pública de `/info` y `/health/ready`.

Desde esta carpeta, con Flutter estable instalado o el SDK local `.tools/flutter`:

```powershell
flutter pub get
flutter analyze
flutter test
flutter run --dart-define-from-file=config/development.android.json
```

Para el simulador iOS, usar `config/development.ios.json` desde macOS con Xcode.
En un teléfono físico, pasar la dirección LAN del backend mediante
`--dart-define=APP_ENV=development --dart-define=API_BASE_URL=http://IP_DEL_EQUIPO:3000/api/v1`.
Ambos dispositivos deben tener conectividad entre sí y el puerto debe ser accesible.

Los valores por defecto son Android emulador `10.0.2.2:3000` e iOS `localhost:3000`.
En iOS la excepción HTTP vive únicamente en `Runner/Info-Debug.plist`; Android
habilita HTTP únicamente en el manifest de debug. Release exige entorno production
y HTTPS, y conserva las protecciones nativas de transporte.

Producción requiere reemplazar el dominio de ejemplo; `production.example.json`
no apunta a un servicio existente. Los dart-defines se incorporan al binario: nunca
incluir secretos, tokens ni claves privadas.

```powershell
flutter build apk --release --dart-define=APP_ENV=production --dart-define=API_BASE_URL=https://API_REAL/api/v1
```

El proyecto generado usa la firma debug de Flutter para builds locales. Configurar
firma de distribución Android y equipo/perfiles iOS antes de publicar en tiendas.
Los componentes y el cliente HTTP compartidos están en `packages/mobile_core`.
Android requiere API 23 y deshabilita copias automáticas del token cifrado. iOS
incluye entitlements de Keychain y mantiene destino 15. Consultar el README del
paquete compartido para comandos del SDK local y límites de validación nativa.
