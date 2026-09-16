-- CreateTable
CREATE TABLE "usgs_site_cache" (
    "site_no" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usgs_site_cache_pkey" PRIMARY KEY ("site_no")
);

-- CreateIndex
CREATE INDEX "usgs_site_cache_lat_lon_idx" ON "usgs_site_cache"("lat", "lon");
