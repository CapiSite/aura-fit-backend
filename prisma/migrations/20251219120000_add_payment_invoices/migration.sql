ALTER TABLE "aura"."payment"
  ADD COLUMN "asaasPaymentId" TEXT,
  ADD COLUMN "invoiceUrl" TEXT,
  ADD COLUMN "bankSlipUrl" TEXT,
  ADD COLUMN "transactionReceiptUrl" TEXT,
  ADD COLUMN "pixQrCode" TEXT,
  ADD COLUMN "pixPayload" TEXT,
  ADD COLUMN "dueDate" TIMESTAMP(3),
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "aura"."payment" ALTER COLUMN "paidAt" DROP DEFAULT;
ALTER TABLE "aura"."payment" ALTER COLUMN "paidAt" DROP NOT NULL;

CREATE UNIQUE INDEX "payment_asaasPaymentId_key" ON "aura"."payment"("asaasPaymentId");
