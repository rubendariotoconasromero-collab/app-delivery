import 'package:geolocator/geolocator.dart';

class ForegroundFix {
  const ForegroundFix({
    required this.lat,
    required this.lng,
    required this.accuracyMeters,
    required this.recordedAt,
  });
  final double lat;
  final double lng;
  final double accuracyMeters;
  final DateTime recordedAt;

  Map<String, dynamic> toJson() => {
    'latitude': lat,
    'longitude': lng,
    'accuracyMeters': accuracyMeters,
    'capturedAt': recordedAt.toUtc().toIso8601String(),
  };
}

class LocationFailure implements Exception {
  const LocationFailure(this.message);
  final String message;
}

abstract interface class ForegroundLocation {
  Future<ForegroundFix> current();
}

/// Requests only when-in-use permission. No background or fabricated location.
class DeviceForegroundLocation implements ForegroundLocation {
  @override
  Future<ForegroundFix> current() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw const LocationFailure(
        'Activa la ubicación del dispositivo y reintenta.',
      );
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.deniedForever) {
      throw const LocationFailure(
        'Habilita el permiso de ubicación en los ajustes del dispositivo.',
      );
    }
    if (permission != LocationPermission.whileInUse &&
        permission != LocationPermission.always) {
      throw const LocationFailure(
        'Se necesita permiso de ubicación para esta acción.',
      );
    }
    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 20),
      ),
    );
    if (position.accuracy > 100 ||
        position.accuracy < 0 ||
        DateTime.now().difference(position.timestamp).inSeconds > 60) {
      throw const LocationFailure(
        'La ubicación es imprecisa o antigua. Sal a un lugar con señal GPS y reintenta.',
      );
    }
    return ForegroundFix(
      lat: position.latitude,
      lng: position.longitude,
      accuracyMeters: position.accuracy,
      recordedAt: position.timestamp,
    );
  }
}
