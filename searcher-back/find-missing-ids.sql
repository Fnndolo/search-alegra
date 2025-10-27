-- Script para encontrar IDs faltantes en facturas de PASTO (1 al 12747)

-- Opción 1: Lista completa de IDs faltantes
WITH expected_ids AS (
  SELECT generate_series(1, 12747) AS expected_id
),
existing_ids AS (
  SELECT CAST(data->>'id' AS INTEGER) AS invoice_id
  FROM invoices
  WHERE store = 'pasto'
    AND data->>'id' IS NOT NULL
    AND data->>'id' ~ '^[0-9]+$' -- Solo números válidos
)
SELECT expected_id AS missing_id
FROM expected_ids
WHERE expected_id NOT IN (SELECT invoice_id FROM existing_ids)
ORDER BY expected_id;

-- Opción 2: Rangos de IDs faltantes (más compacto)
WITH expected_ids AS (
  SELECT generate_series(1, 12747) AS expected_id
),
existing_ids AS (
  SELECT CAST(data->>'id' AS INTEGER) AS invoice_id
  FROM invoices
  WHERE store = 'pasto'
    AND data->>'id' IS NOT NULL
    AND data->>'id' ~ '^[0-9]+$'
),
missing AS (
  SELECT expected_id AS missing_id
  FROM expected_ids
  WHERE expected_id NOT IN (SELECT invoice_id FROM existing_ids)
),
gaps AS (
  SELECT 
    missing_id,
    missing_id - ROW_NUMBER() OVER (ORDER BY missing_id) AS grp
  FROM missing
)
SELECT 
  MIN(missing_id) AS range_start,
  MAX(missing_id) AS range_end,
  COUNT(*) AS count_missing
FROM gaps
GROUP BY grp
ORDER BY range_start;

-- Opción 3: Estadísticas generales
WITH expected_ids AS (
  SELECT generate_series(1, 12747) AS expected_id
),
existing_ids AS (
  SELECT CAST(data->>'id' AS INTEGER) AS invoice_id
  FROM invoices
  WHERE store = 'pasto'
    AND data->>'id' IS NOT NULL
    AND data->>'id' ~ '^[0-9]+$'
)
SELECT 
  12747 AS total_expected,
  COUNT(*) AS total_existing,
  12747 - COUNT(*) AS total_missing,
  ROUND((COUNT(*) * 100.0 / 12747), 2) AS percentage_coverage
FROM existing_ids;
