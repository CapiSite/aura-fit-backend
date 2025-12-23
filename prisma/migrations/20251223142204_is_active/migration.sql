-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "aura";

-- CreateEnum
CREATE TYPE "aura"."MealType" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK');

-- CreateEnum
CREATE TYPE "aura"."PlanStyle" AS ENUM ('BALANCEADO', 'LOW_CARB', 'HIGH_PROTEIN', 'VEGANO', 'VEGETARIANO', 'MEDITERRANEO');

-- CreateEnum
CREATE TYPE "aura"."SubscriptionPlan" AS ENUM ('FREE', 'PLUS', 'PRO');

-- CreateEnum
CREATE TYPE "aura"."Role" AS ENUM ('USER', 'ADMIN');

-- CreateTable
CREATE TABLE "aura"."user_profile" (
    "name" TEXT NOT NULL,
    "weight" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "activityLevel" TEXT,
    "workType" TEXT,
    "goals" TEXT[],
    "dietaryRestrictions" TEXT[],
    "preferences" TEXT[],
    "allergies" TEXT[],
    "medicalConditions" TEXT[],
    "medications" TEXT[],
    "usualMealsPerDay" INTEGER,
    "wakeTime" TEXT,
    "sleepTime" TEXT,
    "timezone" TEXT,
    "caloricTarget" INTEGER,
    "proteinTarget" INTEGER,
    "carbTarget" INTEGER,
    "fatTarget" INTEGER,
    "assistantThreadId" TEXT,
    "lastCheckInAt" TIMESTAMP(3),
    "lastWeighInAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cpf" TEXT,
    "isPaymentActive" BOOLEAN NOT NULL DEFAULT false,
    "lastPaymentAt" TIMESTAMP(3),
    "nextBillingAt" TIMESTAMP(3),
    "subscriptionExpiresAt" TIMESTAMP(3),
    "subscriptionPlan" "aura"."SubscriptionPlan" NOT NULL DEFAULT 'FREE',
    "planStyle" "aura"."PlanStyle",
    "requestsLastReset" TIMESTAMP(3),
    "requestsToday" INTEGER NOT NULL DEFAULT 0,
    "passwordHash" TEXT,
    "email" TEXT,
    "role" "aura"."Role" NOT NULL DEFAULT 'USER',
    "waterReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "waterReminderIntervalMinutes" INTEGER,
    "waterReminderLastSent" TIMESTAMP(3),
    "id" SERIAL NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aura"."meal" (
    "id" SERIAL NOT NULL,
    "content" TEXT NOT NULL,
    "mealType" "aura"."MealType" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "meal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aura"."user_metric_log" (
    "id" SERIAL NOT NULL,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weight" DOUBLE PRECISION,
    "bodyFat" DOUBLE PRECISION,
    "waist" DOUBLE PRECISION,
    "hip" DOUBLE PRECISION,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "user_metric_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aura"."payment" (
    "id" SERIAL NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "plan" "aura"."SubscriptionPlan" NOT NULL,
    "status" TEXT NOT NULL,
    "method" TEXT,
    "paidAt" TIMESTAMP(3),
    "asaasPaymentId" TEXT,
    "bankSlipUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "invoiceUrl" TEXT,
    "pixPayload" TEXT,
    "pixQrCode" TEXT,
    "transactionReceiptUrl" TEXT,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aura"."prompt_usage" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "prompt_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_profile_cpf_key" ON "aura"."user_profile"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "user_profile_id_key" ON "aura"."user_profile"("id");

-- CreateIndex
CREATE UNIQUE INDEX "user_profile_phoneNumber_key" ON "aura"."user_profile"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payment_asaasPaymentId_key" ON "aura"."payment"("asaasPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "userId_date" ON "aura"."prompt_usage"("userId", "date");

-- AddForeignKey
ALTER TABLE "aura"."meal" ADD CONSTRAINT "meal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "aura"."user_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aura"."user_metric_log" ADD CONSTRAINT "user_metric_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "aura"."user_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aura"."payment" ADD CONSTRAINT "payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "aura"."user_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aura"."prompt_usage" ADD CONSTRAINT "prompt_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "aura"."user_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
