import { Component, computed, input } from '@angular/core';

export interface MapPoint {
  lat: number;
  lng: number;
}

interface MapTile {
  key: string;
  x: number;
  y: number;
  url: string;
}

const width = 640;
const height = 360;

function project(point: MapPoint, zoom: number): { x: number; y: number } {
  const scale = 256 * 2 ** zoom;
  const latitude = (Math.max(-85, Math.min(85, point.lat)) * Math.PI) / 180;
  return {
    x: ((point.lng + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2) * scale,
  };
}

export function routeViewport(
  origin: MapPoint,
  destination: MapPoint,
  geometry: number[][],
  tileTemplate: string,
) {
  const points = [
    origin,
    destination,
    ...geometry
      .filter((coordinate) => coordinate.length >= 2 && coordinate.every(Number.isFinite))
      .map(([lng, lat]) => ({ lat, lng })),
  ];
  let zoom = 17;
  let projected = points.map((point) => project(point, zoom));
  const bounds = () =>
    projected.reduce(
      (box, point) => ({
        minX: Math.min(box.minX, point.x),
        maxX: Math.max(box.maxX, point.x),
        minY: Math.min(box.minY, point.y),
        maxY: Math.max(box.maxY, point.y),
      }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
    );
  let box = bounds();
  while (zoom > 1 && (box.maxX - box.minX > width - 110 || box.maxY - box.minY > height - 110)) {
    zoom--;
    projected = points.map((point) => project(point, zoom));
    box = bounds();
  }
  const left = (box.minX + box.maxX - width) / 2;
  const top = (box.minY + box.maxY - height) / 2;
  const tiles: MapTile[] = [];
  for (let x = Math.floor(left / 256); x <= Math.floor((left + width) / 256); x++) {
    for (let y = Math.floor(top / 256); y <= Math.floor((top + height) / 256); y++) {
      if (x < 0 || y < 0 || x >= 2 ** zoom || y >= 2 ** zoom) continue;
      tiles.push({
        key: `${zoom}/${x}/${y}`,
        x: x * 256 - left,
        y: y * 256 - top,
        url: tileTemplate
          .replace('{z}', String(zoom))
          .replace('{x}', String(x))
          .replace('{y}', String(y)),
      });
    }
  }
  const local = (point: { x: number; y: number }) => ({ x: point.x - left, y: point.y - top });
  const route = projected.slice(2).map(local);
  return {
    tiles,
    origin: local(projected[0]),
    destination: local(projected[1]),
    route: route.map((point) => `${point.x},${point.y}`).join(' '),
  };
}

@Component({
  selector: 'app-route-map',
  template: `
    <figure class="route-map">
      <svg
        viewBox="0 0 640 360"
        role="img"
        aria-label="Mapa del recorrido cotizado. O indica origen y D indica destino."
      >
        <rect width="640" height="360" fill="#e7eee4" />
        @for (tile of viewport().tiles; track tile.key) {
          <image
            [attr.href]="tile.url"
            [attr.x]="tile.x"
            [attr.y]="tile.y"
            width="256"
            height="256"
          />
        }
        <polyline
          [attr.points]="viewport().route"
          fill="none"
          stroke="white"
          stroke-width="8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <polyline
          [attr.points]="viewport().route"
          fill="none"
          stroke="#19533e"
          stroke-width="4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <g [attr.transform]="'translate(' + viewport().origin.x + ',' + viewport().origin.y + ')'">
          <circle r="17" fill="#19533e" stroke="white" stroke-width="3" />
          <text
            text-anchor="middle"
            dominant-baseline="central"
            fill="white"
            font-weight="700"
            font-size="14"
          >
            O
          </text>
        </g>
        <g
          [attr.transform]="
            'translate(' + viewport().destination.x + ',' + viewport().destination.y + ')'
          "
        >
          <circle r="17" fill="#9c5931" stroke="white" stroke-width="3" />
          <text
            text-anchor="middle"
            dominant-baseline="central"
            fill="white"
            font-weight="700"
            font-size="14"
          >
            D
          </text>
        </g>
      </svg>
      <figcaption>
        <span>Recorrido cotizado · OSRM</span
        ><a [href]="attributionUrl()" target="_blank" rel="noopener noreferrer">{{
          attribution()
        }}</a>
      </figcaption>
    </figure>
  `,
  styles: `
    :host {
      display: block;
    }
    .route-map {
      margin: 0;
      overflow: hidden;
      border: 1px solid #dce5df;
      border-radius: 10px;
      background: #e7eee4;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
    }
    figcaption {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: space-between;
      padding: 9px 13px;
      font-size: 10px;
      background: #ffffffed;
    }
    a {
      color: #25583d;
    }
  `,
})
export class RouteMap {
  readonly origin = input.required<MapPoint>();
  readonly destination = input.required<MapPoint>();
  readonly coordinates = input<number[][]>([]);
  readonly tileTemplate = input('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  readonly attribution = input('© OpenStreetMap contributors');
  readonly attributionUrl = input('https://www.openstreetmap.org/copyright');
  readonly viewport = computed(() =>
    routeViewport(this.origin(), this.destination(), this.coordinates(), this.tileTemplate()),
  );
}
