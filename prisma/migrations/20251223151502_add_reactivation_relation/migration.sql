-- AddForeignKey
ALTER TABLE "aura"."reactivation_token" ADD CONSTRAINT "reactivation_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "aura"."user_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
