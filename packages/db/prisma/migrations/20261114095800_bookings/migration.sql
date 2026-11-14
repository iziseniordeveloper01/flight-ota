-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'CONFIRMING', 'CONFIRMED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingActor" AS ENUM ('SYSTEM', 'GUEST', 'ADMIN');

-- CreateEnum
CREATE TYPE "BookingPassengerType" AS ENUM ('ADULT', 'CHILD', 'INFANT');

-- CreateEnum
CREATE TYPE "PassengerTitle" AS ENUM ('MR', 'MRS', 'MS', 'MISS');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('M', 'F');

-- CreateEnum
CREATE TYPE "IdentityDocumentType" AS ENUM ('PASSPORT');

-- CreateEnum
CREATE TYPE "AncillaryType" AS ENUM ('BAG', 'SEAT', 'INSURANCE');

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "reference" CHAR(8) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'DRAFT',
    "supplier" VARCHAR(20) NOT NULL,
    "supplier_offer_id" TEXT NOT NULL,
    "offer_snapshot" JSONB NOT NULL,
    "supplier_ref" JSONB NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "fare_amount" DECIMAL(14,3) NOT NULL,
    "ancillaries_amount" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "insurance_amount" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,3) NOT NULL,
    "contact_title" "PassengerTitle",
    "contact_given_name" TEXT,
    "contact_family_name" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "guest_token_hash" CHAR(64) NOT NULL,
    "user_id" UUID,
    "offer_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "confirm_idempotency_key" VARCHAR(100),
    "supplier_order_id" TEXT,
    "pnr" VARCHAR(16),
    "insurance_policy_number" TEXT,
    "confirmed_at" TIMESTAMPTZ(3),
    "failure_code" VARCHAR(40),
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_passengers" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "BookingPassengerType" NOT NULL,
    "title" "PassengerTitle" NOT NULL,
    "given_name" TEXT NOT NULL,
    "family_name" TEXT,
    "gender" "Gender" NOT NULL,
    "date_of_birth_enc" TEXT NOT NULL,
    "nationality" CHAR(2) NOT NULL,
    "document_type" "IdentityDocumentType",
    "document_number_enc" TEXT,
    "document_issuing_country" CHAR(2),
    "document_expiry_date" DATE,
    "infant_associated_adult_id" UUID,
    "supplier_passenger_id" TEXT NOT NULL,

    CONSTRAINT "booking_passengers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_ancillaries" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "passenger_id" UUID,
    "type" "AncillaryType" NOT NULL,
    "segment_ref" TEXT,
    "supplier_service_id" TEXT,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL(14,3) NOT NULL,
    "currency" CHAR(3) NOT NULL,

    CONSTRAINT "booking_ancillaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_events" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "from_status" "BookingStatus",
    "to_status" "BookingStatus" NOT NULL,
    "actor" "BookingActor" NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_reference_key" ON "bookings"("reference");

-- CreateIndex
CREATE INDEX "bookings_contact_email_reference_idx" ON "bookings"("contact_email", "reference");

-- CreateIndex
CREATE INDEX "bookings_status_offer_expires_at_idx" ON "bookings"("status", "offer_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_passengers_infant_associated_adult_id_key" ON "booking_passengers"("infant_associated_adult_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_passengers_booking_id_position_key" ON "booking_passengers"("booking_id", "position");

-- CreateIndex
CREATE INDEX "booking_ancillaries_booking_id_idx" ON "booking_ancillaries"("booking_id");

-- CreateIndex
CREATE INDEX "booking_events_booking_id_created_at_idx" ON "booking_events"("booking_id", "created_at");

-- AddForeignKey
ALTER TABLE "booking_passengers" ADD CONSTRAINT "booking_passengers_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_passengers" ADD CONSTRAINT "booking_passengers_infant_associated_adult_id_fkey" FOREIGN KEY ("infant_associated_adult_id") REFERENCES "booking_passengers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_ancillaries" ADD CONSTRAINT "booking_ancillaries_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_ancillaries" ADD CONSTRAINT "booking_ancillaries_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "booking_passengers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
