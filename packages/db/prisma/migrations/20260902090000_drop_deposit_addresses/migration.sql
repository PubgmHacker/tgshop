-- TRON moved to a single owner-held receive wallet with per-invoice amount tags.
-- Per-order deposit addresses (HD-derived, swept by a hot key) are retired; the
-- table was never populated in production because no xpub was ever configured.
DROP TABLE IF EXISTS "deposit_addresses";
