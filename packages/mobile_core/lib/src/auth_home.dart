import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'api_client.dart';
import 'api_config.dart';
import 'auth_models.dart';
import 'driver_onboarding.dart';
import 'session_controller.dart';
import 'session_store.dart';

class AuthHome extends StatefulWidget {
  const AuthHome({
    super.key,
    required this.role,
    this.apiClient,
    this.sessionStore,
    required this.diagnosticBuilder,
  });
  final String role;
  final ApiClient? apiClient;
  final SessionStore? sessionStore;
  final Widget Function() diagnosticBuilder;
  @override
  State<AuthHome> createState() => _AuthHomeState();
}

class _AuthHomeState extends State<AuthHome> {
  late final ApiClient api;
  late final SessionController session;
  bool loggingOut = false;
  String? logoutError;
  @override
  void initState() {
    super.initState();
    api = widget.apiClient ?? ApiClient(config: ApiConfig.fromDefines());
    session = SessionController(
      api: api,
      role: widget.role,
      store:
          widget.sessionStore ??
          SecureSessionStore(
            namespace:
                '${api.config.baseUrl.host}.${api.config.baseUrl.port}.${widget.role}',
          ),
    );
    session.addListener(_update);
    unawaited(session.restore());
  }

  void _update() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    session.removeListener(_update);
    session.dispose();
    if (widget.apiClient == null) api.close();
    super.dispose();
  }

  Future<void> _logout() async {
    setState(() {
      loggingOut = true;
      logoutError = null;
    });
    try {
      await session.logout();
    } catch (error) {
      logoutError = userMessage(error);
    } finally {
      if (mounted) setState(() => loggingOut = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(
        'AppDelivery · ${widget.role == 'client' ? 'Cliente' : 'Conductor'}',
      ),
      actions: [
        IconButton(
          tooltip: 'Diagnóstico de conexión',
          icon: const Icon(Icons.network_check),
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => widget.diagnosticBuilder()),
          ),
        ),
        if (session.user != null)
          TextButton(
            onPressed: loggingOut ? null : _logout,
            child: const Text('Cerrar sesión'),
          ),
      ],
    ),
    body: SafeArea(
      child: session.restoring
          ? const Center(child: CircularProgressIndicator())
          : session.user == null
          ? LoginForm(session: session)
          : SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 720),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        'Hola, ${session.user!.displayName}',
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                      Text(session.user!.phone ?? ''),
                      if (logoutError != null) ErrorNotice(logoutError!),
                      const SizedBox(height: 20),
                      if (widget.role == 'driver')
                        DriverOnboarding(api: api)
                      else ...[
                        const Text(
                          'Santa Cruz de la Sierra · Bolivianos · Efectivo',
                        ),
                        const Card(
                          child: ListTile(
                            leading: Icon(Icons.people_outline),
                            title: Text('Pasajeros'),
                            subtitle: Text(
                              'Las solicitudes de viaje estarán disponibles en el siguiente loop.',
                            ),
                          ),
                        ),
                        const Card(
                          child: ListTile(
                            leading: Icon(Icons.inventory_2_outlined),
                            title: Text('Encomiendas'),
                            subtitle: Text(
                              'El envío puerta a puerta se incorporará en los siguientes loops.',
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
    ),
  );
}

String userMessage(Object error) => error is ApiFailure
    ? error.message
    : 'No se pudo completar la operación de forma segura. Reintenta.';

class ErrorNotice extends StatelessWidget {
  const ErrorNotice(this.message, {super.key});
  final String message;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 12),
    child: Semantics(
      liveRegion: true,
      child: Text(
        message,
        style: TextStyle(color: Theme.of(context).colorScheme.error),
      ),
    ),
  );
}

class LoginForm extends StatefulWidget {
  const LoginForm({super.key, required this.session});
  final SessionController session;
  @override
  State<LoginForm> createState() => _LoginFormState();
}

class _LoginFormState extends State<LoginForm> {
  final form = GlobalKey<FormState>();
  final phone = TextEditingController(text: '+591');
  final name = TextEditingController();
  final code = TextEditingController();
  AuthPurpose purpose = AuthPurpose.login;
  OtpChallenge? challenge;
  DateTime? expiresAt;
  DateTime? retryAt;
  Timer? ticker;
  bool busy = false;
  String? error;
  int get secondsLeft => expiresAt == null
      ? 0
      : expiresAt!.difference(DateTime.now()).inSeconds.clamp(0, 9999);
  bool get canRetry => retryAt == null || DateTime.now().isAfter(retryAt!);
  @override
  void dispose() {
    ticker?.cancel();
    phone.dispose();
    name.dispose();
    code.dispose();
    super.dispose();
  }

  Future<void> request() async {
    if (!form.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final value = await widget.session.api.requestOtp(
        phone: phone.text.trim(),
        role: widget.session.role,
        purpose: purpose,
        displayName: name.text.trim(),
      );
      if (!mounted) return;
      ticker ??= Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted && challenge != null) setState(() {});
      });
      setState(() {
        challenge = value;
        code.clear();
        expiresAt = DateTime.now().add(Duration(seconds: value.expiresIn));
        retryAt = DateTime.now().add(Duration(seconds: value.retryAfter));
      });
    } catch (e) {
      if (mounted) setState(() => error = userMessage(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> verify() async {
    if (!RegExp(r'^\d{6}$').hasMatch(code.text)) {
      setState(() => error = 'Introduce el código de 6 dígitos.');
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await widget.session.signIn(challenge!.id, code.text);
    } catch (e) {
      if (mounted) setState(() => error = userMessage(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: const EdgeInsets.all(24),
    child: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: Form(
          key: form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                challenge != null ? 'Verifica tu teléfono' : 'Bienvenido',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 12),
              if (challenge == null) ...[
                SegmentedButton<AuthPurpose>(
                  segments: const [
                    ButtonSegment(
                      value: AuthPurpose.login,
                      label: Text('Ingresar'),
                    ),
                    ButtonSegment(
                      value: AuthPurpose.register,
                      label: Text('Registrarme'),
                    ),
                  ],
                  selected: {
                    purpose == AuthPurpose.register
                        ? AuthPurpose.register
                        : AuthPurpose.login,
                  },
                  onSelectionChanged: busy
                      ? null
                      : (v) => setState(() {
                          purpose = v.first;
                          error = null;
                        }),
                ),
                if (purpose == AuthPurpose.recover)
                  const Padding(
                    padding: EdgeInsets.only(top: 16),
                    child: Text(
                      'Recuperar acceso verificará tu teléfono y cerrará las sesiones móviles anteriores.',
                    ),
                  ),
                if (purpose == AuthPurpose.register)
                  TextFormField(
                    controller: name,
                    enabled: !busy,
                    decoration: const InputDecoration(
                      labelText: 'Nombre para mostrar',
                    ),
                    textCapitalization: TextCapitalization.words,
                    validator: (v) => (v?.trim().length ?? 0) < 2
                        ? 'Introduce tu nombre.'
                        : null,
                  ),
                TextFormField(
                  controller: phone,
                  enabled: !busy,
                  keyboardType: TextInputType.phone,
                  autofillHints: const [AutofillHints.telephoneNumber],
                  decoration: const InputDecoration(
                    labelText: 'Teléfono con código de país',
                    hintText: '+59170000000',
                  ),
                  validator: (v) =>
                      RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(v?.trim() ?? '')
                      ? null
                      : 'Usa el formato +591 seguido de tu número.',
                ),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: busy ? null : request,
                  child: const Text('Solicitar código'),
                ),
                TextButton(
                  onPressed: busy
                      ? null
                      : () => setState(() {
                          purpose = AuthPurpose.recover;
                          error = null;
                        }),
                  child: const Text('Recuperar acceso'),
                ),
              ] else ...[
                Text('Teléfono: ${phone.text.trim()}'),
                Text(
                  secondsLeft > 0
                      ? 'El código vence en $secondsLeft segundos.'
                      : 'El código venció. Solicita uno nuevo.',
                ),
                if (kDebugMode &&
                    widget.session.api.config.environment == 'development' &&
                    challenge!.developmentCode != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(
                        'Código de desarrollo: ${challenge!.developmentCode}',
                      ),
                    ),
                  ),
                TextField(
                  controller: code,
                  enabled: !busy && secondsLeft > 0,
                  keyboardType: TextInputType.number,
                  autofillHints: const [AutofillHints.oneTimeCode],
                  maxLength: 6,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(
                    labelText: 'Código de 6 dígitos',
                  ),
                  onSubmitted: (_) {
                    if (!busy && secondsLeft > 0) verify();
                  },
                ),
                FilledButton(
                  onPressed: busy || secondsLeft == 0 ? null : verify,
                  child: const Text('Verificar e ingresar'),
                ),
                TextButton(
                  onPressed: busy || !canRetry ? null : request,
                  child: const Text('Solicitar otro código'),
                ),
                TextButton(
                  onPressed: busy
                      ? null
                      : () => setState(() {
                          challenge = null;
                          error = null;
                        }),
                  child: const Text('Cambiar datos'),
                ),
              ],
              if (busy) const LinearProgressIndicator(),
              if (error != null) ErrorNotice(error!),
              if (widget.session.message != null)
                ErrorNotice(widget.session.message!),
              const SizedBox(height: 24),
              const Text('Pasajeros y encomiendas · Santa Cruz de la Sierra'),
            ],
          ),
        ),
      ),
    ),
  );
}
