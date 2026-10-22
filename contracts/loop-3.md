# Loop 3: primer viaje de pasajeros

Contrato compartido obligatorio para API, Flutter y Angular. Base `/api/v1`. El usuario confirmó OpenStreetMap/OSRM y tarifas de prueba. El modo operativo de este loop es de desarrollo: no autoriza cobros comerciales ni usa recorridos rectos como sustituto silencioso de rutas por calles.

## Tipos

`Point`: `{latitude:number,longitude:number,address:string,reference?:string}`. Latitud/longitud WGS84, dirección 3–200 caracteres, referencia hasta 300. Selección en mapa o entrada manual de coordenadas y referencia; no se usa geocodificador público para autocompletar.

`TripState`: `searching`, `assigned`, `arrived`, `in_progress`, `completed`, `cancelled`, `no_driver`.

`Route`: `{distanceMeters:number,durationSeconds:number,geometry:{type:'LineString',coordinates:[number,number][]},provider:'osrm'}`. Coordenadas de geometría en orden longitud, latitud.

`Quote`: `{id,origin:Point,destination:Point,passengerCount,currency:'BOB',totalCents,breakdown:{baseCents,distanceCents,timeCents,minimumCents},tariffVersion,isTest:true,expiresAt,route:Route}`. Cantidades en centavos enteros. Solo el servidor calcula precio y guarda condiciones. La cotización pertenece a su cliente y tiene un solo uso lógico.

`Cash`: `{status:'pending'|'declared_paid'|'partial'|'unpaid',receivedCents:number|null,declaredAt:string|null,declaredBy:string|null}`. Una declaración es distinta de conciliación; no se implementa conciliación en este loop.

`Trip`: `{id,clientId,driverId:string|null,vehicleId:string|null,state:TripState,origin:Point,destination:Point,passengerCount,currency:'BOB',totalCents,tariffVersion,isTest:true,route:Route,createdAt,updatedAt,searchExpiresAt,assignedAt:string|null,arrivedAt:string|null,startedAt:string|null,completedAt:string|null,cash:Cash,client:{displayName,phone?},driver:{displayName,phone?,vehicle:{plate,make,model,capacityPassengers}}|null,startCode?:string,startCodeExpiresAt?:string,offer?:Offer|null,version:number}`.

`Offer`: `{id,tripId,driverId,state:'pending'|'accepted'|'rejected'|'expired'|'withdrawn',expiresAt}`. En la lista del conductor se añade `trip:Trip`. El PIN solo se devuelve al cliente propietario, después de asignación y antes del inicio. Nunca al conductor ni al personal. Contactos completos únicamente tras asignación; sin documentación privada en ofertas. `Audit`: `{id,actorId,action,reason,createdAt}`.

## API cliente y consulta común

| Método/ruta | Entrada | Respuesta |
| --- | --- | --- |
| GET `/trips/config` | Cualquier sesión autenticada. | `{enabled,isTest:true,currency:'BOB',coverage:{south,north,west,east},tariff:{version,baseCents,perKmCents,perMinuteCents,minimumCents},map:{tileUrl,attribution,attributionUrl},quoteTtlSeconds,searchTtlSeconds,offerTtlSeconds,gpsMaxAgeSeconds,arrivalRadiusMeters}`. |
| POST `/trips/quotes` | Cliente: `{origin:Point,destination:Point,passengerCount:integer1..8}`. | 201 `{quote:Quote}`. Consulta OSRM real; falla explícitamente si no hay ruta/proveedor. |
| POST `/trips` | Cliente: `{quoteId:UUID,idempotencyKey:UUID}`. | 201 `{trip:Trip}`. Reintento devuelve el mismo servicio; otro payload con la misma clave da 409. Una solicitud activa por cliente. |
| GET `/trips/active?role=client|driver` | Rol móvil indicado. | `{trip:Trip|null}`. Recuperación al reabrir app. |
| GET `/trips/:id` | Propietario cliente, conductor asignado o personal autorizado. | `{trip:Trip}`. Comprobar pertenencia en servidor. |
| GET `/trips?role=client|driver&limit=20&offset=0` | Historial propio acotado. | `{items:Trip[],total,limit,offset}`. Permite recuperar cobros pendientes tras terminar. |
| POST `/trips/:id/start-code` | Cliente propietario de viaje assigned/arrived: `{idempotencyKey:UUID}`. | `{trip:Trip}`. Renueva PIN invalidando el previo, con límite persistente. |
| POST `/trips/:id/cancel` | Cliente propietario o personal operativo: `{idempotencyKey:UUID,reason:string3..1000}`. | `{trip:Trip}`. Solo antes de iniciar; sin cargo automático. |

## Conductor

| Método/ruta | Entrada | Respuesta |
| --- | --- | --- |
| GET `/drivers/me/availability` | Conductor. | `{online:boolean,available:boolean,reason:string|null,location:{latitude,longitude,accuracyMeters,capturedAt,receivedAt}|null}`. |
| POST `/drivers/me/location` | `{latitude,longitude,accuracyMeters,capturedAt:ISO8601}`. | Mismo estado de disponibilidad. Ubicación real en primer plano; no falsificar GPS si se deniega permiso. |
| PUT `/drivers/me/availability` | `{online:boolean}`. | Mismo estado. Para activarse exige habilitación, vehículo pasajeros y ubicación válida reciente. |
| GET `/drivers/me/trip-offers` | Conductor. | `{items:(Offer & {trip:Trip})[]}`; solo sus ofertas pendientes vigentes. |
| POST `/drivers/me/trip-offers/:id/respond` | `{decision:'accept'|'reject',idempotencyKey:UUID}`. | `{trip:Trip}`. Aceptar verifica reserva, capacidad, GPS, plazo y habilitación en una transacción. |
| POST `/trips/:id/arrive` | Conductor asignado: `{idempotencyKey:UUID}`. | `{trip:Trip}`. assigned→arrived, GPS reciente cercano al origen. |
| POST `/trips/:id/start` | Conductor asignado: `{pin:string6digitos,idempotencyKey:UUID}`. | `{trip:Trip}`. arrived→in_progress. Máximo cinco intentos; un fallo debe confirmarse en DB sin deshacer su contador. |
| POST `/trips/:id/finish` | Conductor asignado: `{idempotencyKey:UUID}`. | `{trip:Trip}`. in_progress→completed con GPS reciente cercano al destino; libera reservas una sola vez. |
| POST `/trips/:id/cash` | Conductor asignado de viaje completed: `{receivedCents:integer0..totalCents,idempotencyKey:UUID}`. | `{trip:Trip}`. Declaración única, parcial/impago/cobrado derivado del importe; reintento no duplica movimiento. |

El conductor puede desconectarse conservando su servicio. Las ubicaciones atrasadas o con precisión inválida no sirven para llegar/finalizar. Cada mutación de servicio lleva UUID persistido hasta resolver el resultado; errores de red no se muestran como confirmados. El sondeo básico no equivale al seguimiento en segundo plano del loop 4.

## Panel operativo

Solo sesiones del panel con MFA y rol `operator` o `admin`; `finance` no cambia estados.

| Método/ruta | Entrada | Respuesta |
| --- | --- | --- |
| GET `/admin/trips?state=...&limit=50&offset=0` | Filtro opcional. | `{items:Trip[],total,limit,offset}`. |
| GET `/admin/trips/:id` | — | `{trip:Trip,audit:Audit[]}`. |
| GET `/admin/trips/:id/candidates` | — | `{items:{driverId,displayName,vehicle:{id,plate,make,model,capacityPassengers},location:{latitude,longitude,accuracyMeters,capturedAt},distanceMeters:number}[]}`. Máximo 50, solo habilitados disponibles compatibles, sin reserva ni oferta pendiente. |
| POST `/admin/trips/:id/assign` | `{driverId:UUID,reason:string3..1000,idempotencyKey:UUID}`. | `{trip:Trip}` con `offer` pendiente. La propuesta reserva lógicamente al candidato hasta responder o vencer; el viaje sigue searching hasta aceptación. |

Rechazo/vencimiento retira oferta y libera el candidato; puede asignarse otro sin volver a cotizar dentro del plazo de búsqueda. La hora del servidor rige todos los plazos. Búsqueda vencida pasa no_driver. Las expiraciones son persistentes e idempotentes. No se permite cambiar vehículo ni datos revisados/documentos durante un viaje asignado/arrived/in_progress; el backend lo impide. No crear movimientos financieros por terminar/cancelar.

## Configuración de desarrollo

Root añade al Environment: `TRIP_DEVELOPMENT_ENABLED` boolean derivado de true/false, `TRIP_OSRM_URL` URL por defecto `https://router.project-osrm.org`, `TRIP_MAP_TILE_URL` por defecto `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, `TRIP_COVERAGE_SOUTH=-17.90`, `TRIP_COVERAGE_NORTH=-17.65`, `TRIP_COVERAGE_WEST=-63.30`, `TRIP_COVERAGE_EAST=-63.02`, `TRIP_BASE_CENTS=500`, `TRIP_PER_KM_CENTS=200`, `TRIP_PER_MINUTE_CENTS=25`, `TRIP_MINIMUM_CENTS=800`, `TRIP_TARIFF_VERSION=scz-dev-v1`, `TRIP_QUOTE_TTL_SECONDS=180`, `TRIP_SEARCH_TTL_SECONDS=600`, `TRIP_OFFER_TTL_SECONDS=60`, `TRIP_GPS_MAX_AGE_SECONDS=60`, `TRIP_ARRIVAL_RADIUS_METERS=200`.

La cobertura es un rectángulo de prueba configurable, no el polígono operativo definitivo del loop 5. Cotiza por distancia y duración OSRM, mínimo aplicado al total, redondeo entero de centavos. OSRM se consulta con timeout, límites y sin redirecciones a destinos arbitrarios; rechazar puntos alejados de calles y recorridos fuera de límites razonables. No hay proveedor ficticio en runtime. El endpoint y teselas son configurables; atribución OSM visible, User-Agent identificado y caché según proveedor. El modo desarrollo de viajes se rechaza en producción salvo deshabilitado.

Para pruebas, un servidor HTTP local de fixtures OSRM puede validar protocolo y errores explícitamente; la verificación manual adicional consultará OSRM público con puntos ficticios de Santa Cruz. No se prueba carga contra servicios públicos. Los endpoints propios guardan rutas/precios sin depender de Redis para la integridad de reservas.
