-- CreateEnum
CREATE TYPE "OrgPlan" AS ENUM ('BASE', 'GROWTH');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'ANNUAL');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "billing_interval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "plan" "OrgPlan" NOT NULL DEFAULT 'BASE';

