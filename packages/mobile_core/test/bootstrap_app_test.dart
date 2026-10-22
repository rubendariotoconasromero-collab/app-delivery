import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_core/mobile_core.dart';

import 'fixtures.dart';

void main() {
  testWidgets('muestra carga, permite reintentar y confirma conexión real', (
    tester,
  ) async {
    var failing = true;
    final client = ApiClient(
      config: ApiConfig(baseUrl: Uri.parse('http://localhost:3000/api/v1')),
      httpClient: MockClient((request) async {
        if (failing) throw http.ClientException('offline');
        return http.Response(
          jsonEncode(request.url.path.endsWith('/info') ? infoJson : readyJson),
          200,
        );
      }),
    );
    addTearDown(client.close);
    await tester.pumpWidget(
      AppDeliveryApp(
        audience: AppAudience.client,
        apiClient: client,
        sessionStore: FakeSessionStore(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Diagnóstico de conexión'));
    await tester.pumpAndSettle();
    expect(find.text('No se pudo comprobar la conexión'), findsOneWidget);
    failing = false;
    final retry = find.text('Reintentar');
    await tester.ensureVisible(retry);
    await tester.tap(retry);
    await tester.pumpAndSettle();
    expect(find.text('Plataforma conectada'), findsOneWidget);
    expect(find.text('Moneda: Bs (BOB)'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('muestra indisponibilidad al recibir 503 de readiness', (
    tester,
  ) async {
    final client = ApiClient(
      config: ApiConfig(baseUrl: Uri.parse('http://localhost:3000/api/v1')),
      httpClient: MockClient(
        (request) async => request.url.path.endsWith('/info')
            ? http.Response(jsonEncode(infoJson), 200)
            : http.Response(jsonEncode(degradedJson), 503),
      ),
    );
    addTearDown(client.close);
    await tester.pumpWidget(
      AppDeliveryApp(
        audience: AppAudience.driver,
        apiClient: client,
        sessionStore: FakeSessionStore(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Diagnóstico de conexión'));
    await tester.pumpAndSettle();
    expect(find.text('Plataforma temporalmente no disponible'), findsOneWidget);
    expect(find.text('Plataforma conectada'), findsNothing);
    expect(find.byType(OutlinedButton), findsOneWidget);
  });
}
