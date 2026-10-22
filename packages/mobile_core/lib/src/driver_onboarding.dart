import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'api_client.dart';
import 'auth_home.dart';
import 'models.dart';

String reviewLabel(Object? value) => switch (value) {
  'draft' => 'Borrador',
  'pending' => 'Pendiente de revisión',
  'approved' => 'Aprobado',
  'rejected' => 'Rechazado',
  'suspended' => 'Suspendido',
  _ => 'Sin estado',
};

class DriverOnboarding extends StatefulWidget {
  const DriverOnboarding({super.key, required this.api});
  final ApiClient api;
  @override
  State<DriverOnboarding> createState() => _DriverOnboardingState();
}

class _DriverOnboardingState extends State<DriverOnboarding> {
  Json? data;
  bool busy = true;
  String? error;
  final name = TextEditingController();
  final profileForm = GlobalKey<FormState>();
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    name.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final value = await widget.api.sendJson('GET', 'drivers/me');
      if (value['driver'] is! Json ||
          value['vehicles'] is! List ||
          value['documents'] is! List) {
        throw const FormatException('Perfil inválido.');
      }
      if (mounted) {
        setState(() {
          data = value;
          name.text = (value['driver'] as Json)['fullName'] as String? ?? '';
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = userMessage(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _mutate(Future<Object?> Function() action) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await action();
      if (mounted) await _load();
    } catch (e) {
      if (mounted) setState(() => error = userMessage(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _editVehicle([Json? vehicle]) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (_) => VehicleEditor(api: widget.api, vehicle: vehicle),
    );
    if (changed == true && mounted) await _load();
  }

  Future<void> _upload(String kind, {String? vehicleId}) async {
    final needsExpiration = kind != 'identity_document';
    DateTime? expiry;
    final dateResult = await showDialog<_DocumentDate>(
      context: context,
      builder: (_) => _DocumentDateDialog(required: needsExpiration),
    );
    if (dateResult == null || !mounted) return;
    expiry = dateResult.date;
    await _mutate(() async {
      final file = await FilePicker.pickFile(
        type: FileType.custom,
        allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png'],
      );
      if (file == null) return null;
      final size = await file.length();
      if (size == null || size <= 0 || size > 5 * 1024 * 1024) {
        throw const ApiFailure(
          ApiFailureKind.server,
          'El documento debe pesar entre 1 byte y 5 MiB.',
        );
      }
      final extension = file.name.split('.').last.toLowerCase();
      final mime = switch (extension) {
        'pdf' => 'application/pdf',
        'jpg' || 'jpeg' => 'image/jpeg',
        'png' => 'image/png',
        _ => '',
      };
      final bytes = await file.readAsBytes();
      return widget.api.uploadDocument(
        kind: kind,
        name: file.name,
        mimeType: mime,
        bytes: bytes,
        expiresOn: expiry?.toIso8601String().substring(0, 10),
        vehicleId: vehicleId,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final driver = data?['driver'] as Json?;
    final documents = (data?['documents'] as List? ?? []).cast<Json>();
    final vehicles = (data?['vehicles'] as List? ?? []).cast<Json>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Tu habilitación', style: Theme.of(context).textTheme.titleLarge),
        const Text(
          'Completa tu perfil y los documentos del vehículo para solicitar revisión.',
        ),
        if (busy)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: LinearProgressIndicator(),
          ),
        if (error != null) ErrorNotice(error!),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            onPressed: busy ? null : _load,
            icon: const Icon(Icons.refresh),
            label: const Text('Actualizar estado'),
          ),
        ),
        if (driver != null) ...[
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Conductor: ${reviewLabel(driver['reviewStatus'])}'),
                  if (driver['reviewReason'] != null)
                    Text('Motivo: ${driver['reviewReason']}'),
                  Text(
                    driver['eligible'] == true
                        ? 'Habilitación y vehículo activo vigentes.'
                        : 'Aún no tienes habilitación operativa completa.',
                  ),
                  const Text(
                    'La recepción de servicios se incorporará en el siguiente loop.',
                  ),
                ],
              ),
            ),
          ),
          Form(
            key: profileForm,
            child: TextFormField(
              controller: name,
              enabled: !busy,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Nombre completo del conductor',
                helperText: 'Debe coincidir con tu documentación.',
              ),
              validator: (v) => (v?.trim().length ?? 0) < 3
                  ? 'Introduce tu nombre completo.'
                  : null,
            ),
          ),
          const SizedBox(height: 8),
          OutlinedButton(
            onPressed: busy
                ? null
                : () {
                    if (profileForm.currentState!.validate()) {
                      _mutate(
                        () => widget.api.sendJson(
                          'PUT',
                          'drivers/me',
                          data: {'fullName': name.text.trim()},
                        ),
                      );
                    }
                  },
            child: const Text('Guardar perfil'),
          ),
          const Text(
            'Cambiar datos o documentos revisados requiere una nueva aprobación y desactiva el vehículo afectado.',
          ),
          const SizedBox(height: 16),
          Text(
            'Documentos del conductor',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          _documentTile(
            'Documento de identidad',
            'identity_document',
            documents,
          ),
          _documentTile('Licencia de conducir', 'driver_license', documents),
          const Text(
            'PDF, JPEG o PNG · Hasta 5 MiB · Se cargan de forma privada.',
          ),
          FilledButton(
            onPressed:
                busy || !['draft', 'rejected'].contains(driver['reviewStatus'])
                ? null
                : () => _mutate(
                    () => widget.api.sendJson(
                      'POST',
                      'drivers/me/submit',
                      data: {},
                    ),
                  ),
            child: const Text('Enviar perfil a revisión'),
          ),
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Vehículos',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              TextButton.icon(
                onPressed: busy ? null : _editVehicle,
                icon: const Icon(Icons.add),
                label: const Text('Agregar'),
              ),
            ],
          ),
          if (vehicles.isEmpty)
            const Text('Agrega tu primer vehículo y su documento de registro.'),
          for (final vehicle in vehicles)
            _vehicleCard(vehicle, documents, driver),
        ],
      ],
    );
  }

  Widget _documentTile(
    String title,
    String kind,
    List<Json> documents, {
    String? vehicleId,
  }) {
    final found = documents.where(
      (doc) => doc['kind'] == kind && doc['vehicleId'] == vehicleId,
    );
    final document = found.isEmpty ? null : found.first;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(title),
      subtitle: Text(
        document == null
            ? 'Sin cargar'
            : '${document['originalName']}\nVence: ${document['expiresOn'] ?? 'Sin vencimiento'}',
      ),
      trailing: TextButton(
        onPressed: busy ? null : () => _upload(kind, vehicleId: vehicleId),
        child: Text(document == null ? 'Cargar' : 'Sustituir'),
      ),
    );
  }

  Widget _vehicleCard(Json vehicle, List<Json> documents, Json driver) {
    final id = vehicle['id'] as String;
    final approved =
        vehicle['reviewStatus'] == 'approved' &&
        driver['reviewStatus'] == 'approved' &&
        _hasValidDocument(documents, 'identity_document') &&
        _hasValidDocument(documents, 'driver_license') &&
        _hasValidDocument(documents, 'vehicle_registration', vehicleId: id);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '${vehicle['plate']} · ${vehicle['make']} ${vehicle['model']}',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            Text(
              '${vehicle['year']} · ${vehicle['capacityPassengers']} pasajeros',
            ),
            Text(
              (vehicle['serviceTypes'] as List)
                  .map((v) => v == 'passengers' ? 'Pasajeros' : 'Encomiendas')
                  .join(' · '),
            ),
            Text('Revisión: ${reviewLabel(vehicle['reviewStatus'])}'),
            if (vehicle['reviewReason'] != null)
              Text('Motivo: ${vehicle['reviewReason']}'),
            if (vehicle['active'] == true) const Text('Vehículo seleccionado'),
            _documentTile(
              'Registro del vehículo',
              'vehicle_registration',
              documents,
              vehicleId: id,
            ),
            Wrap(
              spacing: 8,
              children: [
                OutlinedButton(
                  onPressed: busy ? null : () => _editVehicle(vehicle),
                  child: const Text('Editar'),
                ),
                FilledButton(
                  onPressed:
                      busy ||
                          ![
                            'draft',
                            'rejected',
                          ].contains(vehicle['reviewStatus'])
                      ? null
                      : () => _mutate(
                          () => widget.api.sendJson(
                            'POST',
                            'drivers/me/vehicles/$id/submit',
                            data: {},
                          ),
                        ),
                  child: const Text('Enviar vehículo a revisión'),
                ),
                OutlinedButton(
                  onPressed: busy || !approved || vehicle['active'] == true
                      ? null
                      : () => _mutate(
                          () => widget.api.sendJson(
                            'POST',
                            'drivers/me/vehicles/$id/activate',
                            data: {},
                          ),
                        ),
                  child: const Text('Seleccionar vehículo'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  bool _hasValidDocument(
    List<Json> documents,
    String kind, {
    String? vehicleId,
  }) {
    // The MVP market is America/La_Paz (UTC-4). The API is the final authority.
    final today = DateTime.now()
        .toUtc()
        .subtract(const Duration(hours: 4))
        .toIso8601String()
        .substring(0, 10);
    return documents.any(
      (doc) =>
          doc['kind'] == kind &&
          doc['vehicleId'] == vehicleId &&
          (doc['expiresOn'] == null ||
              (doc['expiresOn'] is String &&
                  (doc['expiresOn'] as String).compareTo(today) >= 0)),
    );
  }
}

class _DocumentDate {
  const _DocumentDate(this.date);
  final DateTime? date;
}

class _DocumentDateDialog extends StatefulWidget {
  const _DocumentDateDialog({required this.required});
  final bool required;
  @override
  State<_DocumentDateDialog> createState() => _DocumentDateDialogState();
}

class _DocumentDateDialogState extends State<_DocumentDateDialog> {
  DateTime? date;
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Vencimiento del documento'),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          widget.required
              ? 'Selecciona una fecha futura antes de cargar el archivo.'
              : 'Puedes indicar el vencimiento de tu documento de identidad.',
        ),
        TextButton(
          onPressed: () async {
            final now = DateTime.now();
            final picked = await showDatePicker(
              context: context,
              firstDate: DateTime(now.year, now.month, now.day + 1),
              lastDate: DateTime(now.year + 30),
              initialDate: date ?? DateTime(now.year + 1, now.month, now.day),
            );
            if (mounted && picked != null) setState(() => date = picked);
          },
          child: Text(
            date == null
                ? 'Elegir fecha'
                : date!.toIso8601String().substring(0, 10),
          ),
        ),
      ],
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancelar'),
      ),
      FilledButton(
        onPressed: widget.required && date == null
            ? null
            : () => Navigator.pop(context, _DocumentDate(date)),
        child: const Text('Seleccionar archivo'),
      ),
    ],
  );
}

class VehicleEditor extends StatefulWidget {
  const VehicleEditor({super.key, required this.api, this.vehicle});
  final ApiClient api;
  final Json? vehicle;
  @override
  State<VehicleEditor> createState() => _VehicleEditorState();
}

class _VehicleEditorState extends State<VehicleEditor> {
  final form = GlobalKey<FormState>();
  late final Map<String, TextEditingController> fields;
  late Set<String> services;
  bool busy = false;
  String? error;
  @override
  void initState() {
    super.initState();
    fields = {
      for (final key in [
        'plate',
        'make',
        'model',
        'year',
        'capacityPassengers',
      ])
        key: TextEditingController(
          text: widget.vehicle?[key]?.toString() ?? '',
        ),
    };
    services = (widget.vehicle?['serviceTypes'] as List? ?? ['passengers'])
        .cast<String>()
        .toSet();
  }

  @override
  void dispose() {
    for (final field in fields.values) {
      field.dispose();
    }
    super.dispose();
  }

  Future<void> save() async {
    if (!form.currentState!.validate()) return;
    if (services.isEmpty) {
      setState(() => error = 'Selecciona al menos una modalidad.');
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await widget.api.sendJson(
        widget.vehicle == null ? 'POST' : 'PUT',
        'drivers/me/vehicles${widget.vehicle == null ? '' : '/${widget.vehicle!['id']}'}',
        data: {
          'plate': fields['plate']!.text.trim().toUpperCase(),
          'make': fields['make']!.text.trim(),
          'model': fields['model']!.text.trim(),
          'year': int.parse(fields['year']!.text),
          'capacityPassengers': int.parse(fields['capacityPassengers']!.text),
          'serviceTypes': services.toList(),
        },
      );
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() => error = userMessage(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(
      widget.vehicle == null ? 'Agregar vehículo' : 'Editar vehículo',
    ),
    content: SizedBox(
      width: 440,
      child: SingleChildScrollView(
        child: Form(
          key: form,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (final pair in {
                'plate': 'Placa',
                'make': 'Marca',
                'model': 'Modelo',
                'year': 'Año',
                'capacityPassengers': 'Capacidad de pasajeros',
              }.entries)
                TextFormField(
                  controller: fields[pair.key],
                  enabled: !busy,
                  decoration: InputDecoration(labelText: pair.value),
                  keyboardType:
                      ['year', 'capacityPassengers'].contains(pair.key)
                      ? TextInputType.number
                      : TextInputType.text,
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) {
                      return 'Campo obligatorio.';
                    }
                    if (pair.key == 'year' &&
                        (int.tryParse(v) == null ||
                            int.parse(v) < 1980 ||
                            int.parse(v) > DateTime.now().year + 1)) {
                      return 'Año no válido.';
                    }
                    if (pair.key == 'capacityPassengers' &&
                        (int.tryParse(v) == null ||
                            int.parse(v) < 1 ||
                            int.parse(v) > 8)) {
                      return 'Capacidad entre 1 y 8.';
                    }
                    return null;
                  },
                ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Pasajeros'),
                value: services.contains('passengers'),
                onChanged: busy
                    ? null
                    : (v) => setState(() {
                        if (v == true) {
                          services.add('passengers');
                        } else {
                          services.remove('passengers');
                        }
                      }),
              ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Encomiendas'),
                value: services.contains('parcels'),
                onChanged: busy
                    ? null
                    : (v) => setState(() {
                        if (v == true) {
                          services.add('parcels');
                        } else {
                          services.remove('parcels');
                        }
                      }),
              ),
              if (busy) const LinearProgressIndicator(),
              if (error != null) ErrorNotice(error!),
            ],
          ),
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: busy ? null : () => Navigator.pop(context),
        child: const Text('Cancelar'),
      ),
      FilledButton(
        onPressed: busy ? null : save,
        child: const Text('Guardar vehículo'),
      ),
    ],
  );
}
