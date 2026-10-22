import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:mobile_core/mobile_core.dart';
import 'fixtures.dart';
import 'trip_fixtures.dart';

void main() {
  testWidgets(
    'registro por OTP conserva errores, autentica y permite cerrar sesión',
    (tester) async {
      var verifies = 0;
      final store = FakeSessionStore();
      final api = ApiClient(
        config: ApiConfig(baseUrl: Uri.parse('http://localhost:3000/api/v1')),
        httpClient: MockClient((request) async {
          if (request.url.path.endsWith('/request')) {
            final body = jsonDecode(request.body) as Json;
            expect(body['role'], 'client');
            expect(body['purpose'], 'register');
            expect(body['displayName'], 'María');
            return utf8Response(
              '{"challengeId":"challenge-1","expiresIn":300,"retryAfter":60,"developmentCode":"928104"}',
              202,
            );
          }
          if (request.url.path.endsWith('/verify')) {
            verifies++;
            if (verifies == 1) {
              return utf8Response('{"message":"Código incorrecto"}', 400);
            }
            return utf8Response(
              jsonEncode({
                'accessToken': 'token',
                'expiresAt': DateTime.now()
                    .add(const Duration(hours: 1))
                    .toIso8601String(),
                'user': userJson,
              }),
              200,
            );
          }
          if (request.url.path.endsWith('/config')) {
            return utf8Response(
              jsonEncode(tripConfig()..['enabled'] = false),
              200,
            );
          }
          if (request.url.path.endsWith('/me')) {
            return utf8Response(
              jsonEncode({
                'user': userJson,
                'expiresAt': DateTime.now()
                    .add(const Duration(hours: 1))
                    .toUtc()
                    .toIso8601String(),
                'restricted': false,
              }),
              200,
            );
          }
          if (request.url.path.endsWith('/active')) {
            return utf8Response('{"trip":null}', 200);
          }
          if (request.url.path.endsWith('/trips')) {
            return utf8Response('{"items":[]}', 200);
          }
          expect(request.url.path.endsWith('/logout'), true);
          expect(request.headers['authorization'], 'Bearer token');
          return utf8Response('', 204);
        }),
      );
      addTearDown(api.close);
      await tester.pumpWidget(
        AppDeliveryApp(
          audience: AppAudience.client,
          apiClient: api,
          sessionStore: store,
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Registrarme'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Nombre para mostrar'),
        'María',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Teléfono con código de país'),
        '+59170000000',
      );
      await tester.tap(find.text('Solicitar código'));
      await tester.pumpAndSettle();
      expect(find.text('Código de desarrollo: 928104'), findsOneWidget);
      await tester.enterText(
        find.widgetWithText(TextField, 'Código de 6 dígitos'),
        '123456',
      );
      await tester.tap(find.text('Verificar e ingresar'));
      await tester.pumpAndSettle();
      expect(find.text('Código incorrecto'), findsOneWidget);
      expect(store.saved, isNull);
      await tester.enterText(
        find.widgetWithText(TextField, 'Código de 6 dígitos'),
        '928104',
      );
      await tester.tap(find.text('Verificar e ingresar'));
      await tester.pumpAndSettle();
      expect(find.text('Hola, María'), findsOneWidget);
      expect(find.text('Pasajeros'), findsOneWidget);
      expect(store.saved?.token, 'token');
      await tester.tap(find.text('Cerrar sesión'));
      await tester.pumpAndSettle();
      expect(find.text('Solicitar código'), findsOneWidget);
      expect(store.saved, isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('producción nunca muestra código de desarrollo devuelto por API', (
    tester,
  ) async {
    final api = ApiClient(
      config: ApiConfig(
        baseUrl: Uri.parse('https://example.test/api/v1'),
        environment: 'production',
      ),
      httpClient: MockClient(
        (_) async => utf8Response(
          '{"challengeId":"challenge-1","expiresIn":300,"retryAfter":60,"developmentCode":"928104"}',
          202,
        ),
      ),
    );
    addTearDown(api.close);
    await tester.pumpWidget(
      AppDeliveryApp(
        audience: AppAudience.client,
        apiClient: api,
        sessionStore: FakeSessionStore(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Teléfono con código de país'),
      '+59170000000',
    );
    await tester.tap(find.text('Solicitar código'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Código de desarrollo'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
