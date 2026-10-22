import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { distanceMeters, TripPoint } from './trip.rules';

export type TripRoute = {
  distanceMeters: number;
  durationSeconds: number;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  provider: 'osrm';
};
@Injectable()
export class TripRouting {
  constructor(@Inject(AppConfig) private readonly config: AppConfig) {}
  async calculate(origin: TripPoint, destination: TripPoint): Promise<TripRoute> {
    const values = this.config.values as unknown as Record<string, unknown>;
    if (!values.TRIP_DEVELOPMENT_ENABLED || values.NODE_ENV === 'production')
      throw new ServiceUnavailableException('Los viajes de prueba están deshabilitados.');
    if (!values.TRIP_OSRM_URL)
      throw new ServiceUnavailableException(
        'Configura el proveedor de rutas antes de cotizar viajes.',
      );
    if (distanceMeters(origin, destination) < 200)
      throw new BadRequestException(
        'El origen y destino deben estar separados al menos 200 metros.',
      );
    try {
      const base = String(values.TRIP_OSRM_URL).replace(/\/$/, '');
      const response = await fetch(
        `${base}/route/v1/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=full&geometries=geojson&steps=false`,
        {
          signal: AbortSignal.timeout(6000),
          redirect: 'error',
          headers: {
            'User-Agent': 'AppDelivery-development/0.3 (Santa Cruz passenger MVP)',
            Accept: 'application/json',
          },
        },
      );
      if (!response.ok) throw new Error('route');
      const text = await response.text();
      if (text.length > 3000000) throw new Error('route-size');
      const body = JSON.parse(text) as {
        code?: string;
        waypoints?: { distance: number; location: [number, number] }[];
        routes?: {
          distance: number;
          duration: number;
          geometry: { type?: string; coordinates: [number, number][] };
        }[];
      };
      const route = body.routes?.[0];
      if (
        body.code !== 'Ok' ||
        !route ||
        !Number.isFinite(route.distance) ||
        !Number.isFinite(route.duration) ||
        route.distance < 200 ||
        route.distance > 200000 ||
        route.duration <= 0 ||
        route.duration > 14400 ||
        route.geometry?.type !== 'LineString' ||
        !Array.isArray(route.geometry?.coordinates) ||
        route.geometry.coordinates.length < 2 ||
        route.geometry.coordinates.length > 100000 ||
        !body.waypoints ||
        body.waypoints.length !== 2 ||
        body.waypoints.some(
          (point, index) =>
            !Number.isFinite(point.distance) ||
            point.distance < 0 ||
            point.distance > 200 ||
            !Array.isArray(point.location) ||
            point.location.length !== 2 ||
            !point.location.every(Number.isFinite) ||
            distanceMeters(index === 0 ? origin : destination, {
              longitude: point.location[0],
              latitude: point.location[1],
            }) > 200,
        ) ||
        route.geometry.coordinates.some(
          (point) =>
            !Array.isArray(point) ||
            point.length !== 2 ||
            !point.every(Number.isFinite) ||
            Math.abs(point[0]) > 180 ||
            Math.abs(point[1]) > 90,
        )
      )
        throw new Error('route');
      return {
        distanceMeters: Math.ceil(route.distance),
        durationSeconds: Math.ceil(route.duration),
        geometry: { type: 'LineString', coordinates: route.geometry.coordinates },
        provider: 'osrm',
      };
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo obtener una ruta válida. Intenta nuevamente.',
      );
    }
  }
}
