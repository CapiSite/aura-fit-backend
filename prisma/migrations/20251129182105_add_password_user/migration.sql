-- AlterTable
ALTER TABLE "aura"."user_profile" ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "passwordSalt" TEXT;
