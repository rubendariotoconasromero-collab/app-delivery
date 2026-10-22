# AppDelivery Cliente

App Flutter Android/iOS de clientes. Bundle ID provisional: `bo.appdelivery.client`.
El loop 2 incorpora registro, acceso, recuperación por teléfono y cierre de sesión.
El token se restaura desde almacenamiento seguro y se valida contra `/auth/me`.
El OTP visible es exclusivamente de desarrollo, emitido por el backend; el modo
no envía SMS. La cuenta queda ligada al rol cliente, sin selección de roles del
personal.
El loop 3 permite seleccionar origen/destino en OpenStreetMap o introducir
coordenadas, escribir direcciones y referencias, indicar pasajeros, cotizar en Bs
y confirmar una solicitud con tarifa de prueba y pago en efectivo. OSRM calcula
la ruta por calles desde el backend; la app muestra el recorrido y el desglose.
El panel operativo propone un conductor; cuando acepta se muestran sus datos,
vehículo y el PIN privado para iniciar. El cliente puede cancelar antes del inicio,
renovar el PIN, recuperar un viaje activo al reabrir y consultar recibos recientes.
Las encomiendas corresponden a los siguientes loops.
El icono de diagnóstico conserva la consulta pública de `/info` y `/health/ready`.

Desde esta carpeta, con Flutter estable instalado o el SDK local `.tools/flutter`:

```powershell
flutter pub get
flutter analyze
flutter test
flutter run --dart-define-from-file=config/development.android.json
```

Para el simulador iOS, usar `config/development.ios.json` desde macOS con Xcode.
Con Swift Package Manager, exportar `BYPASS_PERMISSION_LOCATION_ALWAYS=1`
antes de `flutter run` o `flutter build ios`: el plugin GPS usa únicamente permiso
when-in-use en este loop y no debe incluir la solicitud de ubicación permanente.
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

Para probar un viaje, habilita `TRIP_DEVELOPMENT_ENABLED=true` en el backend,
configura cobertura/tarifas de prueba y ejecuta las migraciones. Después registra
y aprueba un conductor/vehículo de pasajeros, selecciona el vehículo y activa su
disponibilidad desde la app conductor. Las teselas se configuran en la API, usan
HTTPS y muestran atribución OSM. No hay geocodificación ni direcciones sugeridas;
la dirección introducida debe corresponder al punto elegido. La ubicación del
cliente es opcional: solo se solicita permiso al pulsar **Usar mi ubicación**.

La app sondea el estado cada ocho segundos mientras está abierta. Las mutaciones
guardan su UUID en almacenamiento seguro hasta recibir confirmación; un error de
red conserva la clave para reintentar y nunca presenta un viaje como confirmado.
El efectivo mostrado es una declaración del conductor, pendiente de conciliación.
El acceso restringido conserva la consulta/cancelación del viaje existente y
deshabilita nuevas solicitudes hasta una nueva sesión autorizada.
