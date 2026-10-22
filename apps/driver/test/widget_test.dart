import 'package:appdelivery_driver/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_core/mobile_core.dart';

class _Store implements SessionStore {
  @override
  Future<StoredSession?> read() async => null;
  @override
  Future<void> write(StoredSession session) async {}
  @override
  Future<void> clear() async {}
}

void main() {
  testWidgets(
    'presenta la app conductor sin simular ofertas ni disponibilidad',
    (tester) async {
      final api = ApiClient(
        config: ApiConfig(baseUrl: Uri.parse('http://localhost:3000/api/v1')),
        httpClient: MockClient(
          (_) async => throw http.ClientException('offline'),
        ),
      );
      addTearDown(api.close);
      await tester.pumpWidget(
        DriverApp(apiClient: api, sessionStore: _Store()),
      );
      await tester.pumpAndSettle();
      expect(find.text('AppDelivery · Conductor'), findsOneWidget);
      expect(find.text('Solicitar código'), findsOneWidget);
      expect(find.text('Enviar perfil a revisión'), findsNothing);
      expect(find.text('Conectarme'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
