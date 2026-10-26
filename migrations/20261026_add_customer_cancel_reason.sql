BEGIN;

ALTER TABLE "orders"
    DROP CONSTRAINT IF EXISTS "orders_cancelReason_check";

ALTER TABLE "orders"
    ADD CONSTRAINT "orders_cancelReason_check"
    CHECK (
        "cancelReason"::text = ANY (
            ARRAY['payment_timeout'::text, 'admin'::text, 'customer'::text]
        )
    );

COMMIT;
