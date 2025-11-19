-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "aura";

-- CreateEnum
CREATE TYPE "aura"."MealType" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK');

-- CreateTable
CREATE TABLE "aura"."user" (
    "chatId" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("chatId")
);

-- CreateTable
CREATE TABLE "aura"."user_profile" (
    "chatId" BIGINT NOT NULL,
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
    "planStyle" TEXT,
    "assistantThreadId" TEXT,
    "lastCheckInAt" TIMESTAMP(3),
    "lastWeighInAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profile_pkey" PRIMARY KEY ("chatId")
);

-- CreateTable
CREATE TABLE "aura"."meal" (
    "id" SERIAL NOT NULL,
    "userProfileId" BIGINT NOT NULL,
    "content" TEXT NOT NULL,
    "mealType" "aura"."MealType" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aura"."user_metric_log" (
    "id" SERIAL NOT NULL,
    "chatId" BIGINT NOT NULL,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weight" DOUBLE PRECISION,
    "bodyFat" DOUBLE PRECISION,
    "waist" DOUBLE PRECISION,
    "hip" DOUBLE PRECISION,

    CONSTRAINT "user_metric_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_phoneNumber_key" ON "aura"."user"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "user_cpf_key" ON "aura"."user"("cpf");

-- AddForeignKey
ALTER TABLE "aura"."meal" ADD CONSTRAINT "meal_userProfileId_fkey" FOREIGN KEY ("userProfileId") REFERENCES "aura"."user_profile"("chatId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aura"."user_metric_log" ADD CONSTRAINT "user_metric_log_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "aura"."user_profile"("chatId") ON DELETE RESTRICT ON UPDATE CASCADE;
