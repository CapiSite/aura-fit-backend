-- Applied previously in the database; recreated here to align local history

ALTER TABLE "aura"."user_profile"
  ADD COLUMN IF NOT EXISTS "waterReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "waterReminderIntervalMinutes" INTEGER NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS "waterReminderLastSent" TIMESTAMP(3);

-- Columns are nullable in the current database. Keep consistency with deployed state.
ALTER TABLE "aura"."user_profile"
  ALTER COLUMN "cpf" DROP NOT NULL,
  ALTER COLUMN "email" DROP NOT NULL;
