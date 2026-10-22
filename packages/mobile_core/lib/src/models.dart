typedef Json = Map<String, dynamic>;

class MarketInfo {
  const MarketInfo({
    required this.country,
    required this.city,
    required this.currency,
    required this.currencySymbol,
    required this.timeZone,
  });

  factory MarketInfo.fromJson(Json json) => MarketInfo(
    country: _string(json, 'country'),
    city: _string(json, 'city'),
    currency: _string(json, 'currency'),
    currencySymbol: _string(json, 'currencySymbol'),
    timeZone: _string(json, 'timeZone'),
  );

  final String country;
  final String city;
  final String currency;
  final String currencySymbol;
  final String timeZone;
}

class PlatformInfo {
  const PlatformInfo({
    required this.name,
    required this.environment,
    required this.market,
    required this.services,
  });

  factory PlatformInfo.fromJson(Json json) {
    final services = json['services'];
    if (services is! List || services.any((value) => value is! String)) {
      throw const FormatException('services no es una lista de texto.');
    }
    return PlatformInfo(
      name: _string(json, 'name'),
      environment: _string(json, 'environment'),
      market: MarketInfo.fromJson(_object(json, 'market')),
      services: List<String>.unmodifiable(services.cast<String>()),
    );
  }

  final String name;
  final String environment;
  final MarketInfo market;
  final List<String> services;
}

class Readiness {
  const Readiness({required this.status, required this.dependencies});

  factory Readiness.fromJson(Json json) {
    final status = _string(json, 'status');
    if (!['ok', 'degraded'].contains(status)) {
      throw const FormatException('Estado de disponibilidad desconocido.');
    }
    final dependencies = _object(json, 'dependencies');
    final parsed = <String, bool>{};
    for (final name in ['postgres', 'postgis', 'redis']) {
      final value = _string(_object(dependencies, name), 'status');
      if (!['up', 'down'].contains(value)) {
        throw const FormatException('Estado de dependencia desconocido.');
      }
      parsed[name] = value == 'up';
    }
    if ((status == 'ok') != parsed.values.every((up) => up)) {
      throw const FormatException('Estado de disponibilidad inconsistente.');
    }
    return Readiness(status: status, dependencies: Map.unmodifiable(parsed));
  }

  final String status;
  final Map<String, bool> dependencies;
  bool get isReady => status == 'ok';
}

class ConnectionSnapshot {
  const ConnectionSnapshot({required this.info, required this.readiness});

  final PlatformInfo info;
  final Readiness readiness;
}

String _string(Json json, String key) {
  final value = json[key];
  if (value is! String || value.isEmpty) {
    throw FormatException('$key no es texto válido.');
  }
  return value;
}

Json _object(Json json, String key) {
  final value = json[key];
  if (value is! Json) {
    throw FormatException('$key no es un objeto.');
  }
  return value;
}
