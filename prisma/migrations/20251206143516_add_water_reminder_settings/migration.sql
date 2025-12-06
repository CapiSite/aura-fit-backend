-- AlterTable
ALTER TABLE "aura"."user_profile" ADD COLUMN     "waterReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "waterReminderIntervalMinutes" INTEGER NOT NULL DEFAULT 180,
ADD COLUMN     "waterReminderLastSent" TIMESTAMP(3);
