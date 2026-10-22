import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_core/mobile_core.dart';

void main() {
  test('emulador Android usa el host y las otras plataformas localhost', () {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    expect(ApiConfig.fromDefines().baseUrl.host, '10.0.2.2');
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    expect(ApiConfig.fromDefines().baseUrl.host, 'localhost');
    debugDefaultTargetPlatformOverride = null;
  });

  test('release exige entorno production y HTTPS', () {
    expect(
      () => ApiConfig(
        baseUrl: Uri.parse('http://localhost:3000/api/v1'),
        releaseMode: true,
      ),
      throwsArgumentError,
    );
    expect(
      () => ApiConfig(
        baseUrl: Uri.parse('https://api.example.invalid/api/v1'),
        releaseMode: true,
      ),
      throwsArgumentError,
    );
    final config = ApiConfig(
      baseUrl: Uri.parse('https://api.example.invalid/api/v1'),
      environment: 'production',
      releaseMode: true,
    );
    expect(config.endpoint('info').path, '/api/v1/info');
  });

  test('rechaza URLs con credenciales o sin la ruta de la API', () {
    for (final url in [
      'https://user:pass@example.invalid/api/v1',
      'https://example.invalid',
    ]) {
      expect(() => ApiConfig(baseUrl: Uri.parse(url)), throwsArgumentError);
    }
  });
}
