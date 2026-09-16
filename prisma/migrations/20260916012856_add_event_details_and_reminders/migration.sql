-- AlterTable
-- Backfilled with a default so any pre-existing rows (there should be none
-- in production - Events aren't created anywhere in the app yet) stay valid;
-- every future insert supplies a real title from the app.
ALTER TABLE "events" ADD COLUMN     "title" TEXT NOT NULL DEFAULT 'Untitled event',
ADD COLUMN     "notes" TEXT;

ALTER TABLE "events" ALTER COLUMN "title" DROP DEFAULT;

-- CreateTable
CREATE TABLE "event_reminders" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "offset_minutes" INTEGER NOT NULL,
    "sent_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_reminders_event_id_idx" ON "event_reminders"("event_id");

-- CreateIndex
CREATE INDEX "event_reminders_person_id_idx" ON "event_reminders"("person_id");

-- AddForeignKey
ALTER TABLE "event_reminders" ADD CONSTRAINT "event_reminders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_reminders" ADD CONSTRAINT "event_reminders_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
