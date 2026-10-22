import 'package:flutter/foundation.dart';

/// Public configuration only. Tokens and credentials never belong in defines.
class ApiConfig {
  ApiConfig({
    required this.baseUrl,
    this.environment = 'development',
    this.timeout = const Duration(seconds: 8),
    bool releaseMode = kReleaseMode,
  }) {
    if (!baseUrl.hasAuthority ||
        !['http', 'https'].contains(baseUrl.scheme) ||
        baseUrl.userInfo.isNotEmpty ||
        baseUrl.hasQuery ||
        baseUrl.hasFragment ||
        !baseUrl.path.endsWith('/api/v1')) {
      throw ArgumentError('API_BASE_URL debe ser una URL absoluta /api/v1.');
    }
    if (!['development', 'production'].contains(environment)) {
      throw ArgumentError('APP_ENV debe ser development o production.');
    }
    if ((releaseMode || environment == 'production') &&
        (baseUrl.scheme != 'https' || environment != 'production')) {
      throw ArgumentError(
        'Release requiere APP_ENV=production y una API HTTPS.',
      );
    }
    if (timeout <= Duration.zero) {
      throw ArgumentError('El tiempo de espera debe ser positivo.');
    }
  }

  factory ApiConfig.fromDefines() {
    const environment = String.fromEnvironment(
      'APP_ENV',
      defaultValue: 'development',
    );
    const configuredUrl = String.fromEnvironment('API_BASE_URL');
    final defaultUrl =
        !kIsWeb && defaultTargetPlatform == TargetPlatform.android
        ? 'http://10.0.2.2:3000/api/v1'
        : 'http://localhost:3000/api/v1';
    return ApiConfig(
      baseUrl: Uri.parse(configuredUrl.isEmpty ? defaultUrl : configuredUrl),
      environment: environment,
    );
  }

  final Uri baseUrl;
  final String environment;
  final Duration timeout;

  Uri endpoint(String path) => Uri.parse('$baseUrl/$path');
}
