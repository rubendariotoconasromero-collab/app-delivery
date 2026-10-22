-- The development PostGIS image normally installs this extension during init.
-- Keep the requirement versioned for existing databases and reproducible setup.
CREATE EXTENSION IF NOT EXISTS postgis;
