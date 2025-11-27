/*
  Warnings:

  - The primary key for the `user_profile` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `planStyle` column on the `user_profile` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `user` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[cpf]` on the table `user_profile` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `cpf` to the `user_profile` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "aura"."PlanStyle" AS ENUM ('BALANCEADO', 'LOW_CARB', 'HIGH_PROTEIN', 'VEGANO', 'VEGETARIANO', 'MEDITERRANEO');

-- CreateEnum
CREATE TYPE "aura"."SubscriptionPlan" AS ENUM ('FREE', 'PLUS', 'PRO');

-- DropForeignKey
ALTER TABLE "aura"."meal" DROP CONSTRAINT "meal_userProfileId_fkey";

-- DropForeignKey
ALTER TABLE "aura"."user_metric_log" DROP CONSTRAINT "user_metric_log_chatId_fkey";

-- AlterTable
ALTER TABLE "aura"."meal" ALTER COLUMN "userProfileId" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "aura"."user_metric_log" ALTER COLUMN "chatId" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "aura"."user_profile" DROP CONSTRAINT "user_profile_pkey",
ADD COLUMN     "cpf" TEXT NOT NULL,
ADD COLUMN     "isPaymentActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastPaymentAt" TIMESTAMP(3),
ADD COLUMN     "nextBillingAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionExpiresAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionPlan" "aura"."SubscriptionPlan" NOT NULL DEFAULT 'FREE',
ALTER COLUMN "chatId" SET DATA TYPE TEXT,
DROP COLUMN "planStyle",
ADD COLUMN     "planStyle" "aura"."PlanStyle",
ADD CONSTRAINT "user_profile_pkey" PRIMARY KEY ("chatId");

-- DropTable
DROP TABLE "aura"."user";

-- CreateTable
CREATE TABLE "aura"."payment" (
    "id" SERIAL NOT NULL,
    "chatId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "plan" "aura"."SubscriptionPlan" NOT NULL,
    "status" TEXT NOT NULL,
    "method" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_profile_cpf_key" ON "aura"."user_profile"("cpf");

-- AddForeignKey
ALTER TABLE "aura"."meal" ADD CONSTRAINT "meal_userProfileId_fkey" FOREIGN KEY ("userProfileId") REFERENCES "aura"."user_profile"("chatId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aura"."user_metric_log" ADD CONSTRAINT "user_metric_log_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "aura"."user_profile"("chatId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aura"."payment" ADD CONSTRAINT "payment_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "aura"."user_profile"("chatId") ON DELETE RESTRICT ON UPDATE CASCADE;
