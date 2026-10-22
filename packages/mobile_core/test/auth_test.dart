import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_core/mobile_core.dart';
import 'fixtures.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  ApiClient clientFor(Future<http.Response> Function(http.Request) handler) {
    final api = ApiClient(
      config: ApiConfig(baseUrl: Uri.parse('http://localhost:3000/api/v1')),
      httpClient: MockClient(handler),
    );
    addTearDown(api.close);
    return api;
  }

  final future = DateTime.now()
      .add(const Duration(hours: 1))
      .toUtc()
      .toIso8601String();
  Json sessionJson() => {
    'accessToken': 'opaque-mobile-token',
    'expiresAt': future,
    'user': userJson,
  };

  test(
    'OTP liga propósito, rol público y nombre al desafío sin token',
    () async {
      final api = clientFor((request) async {
        expect(request.url.path, '/api/v1/auth/otp/request');
        expect(request.headers.containsKey('authorization'), false);
        expect(jsonDecode(request.body), {
          'phone': '+59170000000',
          'purpose': 'register',
          'role': 'driver',
          'displayName': 'María',
        });
        return utf8Response(
          jsonEncode({
            'challengeId': 'challenge-1',
            'expiresIn': 300,
            'retryAfter': 60,
            'developmentCode': '928104',
          }),
          202,
        );
      });
      api.accessToken = 'previous-session';
      final challenge = await api.requestOtp(
        phone: '+59170000000',
        role: 'driver',
        purpose: AuthPurpose.register,
        displayName: 'María',
      );
      expect(challenge.id, 'challenge-1');
      expect(challenge.developmentCode, '928104');
    },
  );

  test('recuperación envía recover y no manda nombre de registro', () async {
    final api = clientFor((request) async {
      expect(jsonDecode(request.body), {
        'phone': '+59170000000',
        'purpose': 'recover',
        'role': 'client',
      });
      return utf8Response(
        '{"challengeId":"recovery","expiresIn":300,"retryAfter":60}',
        202,
      );
    });
    await api.requestOtp(
      phone: '+59170000000',
      role: 'client',
      purpose: AuthPurpose.recover,
    );
  });

  test(
    'persiste sesión antes de autenticar y restaura desde auth/me',
    () async {
      final api = clientFor((request) async {
        if (request.url.path.endsWith('/verify')) {
          return utf8Response(jsonEncode(sessionJson()), 200);
        }
        expect(request.headers['authorization'], 'Bearer opaque-mobile-token');
        return utf8Response(
          jsonEncode({'user': userJson, 'expiresAt': future}),
          200,
        );
      });
      final store = FakeSessionStore();
      final first = SessionController(api: api, store: store, role: 'client');
      await first.signIn('challenge', '928104');
      expect(first.user?.id, 'user-1');
      expect(store.saved?.token, 'opaque-mobile-token');
      first.dispose();
      final restored = SessionController(
        api: api,
        store: store,
        role: 'driver',
      );
      addTearDown(restored.dispose);
      await restored.restore();
      expect(restored.user?.phone, '+59170000000');
    },
  );

  test(
    'almacenamiento seguro fallido revoca nueva sesión y no autentica',
    () async {
      var revoked = false;
      final api = clientFor((request) async {
        if (request.url.path.endsWith('/logout')) {
          revoked = true;
          expect(
            request.headers['authorization'],
            'Bearer opaque-mobile-token',
          );
          return utf8Response('', 204);
        }
        return utf8Response(jsonEncode(sessionJson()), 200);
      });
      final store = FakeSessionStore()..failWrite = true;
      final controller = SessionController(
        api: api,
        store: store,
        role: 'client',
      );
      addTearDown(controller.dispose);
      await expectLater(
        controller.signIn('challenge', '928104'),
        throwsStateError,
      );
      expect(controller.user, isNull);
      expect(api.accessToken, isNull);
      expect(revoked, true);
    },
  );

  test(
    'existing suspended session restores in restricted mode to finish its trip',
    () async {
      final api = clientFor(
        (request) async => utf8Response(
          jsonEncode({
            'user': {...userJson, 'status': 'suspended'},
            'expiresAt': future,
            'restricted': true,
          }),
          200,
        ),
      );
      final store = FakeSessionStore()
        ..saved = StoredSession('existing-token', DateTime.parse(future));
      final controller = SessionController(
        api: api,
        store: store,
        role: 'driver',
      );
      addTearDown(controller.dispose);
      await controller.restore();
      expect(controller.user?.status, 'suspended');
      expect(controller.restricted, true);
      expect(api.accessToken, 'existing-token');
      expect(store.clears, 0);
    },
  );

  test('sesión vencida no consulta servidor ni restaura identidad', () async {
    final api = clientFor((_) async => throw StateError('No debe consultar'));
    final store = FakeSessionStore()
      ..saved = StoredSession(
        'expired',
        DateTime.now().subtract(const Duration(seconds: 1)),
      );
    final controller = SessionController(
      api: api,
      store: store,
      role: 'client',
    );
    addTearDown(controller.dispose);
    await controller.restore();
    expect(controller.user, isNull);
    expect(store.saved, isNull);
  });

  test('401 invalida sesión y borra token persistido', () async {
    var unauthorized = false;
    final api = clientFor(
      (_) async => unauthorized
          ? utf8Response('{"message":"Unauthorized"}', 401)
          : utf8Response(jsonEncode(sessionJson()), 200),
    );
    final store = FakeSessionStore();
    final controller = SessionController(
      api: api,
      store: store,
      role: 'client',
    );
    addTearDown(controller.dispose);
    await controller.signIn('challenge', '928104');
    unauthorized = true;
    await expectLater(
      api.me(),
      throwsA(
        isA<ApiFailure>().having(
          (e) => e.kind,
          'kind',
          ApiFailureKind.unauthorized,
        ),
      ),
    );
    await Future<void>.delayed(Duration.zero);
    expect(controller.user, isNull);
    expect(store.saved, isNull);
  });

  test(
    'rechaza cuenta sin rol de esta app aunque OTP haya sido válido',
    () async {
      final api = clientFor(
        (request) async => request.url.path.endsWith('/logout')
            ? utf8Response('', 204)
            : utf8Response(
                jsonEncode({
                  ...sessionJson(),
                  'user': {
                    ...userJson,
                    'roles': ['client'],
                  },
                }),
                200,
              ),
      );
      final controller = SessionController(
        api: api,
        store: FakeSessionStore(),
        role: 'driver',
      );
      addTearDown(controller.dispose);
      await expectLater(
        controller.signIn('challenge', '928104'),
        throwsA(isA<ApiFailure>()),
      );
      expect(controller.user, isNull);
    },
  );

  test('upload privado usa bearer y multipart sin URL de archivo', () async {
    final api = clientFor((request) async {
      expect(
        request.url.path,
        '/api/v1/drivers/me/vehicles/vehicle-1/documents',
      );
      expect(request.headers['authorization'], 'Bearer upload-token');
      expect(
        request.headers['content-type'],
        startsWith('multipart/form-data; boundary='),
      );
      expect(request.body, contains('vehicle_registration'));
      expect(request.body, contains('2030-01-01'));
      expect(request.body, contains('application/pdf'));
      return utf8Response('{"id":"document-1"}', 201);
    });
    api.accessToken = 'upload-token';
    final result = await api.uploadDocument(
      kind: 'vehicle_registration',
      name: 'registro.pdf',
      mimeType: 'application/pdf',
      bytes: Uint8List.fromList(utf8.encode('%PDF document')),
      expiresOn: '2030-01-01',
      vehicleId: 'vehicle-1',
    );
    expect(result['id'], 'document-1');
    await expectLater(
      api.uploadDocument(
        kind: 'driver_license',
        name: 'bad.exe',
        mimeType: 'application/octet-stream',
        bytes: Uint8List(1),
      ),
      throwsA(isA<ApiFailure>()),
    );
  });

  test(
    'SecureSessionStore sólo utiliza el canal de almacenamiento seguro',
    () async {
      const channel = MethodChannel(
        'plugins.it_nomads.com/flutter_secure_storage',
      );
      final values = <String, String>{};
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            final args = Map<String, dynamic>.from(call.arguments as Map);
            final key = args['key'] as String;
            switch (call.method) {
              case 'write':
                values[key] = args['value'] as String;
              case 'read':
                return values[key];
              case 'delete':
                values.remove(key);
            }
            return null;
          });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, null),
      );
      final store = SecureSessionStore(namespace: 'test-client');
      await store.write(StoredSession('safe-token', DateTime.parse(future)));
      expect((await store.read())?.token, 'safe-token');
      expect(values.keys.single, 'appdelivery.session.test-client');
      await store.clear();
      expect(await store.read(), isNull);
    },
  );
}
