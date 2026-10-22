# Contratos iniciales de la API

Base: `/api/v1`. Las pantallas de inicio consultan información y diagnóstico reales. Los eventos de negocio se definirán con sus historias; este loop no emite ofertas, viajes ni cobros simulados.

| Endpoint | Resultado |
| --- | --- |
| `GET /api/v1/info` | Identidad, entorno, mercado BO/BOB y modalidades. No requiere PostgreSQL ni Redis. |
| `GET /api/v1/health/live` | 200 si el proceso puede atender HTTP. |
| `GET /api/v1/health/ready` | 200 con dependencias disponibles; 503 con estados por PostgreSQL, PostGIS y Redis. |
| `GET /api/docs` | Referencia OpenAPI de desarrollo. |

Las respuestas no incluyen URLs de conexión ni credenciales. Los clientes conservan separadas la disponibilidad de la API y la de sus dependencias. La exportación OpenAPI se genera con `npm run api:openapi` y se conserva en [apps/api/openapi/openapi.json](../apps/api/openapi/openapi.json).
