import 'package:mobile_core/mobile_core.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;

http.Response utf8Response(String body, int status) => http.Response.bytes(
  utf8.encode(body),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

const infoJson = <String, dynamic>{
  'name': 'AppDelivery',
  'environment': 'development',
  'market': {
    'country': 'BO',
    'city': 'Santa Cruz de la Sierra',
    'currency': 'BOB',
    'currencySymbol': 'Bs',
    'timeZone': 'America/La_Paz',
  },
  'services': ['passengers', 'parcels'],
};

const readyJson = <String, dynamic>{
  'status': 'ok',
  'dependencies': {
    'postgres': {'status': 'up'},
    'postgis': {'status': 'up'},
    'redis': {'status': 'up'},
  },
};

const degradedJson = <String, dynamic>{
  'status': 'degraded',
  'dependencies': {
    'postgres': {'status': 'up'},
    'postgis': {'status': 'up'},
    'redis': {'status': 'down'},
  },
};

class FakeSessionStore implements SessionStore {
  StoredSession? saved;
  bool failWrite = false;
  int clears = 0;
  @override
  Future<StoredSession?> read() async => saved;
  @override
  Future<void> write(StoredSession value) async {
    if (failWrite) throw StateError('locked');
    saved = value;
  }

  @override
  Future<void> clear() async {
    clears++;
    saved = null;
  }
}

const userJson = <String, dynamic>{
  'id': 'user-1',
  'displayName': 'María',
  'phone': '+59170000000',
  'email': null,
  'roles': ['client', 'driver'],
  'status': 'active',
};
