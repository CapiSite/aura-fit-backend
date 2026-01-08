-- AlterTable
ALTER TABLE "aura"."user_profile" ADD COLUMN     "address" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "zipCode" TEXT NOT NULL DEFAULT '';
