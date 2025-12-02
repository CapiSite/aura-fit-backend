/*
  Warnings:

  - You are about to drop the column `passwordSalt` on the `user_profile` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "aura"."user_profile" DROP COLUMN "passwordSalt";
