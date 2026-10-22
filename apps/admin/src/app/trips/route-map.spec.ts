import { routeViewport } from './route-map';

describe('Mapa del recorrido', () => {
  it('encuadra la ruta GeoJSON con longitud y latitud y mantiene visibles ambos puntos', () => {
    const origin = { lat: -17.7833, lng: -63.1821 };
    const destination = { lat: -17.802, lng: -63.155 };
    const viewport = routeViewport(
      origin,
      destination,
      [
        [origin.lng, origin.lat],
        [-63.22, -17.81],
        [destination.lng, destination.lat],
      ],
      'https://tiles.example.test/{z}/{x}/{y}.png',
    );
    for (const marker of [viewport.origin, viewport.destination]) {
      expect(marker.x).toBeGreaterThan(20);
      expect(marker.x).toBeLessThan(620);
      expect(marker.y).toBeGreaterThan(20);
      expect(marker.y).toBeLessThan(340);
    }
    expect(viewport.route.split(' ')).toHaveLength(3);
    expect(viewport.tiles.length).toBeGreaterThan(0);
    expect(viewport.tiles.length).toBeLessThanOrEqual(12);
    expect(viewport.tiles.every((tile) => !tile.url.includes('{'))).toBe(true);
  });
});
