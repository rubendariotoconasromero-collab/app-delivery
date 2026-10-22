import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import 'api_config.dart';
import 'models.dart';
import 'auth_models.dart';

enum ApiFailureKind { network, timeout, server, invalidResponse, unauthorized }

class ApiFailure implements Exception {
  const ApiFailure(this.kind, this.message);

  final ApiFailureKind kind;
  final String message;

  @override
  String toString() => message;
}

class ApiClient {
  ApiClient({required this.config, http.Client? httpClient})
    : _httpClient = httpClient ?? http.Client();

  final ApiConfig config;
  final http.Client _httpClient;
  String? accessToken;
  void Function()? onUnauthorized;

  Future<OtpChallenge> requestOtp({
    required String phone,
    required String role,
    required AuthPurpose purpose,
    String? displayName,
  }) => _parse(
    () async => OtpChallenge.fromJson(
      await sendJson(
        'POST',
        'auth/otp/request',
        data: {
          'phone': phone,
          'role': role,
          'purpose': purpose.name,
          if (purpose == AuthPurpose.register) 'displayName': displayName,
        },
        authenticated: false,
      ),
    ),
  );

  Future<AuthSession> verifyOtp(String challengeId, String code) => _parse(
    () async => AuthSession.fromJson(
      await sendJson(
        'POST',
        'auth/otp/verify',
        data: {'challengeId': challengeId, 'code': code},
        authenticated: false,
      ),
    ),
  );

  Future<Json> me() => sendJson('GET', 'auth/me');
  Future<void> logout() async {
    await sendJson('POST', 'auth/logout', data: {});
  }

  Future<Json> sendJson(
    String method,
    String path, {
    Json? data,
    bool authenticated = true,
  }) => _parse(() async {
    try {
      final request = http.Request(method, config.endpoint(path));
      request.headers['Accept'] = 'application/json';
      if (authenticated && accessToken != null) {
        request.headers['Authorization'] = 'Bearer $accessToken';
      }
      if (data != null) {
        request.headers['Content-Type'] = 'application/json';
        request.body = jsonEncode(data);
      }
      final response = await http.Response.fromStream(
        await _httpClient.send(request),
      ).timeout(config.timeout);
      return _decodeResponse(response, authenticated: authenticated);
    } on TimeoutException {
      throw const ApiFailure(
        ApiFailureKind.timeout,
        'La consulta tardó demasiado. Reintenta.',
      );
    } on http.ClientException {
      throw const ApiFailure(
        ApiFailureKind.network,
        'No se pudo conectar. Comprueba tu conexión.',
      );
    }
  });

  Future<Json> uploadDocument({
    required String kind,
    required String name,
    required String mimeType,
    required Uint8List bytes,
    String? expiresOn,
    String? vehicleId,
  }) => _parse(() async {
    if (bytes.isEmpty ||
        bytes.length > 5 * 1024 * 1024 ||
        !['application/pdf', 'image/jpeg', 'image/png'].contains(mimeType)) {
      throw const ApiFailure(
        ApiFailureKind.server,
        'Selecciona PDF, JPEG o PNG de hasta 5 MiB.',
      );
    }
    try {
      final path = vehicleId == null
          ? 'drivers/me/documents'
          : 'drivers/me/vehicles/$vehicleId/documents';
      final request = http.MultipartRequest('POST', config.endpoint(path));
      request.headers['Accept'] = 'application/json';
      if (accessToken != null) {
        request.headers['Authorization'] = 'Bearer $accessToken';
      }
      request.fields['kind'] = kind;
      if (expiresOn != null) request.fields['expiresOn'] = expiresOn;
      request.files.add(
        http.MultipartFile.fromBytes(
          'file',
          bytes,
          filename: name,
          contentType: MediaType.parse(mimeType),
        ),
      );
      final response = await http.Response.fromStream(
        await _httpClient.send(request),
      ).timeout(const Duration(seconds: 30));
      return _decodeResponse(response, authenticated: true);
    } on TimeoutException {
      throw const ApiFailure(
        ApiFailureKind.timeout,
        'La carga tardó demasiado. Consulta tus documentos antes de reintentar.',
      );
    } on http.ClientException {
      throw const ApiFailure(
        ApiFailureKind.network,
        'No se pudo cargar el documento. Comprueba tu conexión.',
      );
    }
  });

  Json _decodeResponse(http.Response response, {required bool authenticated}) {
    if (response.statusCode == 401 && authenticated) {
      accessToken = null;
      onUnauthorized?.call();
      throw const ApiFailure(
        ApiFailureKind.unauthorized,
        'Tu sesión venció. Inicia sesión nuevamente.',
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      var message = 'No se pudo completar la operación. Reintenta.';
      // Only show documented validation errors; do not surface server internals.
      if (response.statusCode >= 400 && response.statusCode < 500) {
        try {
          final decoded = jsonDecode(utf8.decode(response.bodyBytes));
          final value = decoded is Json ? decoded['message'] : null;
          if (value is String) message = value;
          if (value is List && value.every((v) => v is String)) {
            message = value.join('\n');
          }
        } on FormatException {
          /* keep safe default */
        }
      }
      throw ApiFailure(ApiFailureKind.server, message);
    }
    if (response.statusCode == 204) return <String, dynamic>{};
    final decoded = jsonDecode(utf8.decode(response.bodyBytes));
    if (decoded is! Json) throw const FormatException('Objeto JSON requerido.');
    return decoded;
  }

  Future<PlatformInfo> getInfo() async =>
      _parse(() async => PlatformInfo.fromJson(await _get('info')));

  Future<Readiness> getReadiness() async => _parse(
    () async =>
        Readiness.fromJson(await _get('health/ready', allowDegraded: true)),
  );

  Future<ConnectionSnapshot> checkConnection() async {
    final results = await Future.wait<Object>([getInfo(), getReadiness()]);
    return ConnectionSnapshot(
      info: results[0] as PlatformInfo,
      readiness: results[1] as Readiness,
    );
  }

  Future<T> _parse<T>(Future<T> Function() decode) async {
    try {
      return await decode();
    } on FormatException {
      throw const ApiFailure(
        ApiFailureKind.invalidResponse,
        'La API devolvió una respuesta no válida.',
      );
    }
  }

  Future<Json> _get(String path, {bool allowDegraded = false}) async {
    try {
      final response = await _httpClient
          .get(config.endpoint(path), headers: {'Accept': 'application/json'})
          .timeout(config.timeout);
      if (response.statusCode != 200 &&
          !(allowDegraded && response.statusCode == 503)) {
        throw const ApiFailure(
          ApiFailureKind.server,
          'La API no pudo completar la consulta. Reintenta en unos momentos.',
        );
      }
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is! Json) {
        throw const FormatException('Se esperaba un objeto JSON.');
      }
      if (allowDegraded &&
          decoded['status'] !=
              (response.statusCode == 200 ? 'ok' : 'degraded')) {
        throw const FormatException(
          'El estado HTTP y la disponibilidad no coinciden.',
        );
      }
      return decoded;
    } on TimeoutException {
      throw const ApiFailure(
        ApiFailureKind.timeout,
        'La consulta tardó demasiado. Comprueba tu conexión y reintenta.',
      );
    } on http.ClientException {
      throw const ApiFailure(
        ApiFailureKind.network,
        'No se pudo conectar con la API. Comprueba la red y la configuración.',
      );
    }
  }

  void close() => _httpClient.close();
}
