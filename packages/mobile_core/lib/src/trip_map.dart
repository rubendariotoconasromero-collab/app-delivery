import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'models.dart';

class TripMap extends StatelessWidget {
  const TripMap({
    super.key,
    required this.config,
    this.origin,
    this.destination,
    this.route,
    this.onSelect,
    this.driver = false,
  });
  final Json config;
  final Json? origin;
  final Json? destination;
  final Json? route;
  final void Function(double latitude, double longitude)? onSelect;
  final bool driver;

  LatLng _point(Json point) => LatLng(
    (point['latitude'] as num).toDouble(),
    (point['longitude'] as num).toDouble(),
  );

  @override
  Widget build(BuildContext context) {
    final settings = config['map'] as Json;
    final uri = Uri.tryParse(settings['tileUrl'] as String? ?? '');
    if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) {
      return const SizedBox(
        height: 100,
        child: Center(
          child: Text('El proveedor del mapa no está configurado con HTTPS.'),
        ),
      );
    }
    final points =
        ((route?['geometry'] as Json?)?['coordinates'] as List? ?? [])
            .map(
              (p) => LatLng((p[1] as num).toDouble(), (p[0] as num).toDouble()),
            )
            .toList(growable: false);
    final markers = <Marker>[
      if (origin != null)
        Marker(
          point: _point(origin!),
          width: 42,
          height: 42,
          child: const Tooltip(
            message: 'Origen',
            child: Icon(Icons.trip_origin, color: Colors.green, size: 36),
          ),
        ),
      if (destination != null)
        Marker(
          point: _point(destination!),
          width: 42,
          height: 42,
          child: const Tooltip(
            message: 'Destino',
            child: Icon(Icons.location_on, color: Colors.red, size: 40),
          ),
        ),
    ];
    final routeBounds = <LatLng>[
      if (origin != null) _point(origin!),
      if (destination != null) _point(destination!),
      ...points,
    ];
    return SizedBox(
      height: 300,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: FlutterMap(
          key: ValueKey(
            '${origin?['latitude']}/${origin?['longitude']}/${destination?['latitude']}/${destination?['longitude']}/${points.length}',
          ),
          options: MapOptions(
            initialCenter: origin == null
                ? const LatLng(-17.7833, -63.1821)
                : _point(origin!),
            initialZoom: 13,
            initialCameraFit: origin != null && destination != null
                ? CameraFit.bounds(
                    bounds: LatLngBounds.fromPoints(routeBounds),
                    padding: const EdgeInsets.all(48),
                    maxZoom: 16,
                  )
                : null,
            minZoom: 10,
            maxZoom: 19,
            interactionOptions: const InteractionOptions(
              flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
            ),
            onTap: onSelect == null
                ? null
                : (_, point) => onSelect!(point.latitude, point.longitude),
          ),
          children: [
            _TripTiles(url: settings['tileUrl'] as String, driver: driver),
            if (points.isNotEmpty)
              PolylineLayer(
                polylines: [
                  Polyline(
                    points: points,
                    color: const Color(0xff075e54),
                    strokeWidth: 5,
                  ),
                ],
              ),
            MarkerLayer(markers: markers),
            Align(
              alignment: Alignment.bottomRight,
              child: Container(
                color: Colors.white.withValues(alpha: .95),
                padding: const EdgeInsets.all(5),
                child: Text(
                  '${settings['attribution'] ?? '© OpenStreetMap contributors'}\n${settings['attributionUrl'] ?? 'https://www.openstreetmap.org/copyright'}',
                  style: const TextStyle(fontSize: 10, color: Colors.black87),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TripTiles extends StatefulWidget {
  const _TripTiles({required this.url, required this.driver});
  final String url;
  final bool driver;
  @override
  State<_TripTiles> createState() => _TripTilesState();
}

class _TripTilesState extends State<_TripTiles> {
  // TileLayer owns and disposes this provider; retain it across poll rebuilds.
  late final provider = NetworkTileProvider();
  @override
  Widget build(BuildContext context) => TileLayer(
    urlTemplate: widget.url,
    userAgentPackageName: widget.driver
        ? 'bo.appdelivery.driver'
        : 'bo.appdelivery.client',
    // Honors HTTP cache headers, with a seven-day fallback on native devices.
    tileProvider: provider,
    maxNativeZoom: 19,
  );
}
