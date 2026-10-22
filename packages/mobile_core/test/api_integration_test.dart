import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_core/mobile_core.dart';

void main() {
  const runIntegration = bool.fromEnvironment('RUN_API_INTEGRATION');

  test('API real: contrato de mercado y disponibilidad', () async {
    const url = String.fromEnvironment(
      'API_BASE_URL',
      defaultValue: 'http://127.0.0.1:3000/api/v1',
    );
    final api = ApiClient(config: ApiConfig(baseUrl: Uri.parse(url)));
    addTearDown(api.close);
    final snapshot = await api.checkConnection();
    expect(snapshot.info.name, 'AppDelivery');
    expect(snapshot.info.market.country, 'BO');
    expect(snapshot.info.market.city, 'Santa Cruz de la Sierra');
    expect(snapshot.info.market.currency, 'BOB');
    expect(snapshot.info.market.currencySymbol, 'Bs');
    expect(snapshot.info.market.timeZone, 'America/La_Paz');
    expect(snapshot.info.services, containsAll(['passengers', 'parcels']));
    expect(snapshot.readiness.status, isIn(['ok', 'degraded']));
    expect(
      snapshot.readiness.dependencies.keys,
      unorderedEquals(['postgres', 'postgis', 'redis']),
    );
  }, skip: !runIntegration);
}
