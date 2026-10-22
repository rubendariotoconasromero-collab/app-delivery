import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class StoredSession {
  const StoredSession(this.token, this.expiresAt);
  final String token;
  final DateTime expiresAt;
}

abstract interface class SessionStore {
  Future<StoredSession?> read();
  Future<void> write(StoredSession session);
  Future<void> clear();
}

/// The token never leaves Keychain/Android encrypted storage through a local file.
class SecureSessionStore implements SessionStore {
  SecureSessionStore({required String namespace, FlutterSecureStorage? storage})
    : _key = 'appdelivery.session.$namespace',
      _storage = storage ?? const FlutterSecureStorage();
  final String _key;
  final FlutterSecureStorage _storage;
  @override
  Future<StoredSession?> read() async {
    final raw = await _storage.read(key: _key);
    if (raw == null) return null;
    try {
      final data = jsonDecode(raw) as Map<String, dynamic>;
      return StoredSession(
        data['token'] as String,
        DateTime.parse(data['expiresAt'] as String),
      );
    } on FormatException {
      await clear();
      return null;
    } on TypeError {
      await clear();
      return null;
    }
  }

  @override
  Future<void> write(StoredSession session) => _storage.write(
    key: _key,
    value: jsonEncode({
      'token': session.token,
      'expiresAt': session.expiresAt.toUtc().toIso8601String(),
    }),
  );
  @override
  Future<void> clear() => _storage.delete(key: _key);
}
