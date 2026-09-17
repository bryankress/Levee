-- CreateTable
CREATE TABLE "nwps_gauge_cache" (
    "lid" TEXT NOT NULL,
    "usgs_id" TEXT,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "flood_stages" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nwps_gauge_cache_pkey" PRIMARY KEY ("lid")
);

-- CreateIndex
CREATE INDEX "nwps_gauge_cache_usgs_id_idx" ON "nwps_gauge_cache"("usgs_id");

-- CreateIndex
CREATE INDEX "nwps_gauge_cache_lat_lon_idx" ON "nwps_gauge_cache"("lat", "lon");
