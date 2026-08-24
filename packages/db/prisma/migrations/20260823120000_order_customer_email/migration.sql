-- Order.customerEmail: the address a buyer asked to receive a manually
-- fulfilled product on (requiresEmail products). Nullable — most orders
-- have no email at all.
ALTER TABLE "orders" ADD COLUMN "customerEmail" TEXT;
