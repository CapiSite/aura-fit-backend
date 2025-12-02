import 'dotenv/config'
import { PrismaClient, SubscriptionPlan } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { hashPassword } from '../src/common/security/bcrypt'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL não definido')
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg(new Pool({ connectionString: url })),
  })

  const email = process.env.ADMIN_EMAIL ?? 'admin@aura.local'
  const cpf = process.env.ADMIN_CPF ?? '00000000000'
  const phone = process.env.ADMIN_PHONE ?? '11900000000' // dígitos apenas
  const name = process.env.ADMIN_NAME ?? 'Admin Aura'
  const password = process.env.ADMIN_PASSWORD ?? 'Admin123!'
  const pepper = process.env.PASSWORD_PEPPER ?? ''

  const passwordHash = await hashPassword(password, pepper)

  const updateData: any = {
    email,
    name,
    passwordHash,
    subscriptionPlan: SubscriptionPlan.PRO,
    role: 'ADMIN',
    chatId: phone,
  }

  const createData: any = {
    chatId: phone,
    name,
    cpf,
    email,
    passwordHash,
    subscriptionPlan: SubscriptionPlan.PRO,
    role: 'ADMIN',
    requestsToday: 0,
    requestsLastReset: new Date(),
  }

  await prisma.userProfile.upsert({
    where: { cpf },
    update: updateData,
    create: createData,
  })

  console.log(`Admin criado/atualizado: ${email} (cpf ${cpf})`)

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
