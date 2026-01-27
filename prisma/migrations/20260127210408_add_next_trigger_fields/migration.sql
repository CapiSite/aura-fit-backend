-- AlterTable
ALTER TABLE "aura"."user_profile" ADD COLUMN     "nextMorningGreetingAt" TIMESTAMP(3),
ADD COLUMN     "nextWaterReminderAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "user_profile_nextMorningGreetingAt_idx" ON "aura"."user_profile"("nextMorningGreetingAt");

-- CreateIndex
CREATE INDEX "user_profile_nextWaterReminderAt_idx" ON "aura"."user_profile"("nextWaterReminderAt");
