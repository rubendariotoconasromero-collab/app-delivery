import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_core/mobile_core.dart';
import 'fixtures.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'secure journal survives reconstruction without exposing operation payload in storage keys',
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
      const operation = 'trips/trip-1/start:{"pin":"835204"}';
      final first = await SecureTripJournal('driver-1').keyFor(operation);
      expect(await SecureTripJournal('driver-1').keyFor(operation), first);
      expect(values.keys.single, isNot(contains('835204')));
      expect(values.keys.single, isNot(contains('pin')));
      await SecureTripJournal('driver-1').resolve(operation);
      expect(values, isEmpty);
    },
  );
  test(
    'uncertain mutation retains UUID across API instances, confirmed response clears it',
    () async {
      final journal = MemoryTripJournal();
      final seen = <Json>[];
      var fail = true;
      final api = ApiClient(
        config: ApiConfig(baseUrl: Uri.parse('http://localhost:3000/api/v1')),
        httpClient: MockClient((request) async {
          expect(request.headers['authorization'], 'Bearer token');
          seen.add(jsonDecode(request.body) as Json);
          if (fail) {
            fail = false;
            throw http.ClientException('connection dropped after commit');
          }
          return utf8Response('{"trip":{"id":"persisted"}}', 201);
        }),
      );
      api.accessToken = 'token';
      addTearDown(api.close);
      await expectLater(
        TripApi(api, journal).mutate('trips', data: {'quoteId': 'quote-1'}),
        throwsA(isA<ApiFailure>()),
      );
      expect(journal.keys, hasLength(1));
      final recovered = await TripApi(
        api,
        journal,
      ).mutate('trips', data: {'quoteId': 'quote-1'});
      expect(recovered['trip'], {'id': 'persisted'});
      expect(seen[0]['idempotencyKey'], seen[1]['idempotencyKey']);
      expect(
        seen[0]['idempotencyKey'],
        matches(
          RegExp(
            r'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',
          ),
        ),
      );
      expect(journal.keys, isEmpty);
    },
  );

  test('distinct payloads never share a pending mutation key', () async {
    final journal = MemoryTripJournal();
    final one = await journal.keyFor('cash:{"receivedCents":0}');
    final two = await journal.keyFor('cash:{"receivedCents":1230}');
    expect(one, isNot(two));
    expect(await journal.keyFor('cash:{"receivedCents":0}'), one);
  });

  test(
    'confirmed validation rejection resolves its key; retry is a fresh attempt',
    () async {
      final journal = MemoryTripJournal();
      final keys = <String>[];
      final api = ApiClient(
        config: ApiConfig(baseUrl: Uri.parse('http://localhost:3000/api/v1')),
        httpClient: MockClient((request) async {
          keys.add(
            (jsonDecode(request.body) as Json)['idempotencyKey'] as String,
          );
          return utf8Response('{"message":"Código incorrecto"}', 400);
        }),
      );
      addTearDown(api.close);
      final trips = TripApi(api, journal);
      for (var attempt = 0; attempt < 2; attempt++) {
        await expectLater(
          trips.mutate('trips/trip-1/start', data: {'pin': '000000'}),
          throwsA(isA<ApiFailure>()),
        );
        expect(journal.keys, isEmpty);
      }
      expect(keys[0], isNot(keys[1]));
    },
  );
}
