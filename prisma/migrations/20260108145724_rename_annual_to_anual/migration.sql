/*
  Warnings:

  - The values [PLUS_ANNUAL,PRO_ANNUAL] on the enum `SubscriptionPlan` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "aura"."SubscriptionPlan_new" AS ENUM ('FREE', 'PLUS', 'PRO', 'PLUS_ANUAL', 'PRO_ANUAL');
ALTER TABLE "aura"."user_profile" ALTER COLUMN "subscriptionPlan" DROP DEFAULT;
ALTER TABLE "aura"."user_profile" ALTER COLUMN "subscriptionPlan" TYPE "aura"."SubscriptionPlan_new" USING (
  CASE
    WHEN "subscriptionPlan"::text = 'PLUS_ANNUAL' THEN 'PLUS_ANUAL'::"aura"."SubscriptionPlan_new"
    WHEN "subscriptionPlan"::text = 'PRO_ANNUAL' THEN 'PRO_ANUAL'::"aura"."SubscriptionPlan_new"
    ELSE "subscriptionPlan"::text::"aura"."SubscriptionPlan_new"
  END
);
ALTER TABLE "aura"."user_profile" ALTER COLUMN "pendingPlan" TYPE "aura"."SubscriptionPlan_new" USING (
  CASE
    WHEN "pendingPlan"::text = 'PLUS_ANNUAL' THEN 'PLUS_ANUAL'::"aura"."SubscriptionPlan_new"
    WHEN "pendingPlan"::text = 'PRO_ANNUAL' THEN 'PRO_ANUAL'::"aura"."SubscriptionPlan_new"
    ELSE "pendingPlan"::text::"aura"."SubscriptionPlan_new"
  END
);
ALTER TABLE "aura"."payment" ALTER COLUMN "plan" TYPE "aura"."SubscriptionPlan_new" USING (
  CASE
    WHEN "plan"::text = 'PLUS_ANNUAL' THEN 'PLUS_ANUAL'::"aura"."SubscriptionPlan_new"
    WHEN "plan"::text = 'PRO_ANNUAL' THEN 'PRO_ANUAL'::"aura"."SubscriptionPlan_new"
    ELSE "plan"::text::"aura"."SubscriptionPlan_new"
  END
);
ALTER TYPE "aura"."SubscriptionPlan" RENAME TO "SubscriptionPlan_old";
ALTER TYPE "aura"."SubscriptionPlan_new" RENAME TO "SubscriptionPlan";
DROP TYPE "aura"."SubscriptionPlan_old";
ALTER TABLE "aura"."user_profile" ALTER COLUMN "subscriptionPlan" SET DEFAULT 'FREE';
COMMIT;
