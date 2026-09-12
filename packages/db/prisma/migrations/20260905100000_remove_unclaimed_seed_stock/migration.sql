-- The old seed created placeholder credentials. Remove only unclaimed rows:
-- rows attached to an order are retained so delivery history stays intact.
DELETE FROM "stock_items"
WHERE "id" IN ('seed-stock-' || "planId" || '-0', 'seed-stock-' || "planId" || '-1')
  AND "status" = 'AVAILABLE'
  AND "reservedUntil" IS NULL
  AND "orderId" IS NULL;
