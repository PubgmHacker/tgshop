-- The old seed created an unusable placeholder owner. Remove it so each
-- deployment provisions its first real owner explicitly with create-admin.
DELETE FROM "admin_users"
WHERE "email" = 'admin@tgshop.local'
  AND "passwordHash" = 'seed$9a4aabf0e5cf71cae2cea646613ce7e2a5919fa758e56819704be25a3a2c1f0b';
