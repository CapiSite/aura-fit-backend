-- CreateEnum
CREATE TYPE "aura"."Role" AS ENUM ('USER', 'ADMIN');

-- AlterTable
ALTER TABLE "aura"."user_profile" ADD COLUMN     "role" "aura"."Role" NOT NULL DEFAULT 'USER';
