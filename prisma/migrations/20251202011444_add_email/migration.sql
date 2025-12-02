/*
  Warnings:

  - Added the required column `email` to the `user_profile` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "aura"."user_profile" ADD COLUMN     "email" TEXT NOT NULL;
