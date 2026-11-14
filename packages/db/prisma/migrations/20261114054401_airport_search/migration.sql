-- Added manually: Prisma does not manage extensions here, but the gin_trgm_ops indexes below
-- and similarity()/% in airport search need pg_trgm. IF NOT EXISTS keeps re-runs/shadow DBs safe.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
ALTER TABLE "airports" ADD COLUMN     "keywords" TEXT;

-- CreateIndex
CREATE INDEX "airports_name_trgm_idx" ON "airports" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "airports_city_trgm_idx" ON "airports" USING GIN ("city" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "airports_keywords_trgm_idx" ON "airports" USING GIN ("keywords" gin_trgm_ops);
