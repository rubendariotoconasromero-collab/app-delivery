import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'api_client.dart';
import 'models.dart';

abstract interface class TripJournal {
  Future<String> keyFor(String operation);
  Future<void> resolve(String operation);
}

String tripUuid() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

/// One secure record per operation fingerprint; persists uncertain outcomes.
class SecureTripJournal implements TripJournal {
  SecureTripJournal(this.namespace, {FlutterSecureStorage? storage})
    : storage = storage ?? const FlutterSecureStorage();
  final String namespace;
  final FlutterSecureStorage storage;
  String _key(String operation) =>
      'appdelivery.trip.$namespace.${sha256.convert(utf8.encode(operation))}';
  @override
  Future<String> keyFor(String operation) async {
    final existing = await storage.read(key: _key(operation));
    if (existing != null) return existing;
    final key = tripUuid();
    await storage.write(key: _key(operation), value: key);
    return key;
  }

  @override
  Future<void> resolve(String operation) =>
      storage.delete(key: _key(operation));
}

/// Injectable journal used by contract tests, never used for device sessions.
class MemoryTripJournal implements TripJournal {
  final Map<String, String> keys = {};
  @override
  Future<String> keyFor(String operation) async =>
      keys.putIfAbsent(operation, tripUuid);
  @override
  Future<void> resolve(String operation) async {
    keys.remove(operation);
  }
}

class TripApi {
  const TripApi(this.api, this.journal);
  final ApiClient api;
  final TripJournal journal;
  Future<Json> get(String path) => api.sendJson('GET', path);
  Future<Json> mutate(String path, {Json data = const {}}) async {
    final operation = '$path:${jsonEncode(data)}';
    final key = await journal.keyFor(operation);
    late final Json response;
    try {
      response = await api.sendJson(
        'POST',
        path,
        data: {...data, 'idempotencyKey': key},
      );
    } on ApiFailure catch (error) {
      // A 4xx is a confirmed rejection. Corrected/repeated attempts are new actions;
      // network failures, 5xx and invalid responses keep the original retry UUID.
      if (error.statusCode != null &&
          error.statusCode! >= 400 &&
          error.statusCode! < 500) {
        try {
          await journal.resolve(operation);
        } catch (_) {
          /* preserve safely */
        }
      }
      rethrow;
    }
    // If secure cleanup fails, the confirmed server result is still authoritative.
    try {
      await journal.resolve(operation);
    } catch (_) {
      /* safe retry key remains */
    }
    return response;
  }

  Future<Json?> active(String role) async =>
      (await get('trips/active?role=$role'))['trip'] as Json?;
  Future<Json> trip(String id) async =>
      (await get('trips/$id'))['trip'] as Json;
}

String tripStateLabel(Object? state) => switch (state) {
  'searching' => 'Buscando conductor',
  'assigned' => 'Conductor en camino',
  'arrived' => 'Conductor en el origen',
  'in_progress' => 'Viaje en curso',
  'completed' => 'Viaje finalizado',
  'cancelled' => 'Viaje cancelado',
  'no_driver' => 'No se encontró conductor',
  _ => 'Estado pendiente de confirmar',
};

bool tripIsTerminal(Json trip) =>
    ['completed', 'cancelled', 'no_driver'].contains(trip['state']);
