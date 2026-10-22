import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:mobile_core/mobile_core.dart';
import 'package:mobile_core/src/driver_trips.dart';
import 'fixtures.dart';
import 'trip_fixtures.dart';

void main() {
  testWidgets(
    'loads older history to recover a cash declaration beyond the first page',
    (tester) async {
      final older = passengerTrip(state: 'completed')
        ..['id'] = 'older-trip'
        ..['destination'] = {
          ...tripPoint(destination: true),
          'address': 'Destino antiguo',
        };
      final offsets = <String>[];
      final api = ApiClient(
        config: ApiConfig(baseUrl: Uri.parse('http://localhost:3000/api/v1')),
        httpClient: MockClient((request) async {
          final path = request.url.path;
          if (path.endsWith('/config')) {
            return utf8Response(jsonEncode(tripConfig()), 200);
          }
          if (path.endsWith('/availability')) {
            return utf8Response(
              '{"online":false,"available":false,"reason":null,"location":null}',
              200,
            );
          }
          if (path.endsWith('/active')) {
            return utf8Response('{"trip":null}', 200);
          }
          if (path.endsWith('/older-trip')) {
            return utf8Response(jsonEncode({'trip': older}), 200);
          }
          if (path.endsWith('/trips')) {
            final offset = request.url.queryParameters['offset']!;
            offsets.add(offset);
            final items = offset == '0'
                ? List.generate(
                    20,
                    (i) => passengerTrip(state: 'completed')
                      ..['id'] = 'recent-$i'
                      ..['cash'] = {
                        'status': 'declared_paid',
                        'receivedCents': 1110,
                      },
                  )
                : [older];
            return utf8Response(jsonEncode({'items': items, 'total': 21}), 200);
          }
          return utf8Response('{"items":[]}', 200);
        }),
      );
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: DriverTrips(
                api: api,
                journal: MemoryTripJournal(),
                renderMap: false,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Ver viajes anteriores'));
      await tester.tap(find.text('Ver viajes anteriores'));
      await tester.pumpAndSettle();
      expect(offsets, ['0', '20']);
      final oldItem = find.textContaining('Destino antiguo ·');
      await tester.ensureVisible(oldItem);
      await tester.tap(oldItem);
      await tester.pumpAndSettle();
      expect(find.text('Registrar efectivo recibido'), findsOneWidget);
      expect(find.text('Ver viajes anteriores'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
  testWidgets(
    'restricted account retains the current trip without polling forbidden offers',
    (tester) async {
      var forbiddenRequests = 0;
      final api = ApiClient(
        config: ApiConfig(baseUrl: Uri.parse('http://localhost:3000/api/v1')),
        httpClient: MockClient((request) async {
          if (request.url.path.endsWith('/me')) {
            return utf8Response(
              jsonEncode({
                'user': {...userJson, 'status': 'suspended'},
                'restricted': true,
              }),
              200,
            );
          }
          if (request.url.path.endsWith('/config')) {
            return utf8Response(jsonEncode(tripConfig()), 200);
          }
          if (request.url.path.endsWith('/active')) {
            return utf8Response(
              jsonEncode({'trip': passengerTrip(state: 'in_progress')}),
              200,
            );
          }
          if (request.url.path.endsWith('/availability') ||
              request.url.path.endsWith('/trip-offers')) {
            forbiddenRequests++;
            return utf8Response('{"message":"Acceso limitado"}', 403);
          }
          return utf8Response('{"items":[]}', 200);
        }),
      );
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: DriverTrips(
                api: api,
                journal: MemoryTripJournal(),
                renderMap: false,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Viaje en curso'), findsOneWidget);
      expect(find.text('Finalizar viaje en destino'), findsOneWidget);
      expect(find.textContaining('Acceso limitado. Atiende'), findsOneWidget);
      expect(forbiddenRequests, 0);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
  testWidgets(
    'driver accepts an offer, confirms arrival and PIN, finishes and declares partial cash',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 2200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final gps = FakeForegroundLocation();
      Json? active;
      var offerPending = true;
      var online = false;
      var wrongPins = 0;
      var locations = 0;
      final api = ApiClient(
        config: ApiConfig(baseUrl: Uri.parse('http://localhost:3000/api/v1')),
        httpClient: MockClient((request) async {
          final path = request.url.path;
          final body = request.body.isEmpty
              ? <String, dynamic>{}
              : jsonDecode(request.body) as Json;
          Json status() => {
            'online': online,
            'available': online && active == null,
            'reason': null,
            'location': null,
          };
          if (path.endsWith('/config')) {
            return utf8Response(jsonEncode(tripConfig()), 200);
          }
          if (path.endsWith('/location')) {
            locations++;
            expect(body['latitude'], -17.78);
            expect(body['longitude'], -63.18);
            expect(body['accuracyMeters'], 12);
            expect(DateTime.parse(body['capturedAt'] as String).isUtc, true);
            return utf8Response(jsonEncode(status()), 200);
          }
          if (path.endsWith('/availability')) {
            if (request.method == 'PUT') online = body['online'] as bool;
            return utf8Response(jsonEncode(status()), 200);
          }
          if (path.endsWith('/active')) {
            return utf8Response(jsonEncode({'trip': active}), 200);
          }
          if (path.endsWith('/trip-offers')) {
            return utf8Response(
              jsonEncode({
                'items': offerPending
                    ? [
                        {
                          'id': 'offer-1',
                          'state': 'pending',
                          'expiresAt': DateTime.now()
                              .add(const Duration(minutes: 1))
                              .toUtc()
                              .toIso8601String(),
                          'trip': passengerTrip(),
                        },
                      ]
                    : [],
              }),
              200,
            );
          }
          if (path.endsWith('/respond')) {
            expect(body['decision'], 'accept');
            expect(body['idempotencyKey'], isA<String>());
            active = passengerTrip(state: 'assigned');
            offerPending = false;
          } else if (path.endsWith('/arrive')) {
            active = passengerTrip(state: 'arrived');
          } else if (path.endsWith('/start')) {
            if (body['pin'] != '835204') {
              wrongPins++;
              return utf8Response(
                '{"message":"Código de inicio incorrecto"}',
                400,
              );
            }
            active = passengerTrip(state: 'in_progress');
          } else if (path.endsWith('/finish')) {
            active = passengerTrip(state: 'completed');
          } else if (path.endsWith('/cash')) {
            expect(body['receivedCents'], 705);
            active!['cash'] = {
              'status': 'partial',
              'receivedCents': 705,
              'declaredAt': DateTime.now().toUtc().toIso8601String(),
              'declaredBy': 'driver-1',
            };
          } else if (path.endsWith('/trips')) {
            return utf8Response('{"items":[],"total":0}', 200);
          }
          return utf8Response(jsonEncode({'trip': active}), 200);
        }),
      );
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: DriverTrips(
                api: api,
                journal: MemoryTripJournal(),
                location: gps,
                renderMap: false,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byType(Switch));
      await tester.pumpAndSettle();
      expect(online, true);
      await tester.tap(find.text('Aceptar asignación'));
      await tester.pumpAndSettle();
      expect(find.text('Conductor en camino'), findsOneWidget);
      expect(find.text('835204'), findsNothing);
      await tester.tap(find.text('Llegué al origen'));
      await tester.pumpAndSettle();
      Future<void> start(String pin) async {
        await tester.tap(find.text('Iniciar con código del pasajero'));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.widgetWithText(TextFormField, 'Código de inicio de 6 dígitos'),
          pin,
        );
        await tester.tap(find.text('Validar e iniciar'));
        await tester.pumpAndSettle();
      }

      await start('000000');
      expect(wrongPins, 1);
      expect(find.text('Código de inicio incorrecto'), findsOneWidget);
      expect(find.text('Conductor en el origen'), findsOneWidget);
      await start('835204');
      expect(find.text('Viaje en curso'), findsOneWidget);
      await tester.tap(find.text('Finalizar viaje en destino'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Confirmar llegada al destino'));
      await tester.pumpAndSettle();
      expect(find.text('Viaje finalizado'), findsOneWidget);
      await tester.tap(find.text('Registrar efectivo recibido'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Importe recibido en Bs'),
        '7,05',
      );
      await tester.tap(find.text('Confirmar declaración de efectivo'));
      await tester.pumpAndSettle();
      expect(find.text('Cobro parcial declarado'), findsOneWidget);
      expect(find.text('Recibido: Bs 7.05'), findsOneWidget);
      expect(find.text('Registrar efectivo recibido'), findsNothing);
      expect(locations, greaterThanOrEqualTo(4));
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('denied foreground GPS never claims online availability', (
    tester,
  ) async {
    final gps = FakeForegroundLocation()..denied = true;
    var mutations = 0;
    final api = ApiClient(
      config: ApiConfig(baseUrl: Uri.parse('http://localhost:3000/api/v1')),
      httpClient: MockClient((request) async {
        if (request.method != 'GET') mutations++;
        if (request.url.path.endsWith('/config')) {
          return utf8Response(jsonEncode(tripConfig()), 200);
        }
        if (request.url.path.endsWith('/availability')) {
          return utf8Response(
            '{"online":false,"available":false,"reason":"GPS pendiente","location":null}',
            200,
          );
        }
        if (request.url.path.endsWith('/active')) {
          return utf8Response('{"trip":null}', 200);
        }
        return utf8Response('{"items":[]}', 200);
      }),
    );
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: DriverTrips(
              api: api,
              journal: MemoryTripJournal(),
              location: gps,
              renderMap: false,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();
    expect(find.text('Permiso de ubicación denegado'), findsOneWidget);
    expect(find.text('Desconectado'), findsOneWidget);
    expect(mutations, 0);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
