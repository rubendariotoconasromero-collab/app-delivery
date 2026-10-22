import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_core/mobile_core.dart';

import 'fixtures.dart';

void main() {
  ApiClient clientFor(
    Future<http.Response> Function(http.Request) handler, {
    Duration timeout = const Duration(seconds: 1),
  }) {
    final client = ApiClient(
      config: ApiConfig(
        baseUrl: Uri.parse('http://localhost:3000/api/v1'),
        timeout: timeout,
      ),
      httpClient: MockClient(handler),
    );
    addTearDown(client.close);
    return client;
  }

  Matcher failure(ApiFailureKind kind) =>
      isA<ApiFailure>().having((error) => error.kind, 'kind', kind);

  test(
    'consulta ambas rutas y conserva el mercado y las dependencias',
    () async {
      final paths = <String>[];
      final client = clientFor((request) async {
        paths.add(request.url.path);
        expect(request.headers['accept'], 'application/json');
        return http.Response(
          jsonEncode(request.url.path.endsWith('/info') ? infoJson : readyJson),
          200,
        );
      });
      final result = await client.checkConnection();
      expect(paths, containsAll(['/api/v1/info', '/api/v1/health/ready']));
      expect(result.info.market.city, 'Santa Cruz de la Sierra');
      expect(result.info.market.currency, 'BOB');
      expect(result.info.services, ['passengers', 'parcels']);
      expect(result.readiness.isReady, isTrue);
    },
  );

  test(
    '503 es disponibilidad degradada y conserva la dependencia caída',
    () async {
      final client = clientFor(
        (_) async => http.Response(jsonEncode(degradedJson), 503),
      );
      final result = await client.getReadiness();
      expect(result.isReady, isFalse);
      expect(result.dependencies['redis'], isFalse);
    },
  );

  test('no interpreta un 503 como saludable', () async {
    final client = clientFor(
      (_) async => http.Response(jsonEncode(readyJson), 503),
    );
    await expectLater(
      client.getReadiness(),
      throwsA(failure(ApiFailureKind.invalidResponse)),
    );
  });

  test('rechaza JSON malformado', () async {
    final client = clientFor(
      (_) async => http.Response('<html>Error</html>', 200),
    );
    await expectLater(
      client.getInfo(),
      throwsA(failure(ApiFailureKind.invalidResponse)),
    );
  });

  test('rechaza datos incompletos sin lanzar errores de tipo', () async {
    final client = clientFor(
      (_) async => http.Response('{"name":"AppDelivery"}', 200),
    );
    await expectLater(
      client.getInfo(),
      throwsA(failure(ApiFailureKind.invalidResponse)),
    );
  });

  test('traduce errores HTTP sin exponer detalles internos', () async {
    final client = clientFor(
      (_) async => http.Response('sensitive server detail', 500),
    );
    await expectLater(
      client.getInfo(),
      throwsA(failure(ApiFailureKind.server)),
    );
  });

  test('traduce errores de red', () async {
    final client = clientFor(
      (_) async => throw http.ClientException('socket closed'),
    );
    await expectLater(
      client.getInfo(),
      throwsA(failure(ApiFailureKind.network)),
    );
  });

  test('aplica un tiempo máximo de espera', () async {
    final pending = Completer<http.Response>();
    final client = clientFor(
      (_) => pending.future,
      timeout: const Duration(milliseconds: 10),
    );
    await expectLater(
      client.getInfo(),
      throwsA(failure(ApiFailureKind.timeout)),
    );
    pending.complete(http.Response(jsonEncode(infoJson), 200));
  });
}
