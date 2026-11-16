-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookingStatus" ADD VALUE 'PAID';
ALTER TYPE "BookingStatus" ADD VALUE 'REFUND_PENDING';
ALTER TYPE "BookingStatus" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "booking_ancillaries" ADD COLUMN     "charge_amount" DECIMAL(14,3);

-- AlterTable
ALTER TABLE "bookings" DROP COLUMN "insurance_amount",
ADD COLUMN     "charge_bags_amount" DECIMAL(14,3),
ADD COLUMN     "charge_currency" CHAR(3),
ADD COLUMN     "charge_fare_amount" DECIMAL(14,3),
ADD COLUMN     "charge_insurance_amount" DECIMAL(14,3),
ADD COLUMN     "charge_markup_amount" DECIMAL(14,3),
ADD COLUMN     "charge_seats_amount" DECIMAL(14,3),
ADD COLUMN     "charge_total_amount" DECIMAL(14,3),
ADD COLUMN     "fx_buffer_percent" DECIMAL(5,2),
ADD COLUMN     "fx_fetched_at" TIMESTAMPTZ(3),
ADD COLUMN     "fx_rate" DECIMAL(18,8),
ADD COLUMN     "fx_source" VARCHAR(40);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "provider_order_id" VARCHAR(64) NOT NULL,
    "provider_payment_id" VARCHAR(64),
    "amount" DECIMAL(14,3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "method" VARCHAR(20),
    "failure_code" VARCHAR(64),
    "failure_reason" VARCHAR(255),
    "captured_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "provider_refund_id" VARCHAR(64),
    "amount" DECIMAL(14,3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "event_id" VARCHAR(64) NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "order_id" VARCHAR(64),
    "payment_id" VARCHAR(64),
    "refund_id" VARCHAR(64),
    "amount_minor" BIGINT,
    "currency" CHAR(3),
    "status" VARCHAR(20),
    "error_code" VARCHAR(64),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "outcome" VARCHAR(64),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" UUID NOT NULL,
    "base" CHAR(3) NOT NULL,
    "quote" CHAR(3) NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_order_id_key" ON "payments"("provider_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_payment_id_key" ON "payments"("provider_payment_id");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_booking_id_attempt_key" ON "payments"("booking_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_provider_refund_id_key" ON "refunds"("provider_refund_id");

-- CreateIndex
CREATE INDEX "refunds_status_created_at_idx" ON "refunds"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_event_id_key" ON "webhook_events"("event_id");

-- CreateIndex
CREATE INDEX "fx_rates_base_quote_fetched_at_idx" ON "fx_rates"("base", "quote", "fetched_at");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

