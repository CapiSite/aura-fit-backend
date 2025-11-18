-- CreateEnum
CREATE TYPE "aura"."MealType" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK');

-- CreateTable
CREATE TABLE "aura"."user_profile" (
    "chatId" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "goals" TEXT[],
    "dietaryRestrictions" TEXT[],
    "preferences" TEXT[],
    "conversationState" TEXT,
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

-- AddForeignKey
ALTER TABLE "aura"."meal" ADD CONSTRAINT "meal_userProfileId_fkey" FOREIGN KEY ("userProfileId") REFERENCES "aura"."user_profile"("chatId") ON DELETE RESTRICT ON UPDATE CASCADE;
