import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --loader ts-node/register prisma/seed-admin.ts',
  },
  datasource: {
    // DIRECT_URL (porta 5432) para migrations - conexão direta sem pooler
    // DATABASE_URL (porta 6543) é usada pela aplicação em runtime via PrismaClient
    url: env('DIRECT_URL'),
  },
});
