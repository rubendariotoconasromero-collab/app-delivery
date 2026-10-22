import 'dart:async';
import 'package:flutter/foundation.dart';
import 'api_client.dart';
import 'auth_models.dart';
import 'models.dart';
import 'session_store.dart';

class SessionController extends ChangeNotifier {
  SessionController({
    required this.api,
    required this.store,
    required this.role,
  }) {
    api.onUnauthorized = () {
      unawaited(_expire());
    };
  }
  final ApiClient api;
  final SessionStore store;
  final String role;
  AppUser? user;
  bool restoring = true;
  String? message;
  Timer? _expiry;
  bool _disposed = false;

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  Future<void> restore() async {
    try {
      final saved = await store.read();
      if (saved != null && saved.expiresAt.isAfter(DateTime.now())) {
        api.accessToken = saved.token;
        final me = await api.me();
        final restored = AppUser.fromJson(me['user'] as Json);
        final expiresAt = DateTime.parse(me['expiresAt'] as String);
        _validate(restored, expiresAt);
        user = restored;
        _schedule(expiresAt);
      } else if (saved != null) {
        await store.clear();
      }
    } catch (error) {
      api.accessToken = null;
      if (error is ApiFailure && error.kind == ApiFailureKind.unauthorized) {
        try {
          await store.clear();
        } catch (_) {
          // A storage failure must never restore an unauthorized identity.
        }
      }
      message = error is ApiFailure
          ? error.message
          : 'No se pudo restaurar la sesión de forma segura. Reintenta.';
      // Network errors preserve secure storage for another explicit retry.
    } finally {
      restoring = false;
      _changed();
    }
  }

  void _validate(AppUser candidate, DateTime expiresAt) {
    if (candidate.status != 'active' ||
        !candidate.roles.contains(role) ||
        !expiresAt.isAfter(DateTime.now())) {
      throw const ApiFailure(
        ApiFailureKind.unauthorized,
        'Esta cuenta no está habilitada para esta aplicación.',
      );
    }
  }

  Future<void> signIn(String challengeId, String code) async {
    final session = await api.verifyOtp(challengeId, code);
    try {
      _validate(session.user, session.expiresAt);
      // The UI only becomes authenticated after secure persistence succeeds.
      await store.write(StoredSession(session.accessToken, session.expiresAt));
    } catch (_) {
      api.accessToken = session.accessToken;
      try {
        await api.logout();
      } catch (_) {
        /* token is never kept in memory */
      }
      api.accessToken = null;
      rethrow;
    }
    api.accessToken = session.accessToken;
    user = session.user;
    message = null;
    _schedule(session.expiresAt);
    _changed();
  }

  void _schedule(DateTime expiresAt) {
    _expiry?.cancel();
    _expiry = Timer(expiresAt.difference(DateTime.now()), () {
      unawaited(_expire());
    });
  }

  Future<void> _expire() async {
    api.accessToken = null;
    user = null;
    _expiry?.cancel();
    message = 'Tu sesión venció. Inicia sesión nuevamente.';
    try {
      await store.clear();
    } catch (_) {
      message =
          'La sesión venció; no se pudo limpiar el almacenamiento seguro.';
    }
    _changed();
  }

  Future<void> logout() async {
    // A failed server revocation is reported, allowing a retry.
    await api.logout();
    api.accessToken = null;
    user = null;
    message = null;
    _expiry?.cancel();
    try {
      await store.clear();
    } catch (_) {
      message =
          'La sesión se cerró en el servidor, pero no se pudo limpiar el almacenamiento seguro.';
    }
    _changed();
  }

  @override
  void dispose() {
    _disposed = true;
    _expiry?.cancel();
    api.onUnauthorized = null;
    super.dispose();
  }
}
