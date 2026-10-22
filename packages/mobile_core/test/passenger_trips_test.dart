import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:mobile_core/mobile_core.dart';
import 'package:mobile_core/src/passenger_trips.dart';
import 'fixtures.dart';
import 'trip_fixtures.dart';

void main() {
  testWidgets(
    'selects explicit points, quotes centavos and recovers the created request',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 2200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      Json? created;
      final api = ApiClient(
        config: ApiConfig(baseUrl: Uri.parse('http://localhost:3000/api/v1')),
        httpClient: MockClient((request) async {
          if (request.url.path.endsWith('/config')) {
            return utf8Response(jsonEncode(tripConfig()), 200);
          }
          if (request.url.path.endsWith('/active')) {
            return utf8Response(jsonEncode({'trip': created}), 200);
          }
          if (request.url.path.endsWith('/quotes')) {
            final body = jsonDecode(request.body) as Json;
            expect((body['origin'] as Json)['latitude'], -17.78);
            expect((body['destination'] as Json)['longitude'], -63.19);
            expect((body['origin'] as Json)['address'], 'Plaza origen');
            expect(body['passengerCount'], 1);
            return utf8Response(jsonEncode({'quote': tripQuote()}), 201);
          }
          if (request.method == 'POST' && request.url.path.endsWith('/trips')) {
            final body = jsonDecode(request.body) as Json;
            expect(body['quoteId'], 'quote-1');
            expect(body['idempotencyKey'], isA<String>());
            created = passengerTrip();
            return utf8Response(jsonEncode({'trip': created}), 201);
          }
          return utf8Response(
            '{"items":[],"total":0,"limit":10,"offset":0}',
            200,
          );
        }),
      );
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: PassengerTrips(
                api: api,
                journal: MemoryTripJournal(),
                renderMap: false,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      Future<void> coordinates(String latitude, String longitude) async {
        await tester.tap(find.text('Ingresar coordenadas'));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.widgetWithText(TextFormField, 'Latitud'),
          latitude,
        );
        await tester.enterText(
          find.widgetWithText(TextFormField, 'Longitud'),
          longitude,
        );
        await tester.tap(find.text('Usar punto'));
        await tester.pumpAndSettle();
      }

      await coordinates('-17.78', '-63.18');
      await tester.tap(find.text('Destino'));
      await tester.pumpAndSettle();
      await coordinates('-17.79', '-63.19');
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Dirección de Origen'),
        'Plaza origen',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Dirección de Destino'),
        'Avenida destino',
      );
      await tester.tap(find.text('Calcular cotización'));
      await tester.pumpAndSettle();
      expect(find.text('Bs 11.10'), findsOneWidget);
      await tester.tap(find.text('Confirmar viaje por Bs 11.10 · Efectivo'));
      await tester.pumpAndSettle();
      expect(find.text('Buscando conductor'), findsOneWidget);
      expect(find.text('Cancelar solicitud'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'restores assigned trip and shows private start code to its client',
    (tester) async {
      final api = ApiClient(
        config: ApiConfig(baseUrl: Uri.parse('http://localhost:3000/api/v1')),
        httpClient: MockClient(
          (request) async => utf8Response(
            jsonEncode(
              request.url.path.endsWith('/config')
                  ? tripConfig()
                  : request.url.path.endsWith('/active')
                  ? {'trip': passengerTrip(state: 'assigned', client: true)}
                  : {'items': <Json>[]},
            ),
            200,
          ),
        ),
      );
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: PassengerTrips(
                api: api,
                journal: MemoryTripJournal(),
                renderMap: false,
                accountActive: false,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('835204'), findsOneWidget);
      expect(find.textContaining('TEST123'), findsOneWidget);
      expect(find.textContaining('Tu acceso está limitado'), findsOneWidget);
      expect(find.text('Calcular cotización'), findsNothing);
      expect(find.text('Cancelar solicitud'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
