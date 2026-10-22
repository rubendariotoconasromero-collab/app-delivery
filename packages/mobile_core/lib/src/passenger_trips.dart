import 'dart:async';
import 'package:flutter/material.dart';
import 'api_client.dart';
import 'auth_home.dart';
import 'models.dart';
import 'trip_api.dart';
import 'trip_location.dart';
import 'trip_map.dart';
import 'trip_money.dart';

class PassengerTrips extends StatefulWidget {
  const PassengerTrips({
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
  State<PassengerTrips> createState() => _PassengerTripsState();
}

class _PassengerTripsState extends State<PassengerTrips>
    with WidgetsBindingObserver {
  late final TripApi trips = TripApi(widget.api, widget.journal);
  late final ForegroundLocation location =
      widget.location ?? DeviceForegroundLocation();
  final originAddress = TextEditingController();
  final destinationAddress = TextEditingController();
  final originReference = TextEditingController();
  final destinationReference = TextEditingController();
  Json? config, origin, destination, quote, trip;
  List<Json> history = [];
  String? error;
  bool busy = true, foreground = true, selectingOrigin = true;
  bool operationRunning = false;
  bool refreshing = false;
  int operationRevision = 0;
  bool? refreshedActive;
  bool get accountActive => widget.accountActive && (refreshedActive ?? true);
  int passengerCount = 1;
  Timer? timer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_load());
    timer = Timer.periodic(const Duration(seconds: 8), (_) {
      if (foreground && !busy) unawaited(_refresh());
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    foreground = state == AppLifecycleState.resumed;
    if (foreground && !busy) unawaited(_refresh());
  }

  @override
  void dispose() {
    timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    for (final c in [
      originAddress,
      destinationAddress,
      originReference,
      destinationReference,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() => _run(() async {
    await _account();
    config = await trips.get('trips/config');
    trip = await trips.active('client');
    final data = await trips.get('trips?role=client&limit=10&offset=0');
    history = (data['items'] as List).cast<Json>();
  });

  Future<void> _refresh() async {
    if (refreshing || operationRunning) return;
    refreshing = true;
    final revision = operationRevision;
    try {
      await _account();
      final result = trip != null
          ? await trips.trip(trip!['id'] as String)
          : await trips.active('client');
      if (mounted && revision == operationRevision) {
        setState(() {
          trip = result;
          error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = userMessage(e));
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

  void _select(double latitude, double longitude) {
    setState(() {
      if (selectingOrigin) {
        origin = {'latitude': latitude, 'longitude': longitude};
      } else {
        destination = {'latitude': latitude, 'longitude': longitude};
      }
      quote = null;
    });
  }

  Future<void> _coordinates() async {
    final point = await showDialog<Json>(
      context: context,
      builder: (_) =>
          CoordinateDialog(initial: selectingOrigin ? origin : destination),
    );
    if (point != null && mounted) {
      _select(
        (point['latitude'] as num).toDouble(),
        (point['longitude'] as num).toDouble(),
      );
    }
  }

  Future<void> _quote() => _run(() async {
    if (origin == null ||
        destination == null ||
        originAddress.text.trim().length < 3 ||
        destinationAddress.text.trim().length < 3) {
      throw const ApiFailure(
        ApiFailureKind.server,
        'Selecciona ambos puntos y escribe sus direcciones.',
      );
    }
    origin = {
      ...origin!,
      'address': originAddress.text.trim(),
      'reference': originReference.text.trim(),
    };
    destination = {
      ...destination!,
      'address': destinationAddress.text.trim(),
      'reference': destinationReference.text.trim(),
    };
    final data = await widget.api.sendJson(
      'POST',
      'trips/quotes',
      data: {
        'origin': origin,
        'destination': destination,
        'passengerCount': passengerCount,
      },
    );
    quote = data['quote'] as Json;
  });

  Future<void> _request() => _run(() async {
    if (quote == null) return;
    final existing = await trips.active('client');
    if (existing != null) {
      trip = existing;
      quote = null;
      return;
    }
    final result = await trips.mutate('trips', data: {'quoteId': quote!['id']});
    trip = result['trip'] as Json;
    quote = null;
  });

  Future<void> _cancel() async {
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => const TripReasonDialog(),
    );
    if (reason == null || !mounted) return;
    await _run(() async {
      trip =
          (await trips.mutate(
                'trips/${trip!['id']}/cancel',
                data: {'reason': reason},
              ))['trip']
              as Json;
    });
  }

  @override
  Widget build(BuildContext context) {
    final enabled = config?['enabled'] == true && accountActive;
    final quoteValid =
        quote != null &&
        DateTime.parse(quote!['expiresAt'] as String).isAfter(DateTime.now());
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Pasajeros', style: Theme.of(context).textTheme.headlineSmall),
        const Text('Santa Cruz de la Sierra · Bolivianos · Efectivo'),
        if (busy) const LinearProgressIndicator(),
        if (error != null) ErrorNotice(error!),
        OutlinedButton.icon(
          onPressed: busy ? null : _load,
          icon: const Icon(Icons.refresh),
          label: const Text('Actualizar viajes'),
        ),
        if (!accountActive)
          const ErrorNotice(
            'Tu acceso está limitado. Puedes consultar y finalizar el servicio existente; las nuevas solicitudes están deshabilitadas. Inicia una nueva sesión cuando se reactive la cuenta.',
          ),
        if (trip != null) ...[
          TripSummary(trip: trip!, client: true),
          if (widget.renderMap && config != null)
            TripMap(
              config: config!,
              origin: trip!['origin'] as Json,
              destination: trip!['destination'] as Json,
              route: trip!['route'] as Json,
            ),
          if (['assigned', 'arrived'].contains(trip!['state'])) ...[
            if (trip!['startCode'] != null)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      const Text('Código para iniciar tu viaje'),
                      SelectableText(
                        trip!['startCode'] as String,
                        style: Theme.of(context).textTheme.headlineLarge,
                      ),
                      const Text(
                        'Compártelo solo cuando estés junto al conductor correcto.',
                      ),
                      if (trip!['startCodeExpiresAt'] != null)
                        Text(
                          'Vence: ${DateTime.parse(trip!['startCodeExpiresAt'] as String).toLocal()}',
                        ),
                    ],
                  ),
                ),
              ),
            OutlinedButton(
              onPressed: busy
                  ? null
                  : () => _run(() async {
                      trip =
                          (await trips.mutate(
                                'trips/${trip!['id']}/start-code',
                              ))['trip']
                              as Json;
                    }),
              child: const Text('Renovar código de inicio'),
            ),
          ],
          if (['searching', 'assigned', 'arrived'].contains(trip!['state']))
            OutlinedButton(
              onPressed: busy ? null : _cancel,
              child: const Text('Cancelar solicitud'),
            ),
          if (trip!['state'] == 'searching')
            const Text(
              'El equipo operativo asignará un conductor. Mantén esta pantalla abierta o vuelve para consultar el estado.',
            ),
          if (tripIsTerminal(trip!))
            FilledButton(
              onPressed: busy
                  ? null
                  : () => _run(() async {
                      trip = await trips.active('client');
                      quote = null;
                    }),
              child: const Text('Preparar otro viaje'),
            ),
        ] else if (config != null) ...[
          if (!enabled)
            const ErrorNotice('Las nuevas solicitudes no están habilitadas.'),
          const Text(
            'Tarifa de prueba · No es una tarifa comercial definitiva.',
          ),
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: true, label: Text('Origen')),
              ButtonSegment(value: false, label: Text('Destino')),
            ],
            selected: {selectingOrigin},
            onSelectionChanged: busy
                ? null
                : (v) => setState(() => selectingOrigin = v.first),
          ),
          const SizedBox(height: 8),
          const Text(
            'Toca el mapa para elegir el punto seleccionado. Escribe la dirección y una referencia para que el conductor te encuentre.',
          ),
          if (widget.renderMap && enabled)
            TripMap(
              config: config!,
              origin: origin,
              destination: destination,
              route: quote?['route'] as Json?,
              onSelect: busy || !enabled ? null : _select,
            ),
          Wrap(
            spacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed: busy || !enabled ? null : _coordinates,
                icon: const Icon(Icons.pin_drop),
                label: const Text('Ingresar coordenadas'),
              ),
              OutlinedButton.icon(
                onPressed: busy || !enabled
                    ? null
                    : () => _run(() async {
                        final fix = await location.current();
                        if (mounted) _select(fix.lat, fix.lng);
                      }),
                icon: const Icon(Icons.my_location),
                label: const Text('Usar mi ubicación'),
              ),
            ],
          ),
          _pointForm('Origen', originAddress, originReference, origin),
          _pointForm(
            'Destino',
            destinationAddress,
            destinationReference,
            destination,
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<int>(
            initialValue: passengerCount,
            decoration: const InputDecoration(labelText: 'Número de pasajeros'),
            items: List.generate(
              8,
              (i) => DropdownMenuItem(value: i + 1, child: Text('${i + 1}')),
            ),
            onChanged: busy || !enabled
                ? null
                : (v) => setState(() {
                    passengerCount = v!;
                    quote = null;
                  }),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: busy || !enabled ? null : _quote,
            child: const Text('Calcular cotización'),
          ),
          if (quote != null) ...[
            QuoteSummary(quote: quote!),
            if (!quoteValid)
              const ErrorNotice(
                'La cotización venció. Calcula una nueva antes de solicitar.',
              ),
            FilledButton(
              onPressed: busy || !enabled || !quoteValid ? null : _request,
              child: Text(
                'Confirmar viaje por ${bolivianos(quote!['totalCents'] as int)} · Efectivo',
              ),
            ),
          ],
        ],
        if (history.isNotEmpty) ...[
          const SizedBox(height: 20),
          Text(
            'Viajes recientes',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          for (final item in history)
            ListTile(
              title: Text(tripStateLabel(item['state'])),
              subtitle: Text(
                '${(item['destination'] as Json)['address']} · ${bolivianos(item['totalCents'] as int)}',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: busy
                  ? null
                  : () => _run(() async {
                      trip = await trips.trip(item['id'] as String);
                    }),
            ),
        ],
        const SizedBox(height: 24),
        const Text(
          'Encomiendas: el envío puerta a puerta se incorporará en los siguientes loops.',
        ),
      ],
    );
  }

  Widget _pointForm(
    String label,
    TextEditingController address,
    TextEditingController reference,
    Json? point,
  ) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      TextFormField(
        controller: address,
        enabled: !busy,
        maxLength: 200,
        decoration: InputDecoration(labelText: 'Dirección de $label'),
        onChanged: (_) => setState(() => quote = null),
      ),
      TextFormField(
        controller: reference,
        enabled: !busy,
        maxLength: 300,
        decoration: InputDecoration(
          labelText: 'Referencia de $label (opcional)',
        ),
        onChanged: (_) => setState(() => quote = null),
      ),
      Text(
        point == null
            ? '$label: selecciona un punto.'
            : '$label: ${(point['latitude'] as num).toStringAsFixed(6)}, ${(point['longitude'] as num).toStringAsFixed(6)}',
      ),
    ],
  );
}

class QuoteSummary extends StatelessWidget {
  const QuoteSummary({super.key, required this.quote});
  final Json quote;
  @override
  Widget build(BuildContext context) {
    final route = quote['route'] as Json;
    final breakdown = quote['breakdown'] as Json;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              bolivianos(quote['totalCents'] as int),
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            Text(
              '${((route['distanceMeters'] as num) / 1000).toStringAsFixed(1)} km · ${((route['durationSeconds'] as num) / 60).ceil()} min estimados',
            ),
            Text(
              'Base ${bolivianos(breakdown['baseCents'] as int)} + distancia ${bolivianos(breakdown['distanceCents'] as int)} + tiempo ${bolivianos(breakdown['timeCents'] as int)}',
            ),
            Text(
              'Mínimo ${bolivianos(breakdown['minimumCents'] as int)} · Pago en efectivo',
            ),
            Text(
              'Vence: ${DateTime.parse(quote['expiresAt'] as String).toLocal()}',
            ),
            const Text(
              'Cotización de prueba. La ruta se calcula por calles con OSRM.',
            ),
          ],
        ),
      ),
    );
  }
}

class TripSummary extends StatelessWidget {
  const TripSummary({super.key, required this.trip, this.client = false});
  final Json trip;
  final bool client;
  @override
  Widget build(BuildContext context) {
    final driver = trip['driver'] as Json?;
    final vehicle = driver?['vehicle'] as Json?;
    final passenger = trip['client'] as Json;
    final cash = trip['cash'] as Json;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              tripStateLabel(trip['state']),
              style: Theme.of(context).textTheme.titleLarge,
            ),
            Text('Origen: ${(trip['origin'] as Json)['address']}'),
            if (((trip['origin'] as Json)['reference'] as String? ?? '')
                .isNotEmpty)
              Text('Referencia: ${(trip['origin'] as Json)['reference']}'),
            Text('Destino: ${(trip['destination'] as Json)['address']}'),
            if (((trip['destination'] as Json)['reference'] as String? ?? '')
                .isNotEmpty)
              Text('Referencia: ${(trip['destination'] as Json)['reference']}'),
            Text(
              '${trip['passengerCount']} pasajeros · ${bolivianos(trip['totalCents'] as int)} · Efectivo',
            ),
            if (client && driver != null) ...[
              Text('Conductor: ${driver['displayName']}'),
              if (driver['phone'] != null) Text('Teléfono: ${driver['phone']}'),
              if (vehicle != null)
                Text(
                  'Vehículo: ${vehicle['make']} ${vehicle['model']} · Placa ${vehicle['plate']}',
                ),
            ],
            if (!client) ...[
              Text('Cliente: ${passenger['displayName']}'),
              if (passenger['phone'] != null)
                Text('Teléfono: ${passenger['phone']}'),
            ],
            if (trip['state'] == 'completed') ...[
              Text(switch (cash['status']) {
                'declared_paid' => 'Efectivo declarado cobrado',
                'partial' => 'Cobro parcial declarado',
                'unpaid' =>
                  'Pago pendiente: conductor declaró que no recibió efectivo',
                _ => 'El conductor aún no registró el efectivo recibido',
              }),
              if (cash['receivedCents'] != null)
                Text('Recibido: ${bolivianos(cash['receivedCents'] as int)}'),
              const Text(
                'La declaración de efectivo está pendiente de conciliación operativa.',
              ),
            ],
            Text(
              'Servicio ${trip['id']}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

class CoordinateDialog extends StatefulWidget {
  const CoordinateDialog({super.key, this.initial});
  final Json? initial;
  @override
  State<CoordinateDialog> createState() => _CoordinateDialogState();
}

class _CoordinateDialogState extends State<CoordinateDialog> {
  late final lat = TextEditingController(
    text: widget.initial?['latitude']?.toString(),
  );
  late final lng = TextEditingController(
    text: widget.initial?['longitude']?.toString(),
  );
  final form = GlobalKey<FormState>();
  @override
  void dispose() {
    lat.dispose();
    lng.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Coordenadas del punto'),
    content: Form(
      key: form,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextFormField(
            controller: lat,
            keyboardType: const TextInputType.numberWithOptions(
              decimal: true,
              signed: true,
            ),
            decoration: const InputDecoration(
              labelText: 'Latitud',
              hintText: '-17.7833',
            ),
            validator: (v) {
              final n = double.tryParse(v?.replaceAll(',', '.') ?? '');
              return n == null || !n.isFinite || n < -90 || n > 90
                  ? 'Latitud inválida'
                  : null;
            },
          ),
          TextFormField(
            controller: lng,
            keyboardType: const TextInputType.numberWithOptions(
              decimal: true,
              signed: true,
            ),
            decoration: const InputDecoration(
              labelText: 'Longitud',
              hintText: '-63.1821',
            ),
            validator: (v) {
              final n = double.tryParse(v?.replaceAll(',', '.') ?? '');
              return n == null || !n.isFinite || n < -180 || n > 180
                  ? 'Longitud inválida'
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
            Navigator.pop(context, {
              'latitude': double.parse(lat.text.replaceAll(',', '.')),
              'longitude': double.parse(lng.text.replaceAll(',', '.')),
            });
          }
        },
        child: const Text('Usar punto'),
      ),
    ],
  );
}

class TripReasonDialog extends StatefulWidget {
  const TripReasonDialog({super.key});
  @override
  State<TripReasonDialog> createState() => _TripReasonDialogState();
}

class _TripReasonDialogState extends State<TripReasonDialog> {
  final reason = TextEditingController();
  final form = GlobalKey<FormState>();
  @override
  void dispose() {
    reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Cancelar solicitud'),
    content: Form(
      key: form,
      child: TextFormField(
        controller: reason,
        maxLength: 1000,
        decoration: const InputDecoration(labelText: 'Motivo de cancelación'),
        validator: (v) =>
            (v?.trim().length ?? 0) < 3 ? 'Describe el motivo.' : null,
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
            Navigator.pop(context, reason.text.trim());
          }
        },
        child: const Text('Confirmar cancelación'),
      ),
    ],
  );
}
