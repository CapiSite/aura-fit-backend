-- AlterTable
ALTER TABLE "aura"."user_profile" ADD COLUMN     "conversionAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastConversionMessageAt" TIMESTAMP(3);
