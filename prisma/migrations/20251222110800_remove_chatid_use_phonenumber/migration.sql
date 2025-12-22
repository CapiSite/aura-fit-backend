-- Step 1: Make phoneNumber NOT NULL (update existing NULL values first)
UPDATE "aura"."user_profile"
SET "phoneNumber" = "chatId"
WHERE "phoneNumber" IS NULL;

-- Step 2: Make phoneNumber NOT NULL
ALTER TABLE "aura"."user_profile" ALTER COLUMN "phoneNumber" SET NOT NULL;

-- Step 3: Create unique index on phoneNumber
CREATE UNIQUE INDEX "user_profile_phoneNumber_key" ON "aura"."user_profile"("phoneNumber");

-- Step 4: Drop the unique index on chatId
DROP INDEX IF EXISTS "aura"."user_profile_chatId_key";

-- Step 5: Drop the chatId column
ALTER TABLE "aura"."user_profile" DROP COLUMN "chatId";
