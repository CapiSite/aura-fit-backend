-- AlterTable: Remove default value and make waterReminderIntervalMinutes nullable
ALTER TABLE "aura"."user_profile" 
  ALTER COLUMN "waterReminderIntervalMinutes" DROP DEFAULT,
  ALTER COLUMN "waterReminderIntervalMinutes" DROP NOT NULL;
