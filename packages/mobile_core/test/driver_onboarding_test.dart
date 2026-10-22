import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:mobile_core/mobile_core.dart';
import 'package:mobile_core/src/driver_onboarding.dart';
import 'fixtures.dart';

void main() {
  Json draft() => {
    'driver': {
      'id': 'driver-1',
      'fullName': 'María Pérez',
      'reviewStatus': 'draft',
      'reviewReason': null,
      'eligible': false,
    },
    'vehicles': <Json>[],
    'documents': <Json>[],
  };
  testWidgets(
    'perfil conserva borrador y presenta error de envío sin simular aprobación',
    (tester) async {
      final state = draft();
      var submitted = false;
      final api = ApiClient(
        config: ApiConfig(baseUrl: Uri.parse('http://localhost:3000/api/v1')),
        httpClient: MockClient((request) async {
          expect(request.headers['authorization'], 'Bearer token');
          if (request.method == 'PUT') {
            expect(jsonDecode(request.body), {
              'fullName': 'María Pérez Actualizada',
            });
            (state['driver'] as Json)['fullName'] = 'María Pérez Actualizada';
          }
          if (request.url.path.endsWith('/submit')) {
            submitted = true;
            return utf8Response('{"message":"Falta licencia vigente"}', 400);
          }
          return utf8Response(jsonEncode(state), 200);
        }),
      );
      api.accessToken = 'token';
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(child: DriverOnboarding(api: api)),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Conductor: Borrador'), findsOneWidget);
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Nombre completo del conductor'),
        'María Pérez Actualizada',
      );
      await tester.ensureVisible(find.text('Guardar perfil'));
      await tester.tap(find.text('Guardar perfil'));
      await tester.pumpAndSettle();
      expect(find.text('María Pérez Actualizada'), findsOneWidget);
      await tester.ensureVisible(find.text('Enviar perfil a revisión'));
      await tester.tap(find.text('Enviar perfil a revisión'));
      await tester.pumpAndSettle();
      expect(submitted, true);
      expect(find.text('Falta licencia vigente'), findsOneWidget);
      expect(find.text('Conductor: Borrador'), findsOneWidget);
      expect(find.text('Conectarme'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'vehículo crea datos completos y mantiene diálogo ante fallo de API',
    (tester) async {
      Json? sent;
      final api = ApiClient(
        config: ApiConfig(baseUrl: Uri.parse('http://localhost:3000/api/v1')),
        httpClient: MockClient((request) async {
          sent = jsonDecode(request.body) as Json;
          expect(request.url.path, '/api/v1/drivers/me/vehicles');
          return utf8Response('{"message":"Placa ya registrada"}', 409);
        }),
      );
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: VehicleEditor(api: api)),
        ),
      );
      for (final field in {
        'Placa': '1234ABC',
        'Marca': 'Toyota',
        'Modelo': 'Yaris',
        'Año': '2024',
        'Capacidad de pasajeros': '4',
      }.entries) {
        await tester.enterText(
          find.widgetWithText(TextFormField, field.key),
          field.value,
        );
      }
      await tester.ensureVisible(find.text('Guardar vehículo'));
      await tester.tap(find.text('Guardar vehículo'));
      await tester.pumpAndSettle();
      expect(sent, {
        'plate': '1234ABC',
        'make': 'Toyota',
        'model': 'Yaris',
        'year': 2024,
        'capacityPassengers': 4,
        'serviceTypes': ['passengers'],
      });
      expect(find.text('Placa ya registrada'), findsOneWidget);
      expect(find.text('1234ABC'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('muestra rechazo y razón; activar requiere ambas aprobaciones', (
    tester,
  ) async {
    final state = draft();
    (state['driver'] as Json).addAll({
      'reviewStatus': 'rejected',
      'reviewReason': 'Licencia ilegible',
    });
    state['vehicles'] = [
      {
        'id': 'vehicle-1',
        'plate': '123ABC',
        'make': 'Toyota',
        'model': 'Yaris',
        'year': 2024,
        'capacityPassengers': 4,
        'serviceTypes': ['passengers'],
        'reviewStatus': 'approved',
        'reviewReason': null,
        'active': false,
      },
    ];
    final api = ApiClient(
      config: ApiConfig(baseUrl: Uri.parse('http://localhost:3000/api/v1')),
      httpClient: MockClient((_) async => utf8Response(jsonEncode(state), 200)),
    );
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(child: DriverOnboarding(api: api)),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Conductor: Rechazado'), findsOneWidget);
    expect(find.text('Motivo: Licencia ilegible'), findsOneWidget);
    expect(
      tester
          .widget<OutlinedButton>(
            find.widgetWithText(OutlinedButton, 'Seleccionar vehículo'),
          )
          .onPressed,
      isNull,
    );
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
