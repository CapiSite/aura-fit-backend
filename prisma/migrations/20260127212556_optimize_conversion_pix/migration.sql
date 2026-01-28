-- AlterTable
ALTER TABLE "aura"."user_profile" ADD COLUMN     "nextConversionAttemptAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "payment_status_dueDate_idx" ON "aura"."payment"("status", "dueDate");

-- CreateIndex
CREATE INDEX "user_profile_nextConversionAttemptAt_idx" ON "aura"."user_profile"("nextConversionAttemptAt");
