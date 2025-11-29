-- AlterTable
ALTER TABLE "aura"."user_profile" ADD COLUMN     "requestsLastReset" TIMESTAMP(3),
ADD COLUMN     "requestsToday" INTEGER NOT NULL DEFAULT 0;
