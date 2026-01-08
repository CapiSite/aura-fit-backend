-- AlterTable
ALTER TABLE "aura"."user_profile" ADD COLUMN IF NOT EXISTS "asaasCustomerId" TEXT,
ADD COLUMN IF NOT EXISTS "asaasSubscriptionId" TEXT,
ADD COLUMN IF NOT EXISTS "subscriptionStatus" TEXT,
ADD COLUMN IF NOT EXISTS "subscriptionCycle" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_profile_asaasCustomerId_key" ON "aura"."user_profile"("asaasCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_profile_asaasSubscriptionId_key" ON "aura"."user_profile"("asaasSubscriptionId");
