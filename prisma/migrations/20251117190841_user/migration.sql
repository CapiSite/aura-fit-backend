-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "aura";

-- CreateTable
CREATE TABLE "aura"."user" (
    "chatId" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("chatId")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_phoneNumber_key" ON "aura"."user"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "user_cpf_key" ON "aura"."user"("cpf");
