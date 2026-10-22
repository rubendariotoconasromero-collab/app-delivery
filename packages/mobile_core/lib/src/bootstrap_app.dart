import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'api_client.dart';
import 'api_config.dart';
import 'models.dart';
import 'auth_home.dart';
import 'session_store.dart';

enum AppAudience { client, driver }

class AppDeliveryApp extends StatelessWidget {
  const AppDeliveryApp({
    super.key,
    required this.audience,
    this.apiClient,
    this.sessionStore,
  });

  final AppAudience audience;
  final ApiClient? apiClient;
  final SessionStore? sessionStore;

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: audience == AppAudience.client
        ? 'AppDelivery Cliente'
        : 'AppDelivery Conductor',
    debugShowCheckedModeBanner: false,
    locale: const Locale('es', 'BO'),
    supportedLocales: const [Locale('es', 'BO')],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff075e54)),
      useMaterial3: true,
      scaffoldBackgroundColor: const Color(0xfff5f7f6),
    ),
    home: AuthHome(
      role: audience.name,
      apiClient: apiClient,
      sessionStore: sessionStore,
      diagnosticBuilder: () =>
          BootstrapPage(audience: audience, apiClient: apiClient),
    ),
  );
}

class BootstrapPage extends StatefulWidget {
  const BootstrapPage({super.key, required this.audience, this.apiClient});

  final AppAudience audience;
  final ApiClient? apiClient;

  @override
  State<BootstrapPage> createState() => _BootstrapPageState();
}

class _BootstrapPageState extends State<BootstrapPage> {
  late final ApiClient _api;
  late Future<ConnectionSnapshot> _connection;

  @override
  void initState() {
    super.initState();
    _api = widget.apiClient ?? ApiClient(config: ApiConfig.fromDefines());
    _connection = _api.checkConnection();
  }

  @override
  void dispose() {
    if (widget.apiClient == null) _api.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isClient = widget.audience == AppAudience.client;
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(
          isClient ? 'AppDelivery · Cliente' : 'AppDelivery · Conductor',
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 640),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: 24),
                  Icon(
                    isClient ? Icons.route_rounded : Icons.local_taxi_rounded,
                    size: 52,
                    color: theme.colorScheme.primary,
                  ),
                  const SizedBox(height: 24),
                  Text(
                    isClient
                        ? 'Tu próximo destino,\nmás cerca.'
                        : 'Conecta la ciudad.\nMueve oportunidades.',
                    style: theme.textTheme.headlineLarge?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    isClient
                        ? 'Viajes de pasajeros y encomiendas puerta a puerta '
                              'en Santa Cruz de la Sierra.'
                        : 'Una app para atender viajes de pasajeros y entregas '
                              'de encomiendas en Santa Cruz de la Sierra.',
                    style: theme.textTheme.bodyLarge,
                  ),
                  const SizedBox(height: 20),
                  const Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      Chip(
                        avatar: Icon(Icons.people_outline),
                        label: Text('Pasajeros'),
                      ),
                      Chip(
                        avatar: Icon(Icons.inventory_2_outlined),
                        label: Text('Encomiendas'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'Base de desarrollo · Loop 1',
                    style: theme.textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    isClient
                        ? 'La cuenta, las solicitudes y el seguimiento se '
                              'incorporarán en los próximos loops.'
                        : 'El registro, la habilitación y las ofertas de '
                              'servicio se incorporarán en los próximos loops.',
                  ),
                  const SizedBox(height: 24),
                  FutureBuilder<ConnectionSnapshot>(
                    future: _connection,
                    builder: (context, snapshot) => _ConnectionCard(
                      snapshot: snapshot,
                      endpoint: _api.config.baseUrl.toString(),
                      showEndpoint: _api.config.environment == 'development',
                      onRetry: () => setState(() {
                        _connection = _api.checkConnection();
                      }),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ConnectionCard extends StatelessWidget {
  const _ConnectionCard({
    required this.snapshot,
    required this.endpoint,
    required this.showEndpoint,
    required this.onRetry,
  });

  final AsyncSnapshot<ConnectionSnapshot> snapshot;
  final String endpoint;
  final bool showEndpoint;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final loading = snapshot.connectionState != ConnectionState.done;
    final data = snapshot.data;
    final ready = data?.readiness.isReady == true;
    final error = snapshot.error;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                if (loading)
                  const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                else
                  Icon(
                    ready ? Icons.check_circle_outline : Icons.info_outline,
                    color: ready
                        ? Colors.green.shade700
                        : Colors.orange.shade800,
                  ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    loading
                        ? 'Comprobando conexión…'
                        : error != null
                        ? 'No se pudo comprobar la conexión'
                        : ready
                        ? 'Plataforma conectada'
                        : 'Plataforma temporalmente no disponible',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (data != null) ...[
              Text('${data.info.market.city} · ${data.info.market.country}'),
              Text(
                'Moneda: ${data.info.market.currencySymbol} '
                '(${data.info.market.currency})',
              ),
              const SizedBox(height: 8),
              Text(
                ready
                    ? 'API y servicios de datos disponibles.'
                    : 'La API responde; uno o más servicios de datos no están disponibles.',
              ),
            ],
            if (error != null)
              Text(
                error is ApiFailure
                    ? error.message
                    : 'Ocurrió un error al consultar la plataforma.',
              ),
            if (showEndpoint) ...[
              const SizedBox(height: 12),
              SelectableText(
                endpoint,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: loading ? null : onRetry,
              icon: const Icon(Icons.refresh),
              label: Text(error != null ? 'Reintentar' : 'Comprobar de nuevo'),
            ),
          ],
        ),
      ),
    );
  }
}
