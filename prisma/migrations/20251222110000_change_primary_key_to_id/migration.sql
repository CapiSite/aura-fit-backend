-- Step 1: Add userId columns to related tables
ALTER TABLE "aura"."meal" ADD COLUMN "userId" INTEGER;
ALTER TABLE "aura"."user_metric_log" ADD COLUMN "userId" INTEGER;
ALTER TABLE "aura"."payment" ADD COLUMN "userId" INTEGER;
ALTER TABLE "aura"."prompt_usage" ADD COLUMN "userId" INTEGER;

-- Step 2: Populate userId columns with data from existing relationships
UPDATE "aura"."meal" m
SET "userId" = u."id"
FROM "aura"."user_profile" u
WHERE m."userProfileId" = u."chatId";

UPDATE "aura"."user_metric_log" uml
SET "userId" = u."id"
FROM "aura"."user_profile" u
WHERE uml."chatId" = u."chatId";

UPDATE "aura"."payment" p
SET "userId" = u."id"
FROM "aura"."user_profile" u
WHERE p."chatId" = u."chatId";

UPDATE "aura"."prompt_usage" pu
SET "userId" = u."id"
FROM "aura"."user_profile" u
WHERE pu."chatId" = u."chatId";

-- Step 3: Drop old foreign key constraints
ALTER TABLE "aura"."meal" DROP CONSTRAINT IF EXISTS "meal_userProfileId_fkey";
ALTER TABLE "aura"."user_metric_log" DROP CONSTRAINT IF EXISTS "user_metric_log_chatId_fkey";
ALTER TABLE "aura"."payment" DROP CONSTRAINT IF EXISTS "payment_chatId_fkey";
ALTER TABLE "aura"."prompt_usage" DROP CONSTRAINT IF EXISTS "prompt_usage_chatId_fkey";

-- Step 4: Drop old unique constraint on prompt_usage
DROP INDEX IF EXISTS "aura"."chatId_date";

-- Step 5: Make userId NOT NULL
ALTER TABLE "aura"."meal" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "aura"."user_metric_log" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "aura"."payment" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "aura"."prompt_usage" ALTER COLUMN "userId" SET NOT NULL;

-- Step 6: Drop old foreign key columns
ALTER TABLE "aura"."meal" DROP COLUMN "userProfileId";
ALTER TABLE "aura"."user_metric_log" DROP COLUMN "chatId";
ALTER TABLE "aura"."payment" DROP COLUMN "chatId";
ALTER TABLE "aura"."prompt_usage" DROP COLUMN "chatId";

-- Step 7: Change primary key on user_profile
ALTER TABLE "aura"."user_profile" DROP CONSTRAINT "user_profile_pkey";
ALTER TABLE "aura"."user_profile" ADD CONSTRAINT "user_profile_pkey" PRIMARY KEY ("id");

-- Step 8: Add unique constraint on chatId (it's no longer the primary key)
CREATE UNIQUE INDEX "user_profile_chatId_key" ON "aura"."user_profile"("chatId");

-- Step 9: Add new foreign key constraints
ALTER TABLE "aura"."meal" ADD CONSTRAINT "meal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "aura"."user_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aura"."user_metric_log" ADD CONSTRAINT "user_metric_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "aura"."user_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aura"."payment" ADD CONSTRAINT "payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "aura"."user_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aura"."prompt_usage" ADD CONSTRAINT "prompt_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "aura"."user_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Step 10: Add new unique constraint on prompt_usage
CREATE UNIQUE INDEX "userId_date" ON "aura"."prompt_usage"("userId", "date");
