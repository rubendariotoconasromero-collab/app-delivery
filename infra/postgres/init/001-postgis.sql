-- Se ejecuta solo al inicializar un volumen vacío. Las migraciones de la API
-- comprueban la extensión también para bases ya existentes.
CREATE EXTENSION IF NOT EXISTS postgis;
