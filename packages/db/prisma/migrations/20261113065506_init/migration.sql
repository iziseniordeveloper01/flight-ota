-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT,
    "google_id" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "locale" VARCHAR(10) NOT NULL DEFAULT 'en',
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "email_verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "airports" (
    "iata_code" CHAR(3) NOT NULL,
    "icao_code" VARCHAR(4),
    "name" TEXT NOT NULL,
    "city" TEXT,
    "country_code" CHAR(2) NOT NULL,
    "timezone" VARCHAR(64),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "type" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "airports_pkey" PRIMARY KEY ("iata_code")
);

-- CreateTable
CREATE TABLE "airlines" (
    "iata_code" VARCHAR(3) NOT NULL,
    "icao_code" CHAR(3),
    "name" TEXT NOT NULL,
    "country_code" CHAR(2),
    "logo_url" TEXT,
    "is_low_cost" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "airlines_pkey" PRIMARY KEY ("iata_code")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- CreateIndex
CREATE INDEX "airports_country_code_idx" ON "airports"("country_code");

-- CreateIndex
CREATE INDEX "airports_city_idx" ON "airports"("city");
