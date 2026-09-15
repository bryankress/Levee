-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "PersonRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "SensorSource" AS ENUM ('USGS', 'NWPS');

-- CreateEnum
CREATE TYPE "StreamRelation" AS ENUM ('UPSTREAM', 'DOWNSTREAM', 'TRIBUTARY');

-- CreateEnum
CREATE TYPE "DocumentSource" AS ENUM ('UPLOAD', 'SEED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('MEETING', 'MAINTENANCE', 'CLEANUP');

-- CreateEnum
CREATE TYPE "ConditionType" AS ENUM ('RATE_OF_RISE', 'ACCELERATION', 'PCT_OF_FLOOD_STAGE', 'HISTORICAL_PERCENTILE', 'RECESSION_DEVIATION', 'STALENESS', 'CROSS_SENSOR_LAG_DEVIATION', 'COMPOSITE_INDEX_THRESHOLD');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "levees" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "river_name" TEXT,
    "geom" geometry(Geometry, 4326),
    "summary" TEXT,

    CONSTRAINT "levees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "PersonRole" NOT NULL DEFAULT 'MEMBER',
    "phone" TEXT,
    "sms_consent_at" TIMESTAMP(3),
    "password_hash" TEXT,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensors" (
    "id" TEXT NOT NULL,
    "levee_id" TEXT NOT NULL,
    "source" "SensorSource" NOT NULL,
    "external_id" TEXT NOT NULL,
    "param_codes" TEXT[],
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "stream_relation" "StreamRelation",
    "flood_stages" JSONB,
    "last_reading_at" TIMESTAMP(3),

    CONSTRAINT "sensors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensor_readings" (
    "id" TEXT NOT NULL,
    "sensor_id" TEXT NOT NULL,
    "param_code" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "qualifiers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sensor_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clusters" (
    "id" TEXT NOT NULL,
    "levee_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sensor_ids" TEXT[],

    CONSTRAINT "clusters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baselines" (
    "id" TEXT NOT NULL,
    "upstream_sensor_id" TEXT NOT NULL,
    "downstream_sensor_id" TEXT NOT NULL,
    "lag_minutes" DOUBLE PRECISION NOT NULL,
    "attenuation_pct" DOUBLE PRECISION NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "cluster_id" TEXT NOT NULL,
    "condition_type" "ConditionType" NOT NULL,
    "params" JSONB NOT NULL,
    "action" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "currently_triggered" BOOLEAN NOT NULL DEFAULT false,
    "last_triggered_at" TIMESTAMP(3),

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "provider_id" TEXT,
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "levee_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "source" "DocumentSource" NOT NULL DEFAULT 'UPLOAD',
    "uploaded_by" TEXT,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "levee_id" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_subdomain_key" ON "organizations"("subdomain");

-- CreateIndex
CREATE INDEX "levees_org_id_idx" ON "levees"("org_id");

-- CreateIndex
CREATE INDEX "people_org_id_idx" ON "people"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "people_org_id_email_key" ON "people"("org_id", "email");

-- CreateIndex
CREATE INDEX "sensors_levee_id_idx" ON "sensors"("levee_id");

-- CreateIndex
CREATE UNIQUE INDEX "sensors_source_external_id_key" ON "sensors"("source", "external_id");

-- CreateIndex
CREATE INDEX "sensor_readings_sensor_id_param_code_timestamp_idx" ON "sensor_readings"("sensor_id", "param_code", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "sensor_readings_sensor_id_param_code_timestamp_key" ON "sensor_readings"("sensor_id", "param_code", "timestamp");

-- CreateIndex
CREATE INDEX "clusters_levee_id_idx" ON "clusters"("levee_id");

-- CreateIndex
CREATE INDEX "baselines_upstream_sensor_id_downstream_sensor_id_idx" ON "baselines"("upstream_sensor_id", "downstream_sensor_id");

-- CreateIndex
CREATE INDEX "rules_cluster_id_idx" ON "rules"("cluster_id");

-- CreateIndex
CREATE INDEX "notifications_rule_id_idx" ON "notifications"("rule_id");

-- CreateIndex
CREATE INDEX "notifications_person_id_idx" ON "notifications"("person_id");

-- CreateIndex
CREATE INDEX "documents_levee_id_idx" ON "documents"("levee_id");

-- CreateIndex
CREATE INDEX "events_levee_id_idx" ON "events"("levee_id");

-- AddForeignKey
ALTER TABLE "levees" ADD CONSTRAINT "levees_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensors" ADD CONSTRAINT "sensors_levee_id_fkey" FOREIGN KEY ("levee_id") REFERENCES "levees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_sensor_id_fkey" FOREIGN KEY ("sensor_id") REFERENCES "sensors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_levee_id_fkey" FOREIGN KEY ("levee_id") REFERENCES "levees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_upstream_sensor_id_fkey" FOREIGN KEY ("upstream_sensor_id") REFERENCES "sensors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_downstream_sensor_id_fkey" FOREIGN KEY ("downstream_sensor_id") REFERENCES "sensors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "clusters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_levee_id_fkey" FOREIGN KEY ("levee_id") REFERENCES "levees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_levee_id_fkey" FOREIGN KEY ("levee_id") REFERENCES "levees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

