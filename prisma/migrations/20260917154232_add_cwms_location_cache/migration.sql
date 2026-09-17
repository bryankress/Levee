-- CreateTable
CREATE TABLE "cwms_location_cache" (
    "office_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "public_name" TEXT,
    "description" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "location_kind" TEXT,
    "state" TEXT,
    "county" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cwms_location_cache_pkey" PRIMARY KEY ("office_id","name")
);

-- CreateIndex
CREATE INDEX "cwms_location_cache_lat_lon_idx" ON "cwms_location_cache"("lat", "lon");
