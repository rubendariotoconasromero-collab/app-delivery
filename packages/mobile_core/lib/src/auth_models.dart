import 'models.dart';

enum AuthPurpose { register, login, recover }

class AppUser {
  const AppUser({
    required this.id,
    required this.displayName,
    required this.roles,
    required this.status,
    this.phone,
  });
  factory AppUser.fromJson(Json value) {
    final roles = value['roles'];
    if (value['id'] is! String ||
        value['displayName'] is! String ||
        value['status'] is! String ||
        roles is! List ||
        roles.any((r) => r is! String)) {
      throw const FormatException('Usuario inválido.');
    }
    return AppUser(
      id: value['id'] as String,
      displayName: value['displayName'] as String,
      phone: value['phone'] as String?,
      roles: roles.cast<String>(),
      status: value['status'] as String,
    );
  }
  final String id;
  final String displayName;
  final String? phone;
  final List<String> roles;
  final String status;
}

class OtpChallenge {
  const OtpChallenge({
    required this.id,
    required this.expiresIn,
    required this.retryAfter,
    this.developmentCode,
  });
  factory OtpChallenge.fromJson(Json value) {
    if (value['challengeId'] is! String ||
        value['expiresIn'] is! num ||
        value['retryAfter'] is! num) {
      throw const FormatException('Desafío inválido.');
    }
    return OtpChallenge(
      id: value['challengeId'] as String,
      expiresIn: (value['expiresIn'] as num).toInt(),
      retryAfter: (value['retryAfter'] as num).toInt(),
      developmentCode: value['developmentCode'] as String?,
    );
  }
  final String id;
  final int expiresIn;
  final int retryAfter;
  final String? developmentCode;
}

class AuthSession {
  const AuthSession({
    required this.accessToken,
    required this.expiresAt,
    required this.user,
  });
  factory AuthSession.fromJson(Json value) {
    if (value['accessToken'] is! String ||
        value['user'] is! Json ||
        value['expiresAt'] is! String) {
      throw const FormatException('Sesión inválida.');
    }
    return AuthSession(
      accessToken: value['accessToken'] as String,
      expiresAt: DateTime.parse(value['expiresAt'] as String),
      user: AppUser.fromJson(value['user'] as Json),
    );
  }
  final String accessToken;
  final DateTime expiresAt;
  final AppUser user;
}
