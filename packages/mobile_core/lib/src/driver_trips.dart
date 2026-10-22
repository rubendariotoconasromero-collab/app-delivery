import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'api_client.dart';
import 'auth_home.dart';
import 'models.dart';
import 'passenger_trips.dart';
import 'trip_api.dart';
import 'trip_location.dart';
import 'trip_map.dart';
import 'trip_money.dart';

class DriverTrips extends StatefulWidget {
  const DriverTrips({
    super.key,
    required this.api,
    required this.journal,
    this.accountActive = true,
    this.location,
    this.renderMap = true,
  });
  final ApiClient api;
  final TripJournal journal;
  final bool accountActive;
  final ForegroundLocation? location;
  final bool renderMap;
  @override
  State<DriverTrips> createState() => _DriverTripsState();
}

class _DriverTripsState extends State<DriverTrips> with WidgetsBindingObserver {
  late final TripApi trips = TripApi(widget.api, widget.journal);
  late final ForegroundLocation location =
      widget.location ?? DeviceForegroundLocation();
  Json? config, availability, trip;
  List<Json> offers = [], history = [];
  int historyTotal = 0;
  String? error;
  bool busy = true, foreground = true, refreshing = false;
  bool operationRunning = false;
  int operationRevision = 0;
  bool? refreshedActive;
  bool get accountActive => widget.accountActive && (refreshedActive ?? true);
  DateTime? lastGps;
  Timer? timer;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_load());
    timer = Timer.periodic(const Duration(seconds: 8), (_) {
      if (foreground && !busy && !refreshing) unawaited(_refresh());
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    foreground = state == AppLifecycleState.resumed;
    if (foreground && !busy) unawaited(_refresh());
    if (!foreground && availability?['online'] == true) {
      // Stops receiving offers when the foreground-only app is hidden.
      unawaited(_offlineOnPause());
    }
  }

  Future<void> _offlineOnPause() async {
    try {
      final result = await widget.api.sendJson(
        'PUT',
        'drivers/me/availability',
        data: {'online': false},
      );
      if (mounted) setState(() => availability = result);
    } catch (_) {
      /* Server GPS freshness lease also prevents stale availability. */
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _load() => _run(() async {
    await _account();
    config = await trips.get('trips/config');
    trip = await trips.active('driver');
    if (accountActive) {
      availability = await trips.get('drivers/me/availability');
      offers = ((await trips.get('drivers/me/trip-offers'))['items'] as List)
          .cast<Json>();
    } else {
      availability = {
        'online': false,
        'available': false,
        'reason': 'Acceso limitado al servicio existente',
        'location': null,
      };
      offers = [];
    }
    await _history(reset: true);
  });
  Future<void> _history({required bool reset}) async {
    final offset = reset ? 0 : history.length;
    final page = await trips.get('trips?role=driver&limit=20&offset=$offset');
    final items = (page['items'] as List).cast<Json>();
    history = reset ? items : [...history, ...items];
    historyTotal = (page['total'] as num?)?.toInt() ?? history.length;
  }

  Future<void> _gps() async {
    final fix = await location.current();
    availability = await widget.api.sendJson(
      'POST',
      'drivers/me/location',
      data: fix.toJson(),
    );
    lastGps = DateTime.now();
  }

  Future<void> _refresh() async {
    if (refreshing || operationRunning) return;
    refreshing = true;
    final revision = operationRevision;
    try {
      await _account();
      if (availability?['online'] == true &&
          (lastGps == null ||
              DateTime.now().difference(lastGps!).inSeconds >= 20)) {
        await _gps();
      }
      final nextAvailability = accountActive
          ? await trips.get('drivers/me/availability')
          : <String, dynamic>{
              'online': false,
              'available': false,
              'reason': 'Acceso limitado al servicio existente',
              'location': null,
            };
      final nextTrip = trip != null
          ? await trips.trip(trip!['id'] as String)
          : await trips.active('driver');
      final nextOffers = accountActive
          ? ((await trips.get('drivers/me/trip-offers'))['items'] as List)
                .cast<Json>()
          : <Json>[];
      if (mounted && !busy && revision == operationRevision) {
        setState(() {
          availability = nextAvailability;
          trip = nextTrip;
          offers = nextOffers;
          error = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(
          () => error = e is LocationFailure ? e.message : userMessage(e),
        );
      }
    } finally {
      refreshing = false;
    }
  }

  Future<void> _account() async {
    final me = await widget.api.me();
    if (me['user'] case final Json user) {
      refreshedActive = user['status'] == 'active' && me['restricted'] != true;
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    if (operationRunning) return;
    operationRunning = true;
    operationRevision++;
    if (mounted) {
      setState(() {
        busy = true;
        error = null;
      });
    }
    try {
      await action();
    } catch (e) {
      if (mounted) {
        setState(
          () => error = e is LocationFailure ? e.message : userMessage(e),
        );
      }
    } finally {
      operationRunning = false;
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _toggleOnline(bool online) => _run(() async {
    if (online) await _gps();
    availability = await widget.api.sendJson(
      'PUT',
      'drivers/me/availability',
      data: {'online': online},
    );
  });
  Future<void> _respond(Json offer, String decision) => _run(() async {
    if (decision == 'accept') await _gps();
    final result = await trips.mutate(
      'drivers/me/trip-offers/${offer['id']}/respond',
      data: {'decision': decision},
    );
    if (decision == 'accept') trip = result['trip'] as Json;
    offers = ((await trips.get('drivers/me/trip-offers'))['items'] as List)
        .cast<Json>();
    availability = await trips.get('drivers/me/availability');
  });
  Future<void> _transition(String action, {Json data = const {}}) =>
      _run(() async {
        if (action == 'arrive' || action == 'finish') await _gps();
        trip =
            (await trips.mutate(
                  'trips/${trip!['id']}/$action',
                  data: data,
                ))['trip']
                as Json;
      });
  Future<void> _start() async {
    final pin = await showDialog<String>(
      context: context,
      builder: (_) => const StartPinDialog(),
    );
    if (pin != null && mounted) await _transition('start', data: {'pin': pin});
  }

  Future<void> _cash() async {
    final amount = await showDialog<int>(
      context: context,
      builder: (_) => CashDialog(totalCents: trip!['totalCents'] as int),
    );
    if (amount != null && mounted) {
      await _transition('cash', data: {'receivedCents': amount});
    }
  }

  Future<void> _confirmFinish() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Finalizar viaje'),
        content: const Text(
          'Confirma que llegaste al destino. Después registrarás el efectivo realmente recibido.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Volver'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Confirmar llegada al destino'),
          ),
        ],
      ),
    );
    if (confirmed == true && mounted) await _transition('finish');
  }

  @override
  Widget build(BuildContext context) {
    final online = availability?['online'] == true;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Tus viajes', style: Theme.of(context).textTheme.headlineSmall),
        const Text(
          'Pasajeros · Asignación desde operaciones · Tarifas de prueba',
        ),
        if (busy) const LinearProgressIndicator(),
        if (error != null) ErrorNotice(error!),
        if (!accountActive)
          const ErrorNotice(
            'Acceso limitado. Atiende únicamente el viaje ya asignado; no puedes recibir nuevos servicios. Inicia una nueva sesión cuando se reactive la cuenta.',
          ),
        OutlinedButton.icon(
          onPressed: busy ? null : _load,
          icon: const Icon(Icons.refresh),
          label: const Text('Actualizar viajes'),
        ),
        if (availability != null)
          Card(
            child: Column(
              children: [
                SwitchListTile(
                  title: Text(online ? 'En línea' : 'Desconectado'),
                  value: online,
                  subtitle: Text(
                    availability?['available'] == true
                        ? 'Disponible para una asignación'
                        : (availability?['reason'] as String? ??
                              'Sin disponibilidad para nuevos viajes'),
                  ),
                  onChanged:
                      busy || !accountActive || config?['enabled'] != true
                      ? null
                      : _toggleOnline,
                ),
                const Padding(
                  padding: EdgeInsets.fromLTRB(16, 0, 16, 12),
                  child: Text(
                    'La ubicación se actualiza con esta app abierta. Al ocultarla se solicita la desconexión; el servicio en curso se conserva.',
                  ),
                ),
                if (availability?['location'] != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                    child: Text(
                      'Última ubicación: ${DateTime.parse((availability!['location'] as Json)['capturedAt'] as String).toLocal()}',
                    ),
                  ),
                OutlinedButton.icon(
                  onPressed: busy ? null : () => _run(_gps),
                  icon: const Icon(Icons.my_location),
                  label: const Text('Actualizar ubicación GPS'),
                ),
              ],
            ),
          ),
        if (trip != null) ...[
          TripSummary(trip: trip!),
          if (widget.renderMap && config != null)
            TripMap(
              config: config!,
              origin: trip!['origin'] as Json,
              destination: trip!['destination'] as Json,
              route: trip!['route'] as Json,
              driver: true,
            ),
          if (trip!['state'] == 'assigned')
            FilledButton(
              onPressed: busy ? null : () => _transition('arrive'),
              child: const Text('Llegué al origen'),
            ),
          if (trip!['state'] == 'arrived')
            FilledButton(
              onPressed: busy ? null : _start,
              child: const Text('Iniciar con código del pasajero'),
            ),
          if (trip!['state'] == 'in_progress')
            FilledButton(
              onPressed: busy ? null : _confirmFinish,
              child: const Text('Finalizar viaje en destino'),
            ),
          if (trip!['state'] == 'completed' &&
              (trip!['cash'] as Json)['status'] == 'pending')
            FilledButton(
              onPressed: busy ? null : _cash,
              child: const Text('Registrar efectivo recibido'),
            ),
          if (tripIsTerminal(trip!))
            OutlinedButton(
              onPressed: busy
                  ? null
                  : () => _run(() async {
                      trip = await trips.active('driver');
                      await _history(reset: true);
                    }),
              child: const Text('Volver a servicios disponibles'),
            ),
        ],
        if (offers.isNotEmpty) ...[
          Text(
            'Asignaciones por responder',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          for (final offer in offers)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    TripSummary(trip: offer['trip'] as Json),
                    Text(
                      'Responde antes de ${DateTime.parse(offer['expiresAt'] as String).toLocal()}',
                    ),
                    FilledButton(
                      onPressed: busy || !accountActive
                          ? null
                          : () => _respond(offer, 'accept'),
                      child: const Text('Aceptar asignación'),
                    ),
                    OutlinedButton(
                      onPressed: busy ? null : () => _respond(offer, 'reject'),
                      child: const Text('Rechazar asignación'),
                    ),
                  ],
                ),
              ),
            ),
        ] else if (trip == null)
          const Padding(
            padding: EdgeInsets.all(12),
            child: Text(
              'No hay asignaciones pendientes. Activa tu disponibilidad para recibir una propuesta del equipo operativo.',
            ),
          ),
        if (history.isNotEmpty) ...[
          const SizedBox(height: 20),
          Text(
            'Historial y cobros pendientes',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          for (final item in history)
            ListTile(
              title: Text(tripStateLabel(item['state'])),
              subtitle: Text(
                '${(item['destination'] as Json)['address']} · ${bolivianos(item['totalCents'] as int)}${item['state'] == 'completed' && (item['cash'] as Json)['status'] == 'pending' ? ' · Efectivo por registrar' : ''}',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: busy
                  ? null
                  : () => _run(() async {
                      trip = await trips.trip(item['id'] as String);
                    }),
            ),
          if (history.length < historyTotal)
            OutlinedButton(
              onPressed: busy ? null : () => _run(() => _history(reset: false)),
              child: const Text('Ver viajes anteriores'),
            ),
        ],
      ],
    );
  }
}

class StartPinDialog extends StatefulWidget {
  const StartPinDialog({super.key});
  @override
  State<StartPinDialog> createState() => _StartPinDialogState();
}

class _StartPinDialogState extends State<StartPinDialog> {
  final pin = TextEditingController();
  final form = GlobalKey<FormState>();
  @override
  void dispose() {
    pin.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Código del pasajero'),
    content: Form(
      key: form,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            'Solicita el código al pasajero cuando esté contigo. Los intentos son limitados.',
          ),
          TextFormField(
            controller: pin,
            keyboardType: TextInputType.number,
            maxLength: 6,
            obscureText: true,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: const InputDecoration(
              labelText: 'Código de inicio de 6 dígitos',
            ),
            validator: (v) => RegExp(r'^\d{6}$').hasMatch(v ?? '')
                ? null
                : 'Introduce seis dígitos.',
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Volver'),
      ),
      FilledButton(
        onPressed: () {
          if (form.currentState!.validate()) Navigator.pop(context, pin.text);
        },
        child: const Text('Validar e iniciar'),
      ),
    ],
  );
}

class CashDialog extends StatefulWidget {
  const CashDialog({super.key, required this.totalCents});
  final int totalCents;
  @override
  State<CashDialog> createState() => _CashDialogState();
}

class _CashDialogState extends State<CashDialog> {
  final amount = TextEditingController();
  final form = GlobalKey<FormState>();
  @override
  void dispose() {
    amount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Declarar efectivo recibido'),
    content: Form(
      key: form,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('Total del viaje: ${bolivianos(widget.totalCents)}'),
          const Text(
            'Registra el importe del viaje que recibiste, después de dar el cambio. Usa 0 si no hubo pago. Esta declaración se registra una sola vez.',
          ),
          TextFormField(
            controller: amount,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              labelText: 'Importe recibido en Bs',
              hintText: '12,50',
            ),
            validator: (v) {
              final cents = parseBolivianos(v ?? '');
              return cents == null || cents > widget.totalCents
                  ? 'Introduce entre Bs 0 y el total, con máximo dos decimales.'
                  : null;
            },
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Volver'),
      ),
      FilledButton(
        onPressed: () {
          if (form.currentState!.validate()) {
            Navigator.pop(context, parseBolivianos(amount.text));
          }
        },
        child: const Text('Confirmar declaración de efectivo'),
      ),
    ],
  );
}
