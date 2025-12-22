ALTER TABLE "aura"."user_profile"
  ADD COLUMN "id" SERIAL,
  ADD COLUMN "phoneNumber" TEXT;

UPDATE "aura"."user_profile"
SET "phoneNumber" = "chatId"
WHERE "phoneNumber" IS NULL;

CREATE UNIQUE INDEX "user_profile_id_key" ON "aura"."user_profile"("id");
