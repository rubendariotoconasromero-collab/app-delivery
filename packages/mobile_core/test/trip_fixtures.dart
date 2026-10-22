import 'package:mobile_core/mobile_core.dart';

Json tripConfig() => {
  'enabled': true,
  'isTest': true,
  'currency': 'BOB',
  'coverage': {'south': -17.9, 'north': -17.65, 'west': -63.3, 'east': -63.02},
  'map': {
    'tileUrl': 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    'attribution': '© OpenStreetMap contributors',
    'attributionUrl': 'https://www.openstreetmap.org/copyright',
  },
};
Json tripPoint({bool destination = false}) => {
  'latitude': destination ? -17.79 : -17.78,
  'longitude': destination ? -63.19 : -63.18,
  'address': destination ? 'Avenida destino' : 'Plaza origen',
  'reference': 'Puerta azul',
};
Json tripRoute() => {
  'provider': 'osrm',
  'distanceMeters': 2300,
  'durationSeconds': 360,
  'geometry': {
    'type': 'LineString',
    'coordinates': [
      [-63.18, -17.78],
      [-63.19, -17.79],
    ],
  },
};
Json tripQuote() => {
  'id': 'quote-1',
  'origin': tripPoint(),
  'destination': tripPoint(destination: true),
  'passengerCount': 1,
  'currency': 'BOB',
  'totalCents': 1110,
  'isTest': true,
  'breakdown': {
    'baseCents': 500,
    'distanceCents': 460,
    'timeCents': 150,
    'minimumCents': 800,
  },
  'tariffVersion': 'scz-dev-v1',
  'expiresAt': DateTime.now()
      .add(const Duration(minutes: 3))
      .toUtc()
      .toIso8601String(),
  'route': tripRoute(),
};
Json passengerTrip({String state = 'searching', bool client = false}) => {
  'id': 'trip-1',
  'clientId': 'client-1',
  'driverId': state == 'searching' ? null : 'driver-1',
  'vehicleId': state == 'searching' ? null : 'vehicle-1',
  'state': state,
  'origin': tripPoint(),
  'destination': tripPoint(destination: true),
  'passengerCount': 1,
  'currency': 'BOB',
  'totalCents': 1110,
  'isTest': true,
  'tariffVersion': 'scz-dev-v1',
  'route': tripRoute(),
  'version': 1,
  'client': {
    'displayName': 'María',
    if (state != 'searching') 'phone': '+59170000001',
  },
  'driver': state == 'searching'
      ? null
      : {
          'displayName': 'Juan',
          'phone': '+59170000002',
          'vehicle': {
            'plate': 'TEST123',
            'make': 'Toyota',
            'model': 'Corolla',
            'capacityPassengers': 4,
          },
        },
  if (client && ['assigned', 'arrived'].contains(state)) ...{
    'startCode': '835204',
    'startCodeExpiresAt': DateTime.now()
        .add(const Duration(minutes: 10))
        .toUtc()
        .toIso8601String(),
  },
  'cash': {
    'status': 'pending',
    'receivedCents': null,
    'declaredAt': null,
    'declaredBy': null,
  },
};

class FakeForegroundLocation implements ForegroundLocation {
  bool denied = false;
  int calls = 0;
  @override
  Future<ForegroundFix> current() async {
    calls++;
    if (denied) throw const LocationFailure('Permiso de ubicación denegado');
    return ForegroundFix(
      lat: -17.78,
      lng: -63.18,
      accuracyMeters: 12,
      recordedAt: DateTime.now(),
    );
  }
}
