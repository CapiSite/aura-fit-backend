<div align="center">

# ⚡ Aura Fit - Backend API

<p align="center">
  <strong>API RESTful robusta com IA integrada para saúde e bem-estar</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/NestJS-11.0-E0234E?style=for-the-badge&logo=nestjs" alt="NestJS" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-blue?style=for-the-badge&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Prisma-7.0-2D3748?style=for-the-badge&logo=prisma" alt="Prisma" />
  <img src="https://img.shields.io/badge/PostgreSQL-Latest-336791?style=for-the-badge&logo=postgresql" alt="PostgreSQL" />
</p>

<p align="center">
  <a href="#-sobre">Sobre</a> •
  <a href="#-arquitetura">Arquitetura</a> •
  <a href="#-funcionalidades">Funcionalidades</a> •
  <a href="#-tecnologias">Tecnologias</a> •
  <a href="#-instalação">Instalação</a> •
  <a href="#-api">API</a> •
  <a href="#-deploy">Deploy</a>
</p>

</div>

---

## 📋 Sobre

O **Aura Fit Backend** é uma API RESTful construída com NestJS que alimenta a plataforma de saúde e bem-estar. Integra inteligência artificial (Google Gemini/OpenAI) com WhatsApp para fornecer assistência personalizada aos usuários.

### ✨ Destaques

- 🤖 **IA Integrada**: Google Gemini e OpenAI para respostas inteligentes
- 💬 **WhatsApp API**: Integração completa com Z-API
- ⏰ **Sistema de Triggers**: Notificações automatizadas (bom dia, lembretes de água)
- 💳 **Pagamentos**: Integração com Asaas para cobranças
- 📧 **Email**: Sistema de recuperação de senha e reativação de conta
- 🔐 **Autenticação**: JWT e bcrypt para segurança
- 📊 **Database**: Prisma ORM com PostgreSQL
- 🎯 **Clean Architecture**: Código modular e testável

---

## 🏗️ Arquitetura

### **Padrão de Design**
- **Modular Architecture**: Organização por features/módulos
- **Dependency Injection**: IoC container do NestJS
- **Repository Pattern**: Abstração de acesso a dados
- **Service Layer**: Lógica de negócio isolada
- **DTO Pattern**: Validação e transformação de dados

### **Estrutura de Camadas**
```
Controllers → Services → Repositories → Database
     ↓           ↓            ↓            ↓
   HTTP      Business      Data        Prisma
  Layer       Logic       Access       Client
```

---

## 🚀 Funcionalidades

### 🤖 **Sistema de IA**
- **GPT Service**
  - Conversação natural com usuários
  - Análise de imagens (meals, progress photos)
  - Sugestões personalizadas de dieta e treino
  - Histórico de conversas mantido

### 💬 **WhatsApp Integration**
- **Mensagens Bidirecionais**
  - Recebimento via webhooks
  - Envio de textos e imagens
  - Integração com Z-API
  
- **Verificações Automáticas**
  - Plano expirado
  - Conta desativada
  - Limite de mensagens FREE

### ⏰ **Sistema de Triggers Automatizados**

#### **Morning Greeting Service**
- Envia "Bom dia" personalizado
- Baseado no `wakeTime` do usuário
- Janela de 10 minutos a partir do horário de acordar
- Verifica a cada 5 minutos (5h-18h)
- Apenas 1 mensagem por dia por usuário
- Respeita planos (FREE: 3 dias, PLUS/PRO: conforme contratado)

#### **Water Reminder Service**
- Lembretes personalizados de beber água
- Intervalos configuráveis por usuário
- Mensagens motivacionais variadas
- Horário de funcionamento: 6h-23h

### 👤 **Gestão de Usuários**
- CRUD completo de perfis
- Autenticação JWT
- Recuperação de senha via email
- Reativação de conta
- Roles (USER/ADMIN)
- Métricas e logs de peso/medidas

### 💳 **Sistema de Pagamentos (Asaas)**
- Criação de clientes
- Geração de cobranças
- PIX, Boleto, Cartão
- Webhooks de status de pagamento
- Atualização automática de assinaturas

### 📧 **Sistema de Email (Nodemailer)**
- Templates HTML
- Recuperação de senha
- Reativação de conta
- Tokens com expiração

---

## 🛠️ Tecnologias

### **Framework & Core**
- **[NestJS 11](https://nestjs.com/)** - Framework Node.js escalável
- **[TypeScript 5.7](https://www.typescriptlang.org/)** - Tipagem estática
- **[Node.js 20+](https://nodejs.org/)** - Runtime JavaScript

### **Database & ORM**
- **[Prisma 7](https://www.prisma.io/)** - ORM moderno
- **[PostgreSQL](https://www.postgresql.org/)** - Banco de dados relacional
- **[@prisma/adapter-pg](https://www.prisma.io/docs/orm/overview/databases/postgresql)** - Adapter PostgreSQL

### **IA & APIs Externas**
- **[Google Gemini](https://ai.google.dev/)** - IA conversacional
- **[OpenAI](https://openai.com/)** - GPT Models
- **[Z-API](https://z-api.io/)** - WhatsApp Business API
- **[Asaas](https://www.asaas.com/)** - Gateway de pagamentos

### **Autenticação & Segurança**
- **[bcryptjs](https://www.npmjs.com/package/bcryptjs)** - Hash de senhas
- **JWT** - JSON Web Tokens
- **Class Validator** - Validação de DTOs
- **Class Transformer** - Transformação de dados

### **Email & Comunicação**
- **[Nodemailer](https://nodemailer.com/)** - Envio de emails
- **Email Templates** - HTML personalizados

### **Utilitários**
- **[RxJS](https://rxjs.dev/)** - Programação reativa
- **Config Module** - Gerenciamento de variáveis de ambiente

### **Testes**
- **[Jest](https://jestjs.io/)** - Framework de testes
- **Supertest** - Testes E2E

---

## 📦 Instalação

### **Pré-requisitos**
- Node.js 20+
- PostgreSQL 14+
- npm ou yarn
- Git

### **Passo a Passo**

1. **Clone o repositório**
```bash
git clone https://github.com/your-org/aura-fit-backend.git
cd aura-fit-backend
```

2. **Instale as dependências**
```bash
npm install
```

3. **Configure as variáveis de ambiente**

Crie um arquivo `.env` na raiz:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/aurafit?schema=aura"

# JWT
JWT_SECRET=your-super-secret-key-here

# Google Gemini
GEMINI_API_KEY=your-gemini-api-key

# OpenAI (opcional)
OPENAI_API_KEY=your-openai-api-key

# WhatsApp (Z-API)
WHATSAPP_INSTANCE_ID=your-instance-id
WHATSAPP_TOKEN=your-token
WHATSAPP_CLIENT_TOKEN=your-client-token

# Asaas
ASAAS_API_KEY=your-asaas-api-key
ASAAS_BASE_URL=https://sandbox.asaas.com/api/v3

# Email (Nodemailer)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password

# Frontend URL
FRONTEND_URL=http://localhost:3000
```

4. **Configure o banco de dados**

```bash
# Gerar cliente Prisma
npx prisma generate

# Executar migrations
npx prisma migrate dev

# (Opcional) Seed de dados iniciais
npm run seed
```

5. **Execute em desenvolvimento**
```bash
npm run start:dev
```

6. **Acesse a API**
```
http://localhost:3001
```

---

## 🎮 Comandos

### **Desenvolvimento**
```bash
npm run start:dev      # Modo watch (hot-reload)
npm run start:debug    # Modo debug
```

### **Build & Produção**
```bash
npm run build          # Build de produção
npm run start:prod     # Inicia em produção
```

### **Database**
```bash
npx prisma generate           # Gera Prisma Client
npx prisma migrate dev        # Cria nova migration
npx prisma migrate deploy     # Aplica migrations (prod)
npx prisma studio             # Interface visual do DB
npm run seed                  # Seed de admin
```

### **Testes**
```bash
npm run test           # Testes unitários
npm run test:watch     # Watch mode
npm run test:cov       # Cobertura
npm run test:e2e       # Testes E2E
```

### **Code Quality**
```bash
npm run lint           # ESLint
npm run format         # Prettier
```

---

## 📡 API Endpoints

### **Autenticação**
```http
POST   /auth/register              # Registrar usuário
POST   /auth/login                 # Login
POST   /auth/forgot-password       # Recuperar senha
POST   /auth/reset-password        # Redefinir senha
POST   /auth/reactivate            # Reativar conta
```

### **Usuários**
```http
GET    /users/profile              # Perfil do usuário
PUT    /users/profile              # Atualizar perfil
GET    /users/:id                  # Buscar usuário (admin)
DELETE /users/:id                  # Deletar usuário (admin)
```

### **WhatsApp**
```http
POST   /whatsapp/webhook           # Receber mensagens
GET    /whatsapp/qr-code           # Obter QR Code
POST   /whatsapp/send              # Enviar mensagem
GET    /whatsapp/messages/:phone   # Histórico de mensagens
```

### **Pagamentos (Asaas)**
```http
POST   /asaas/create-customer      # Criar cliente
POST   /asaas/create-charge        # Criar cobrança
POST   /asaas/webhook              # Webhook de status
GET    /asaas/payment/:id          # Status do pagamento
```

### **GPT / IA**
```http
POST   /gpt/chat                   # Conversa com IA
POST   /gpt/analyze-image          # Análise de imagem
```

---

## 📁 Estrutura do Projeto

```
aura-fit-backend/
├── prisma/
│   ├── migrations/              # Histórico de migrations
│   ├── schema.prisma            # Schema do banco
│   └── seed-admin.ts            # Seed de dados
│
├── src/
│   ├── app/                     # Módulo principal
│   │   ├── app.controller.ts
│   │   ├── app.module.ts
│   │   └── app.service.ts
│   │
│   ├── auth/                    # Autenticação
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── auth.module.ts
│   │   └── dto/
│   │
│   ├── users/                   # Gestão de usuários
│   │   ├── users.controller.ts
│   │   ├── users.service.ts
│   │   ├── users.module.ts
│   │   └── dto/
│   │
│   ├── whatsapp/                # WhatsApp Integration
│   │   ├── whatsapp.controller.ts
│   │   ├── whatsapp.service.ts
│   │   ├── whatsapp.module.ts
│   │   └── dto/
│   │
│   ├── gpt/                     # IA Service
│   │   ├── gpt.service.ts
│   │   ├── gpt.module.ts
│   │   └── providers/
│   │
│   ├── asaas/                   # Pagamentos
│   │   ├── asaas.controller.ts
│   │   ├── asaas.service.ts
│   │   └── asaas.module.ts
│   │
│   ├── common/                  # Utilitários compartilhados
│   │   ├── triggers/           # Sistema de triggers
│   │   │   ├── morning-greeting.service.ts
│   │   │   ├── reminder.service.ts
│   │   │   └── triggers.module.ts
│   │   └── config/
│   │
│   ├── config/                  # Configurações
│   │   ├── gpt.config.ts
│   │   ├── whatsapp.config.ts
│   │   ├── asaas.config.ts
│   │   └── email.config.ts
│   │
│   ├── prisma_connection/       # Prisma Module
│   │   ├── prisma.service.ts
│   │   └── prisma.module.ts
│   │
│   └── main.ts                  # Entry point
│
├── .env                         # Variáveis de ambiente
├── .gitignore
├── nest-cli.json               # Config NestJS
├── package.json
├── tsconfig.json               # Config TypeScript
└── README.md
```

---

## 🗄️ Database Schema

### **Principais Models**

#### **UserProfile**
```prisma
- id: Int (PK)
- phoneNumber: String (unique)
- email: String?
- name: String
- cpf: String?
- wakeTime: String?           // Horário de acordar
- sleepTime: String?          // Horário de dormir
- subscriptionPlan: Enum      // FREE | PLUS | PRO
- subscriptionExpiresAt: DateTime
- isPaymentActive: Boolean
- isActive: Boolean
- waterReminderEnabled: Boolean
- waterReminderIntervalMinutes: Int?
- ... (outros campos)
```

#### **Meal**
```prisma
- id: Int (PK)
- content: String
- mealType: Enum             // BREAKFAST | LUNCH | DINNER | SNACK
- timestamp: DateTime
- userId: Int (FK)
```

#### **Payment**
```prisma
- id: Int (PK)
- amount: Float
- plan: Enum
- status: String
- method: String
- asaasPaymentId: String
- userId: Int (FK)
```

#### **PasswordResetToken & ReactivationToken**
```prisma
- id: Int (PK)
- token: String (unique)
- userId: Int (FK)
- expiresAt: DateTime
- used: Boolean
```

---

## 🔐 Segurança

### **Implementações**
- ✅ **Bcrypt**: Hash de senhas com salt rounds
- ✅ **JWT**: Tokens com expiração
- ✅ **CORS**: Configurado para frontend específico
- ✅ **Helmet**: Headers de segurança HTTP
- ✅ **Rate Limiting**: Proteção contra DDoS
- ✅ **Input Validation**: Class-validator em todos os DTOs
- ✅ **SQL Injection**: Prisma previne automaticamente
- ✅ **XSS**: Sanitização de inputs

### **Variáveis Sensíveis**
Nunca commite:
- API Keys (Gemini, OpenAI, Z-API, Asaas)
- DATABASE_URL
- JWT_SECRET
- Credenciais de email

---

## 🚀 Deploy

### **Railway (Recomendado)**
1. Conecte seu repositório GitHub
2. Configure as variáveis de ambiente
3. Adicione PostgreSQL plugin
4. Deploy automático a cada push

### **Heroku**
```bash
# Instalar Heroku CLI
heroku login
heroku create aura-fit-api

# Adicionar PostgreSQL
heroku addons:create heroku-postgresql:hobby-dev

# Deploy
git push heroku main
```

### **VPS (DigitalOcean, AWS, etc)**
```bash
# PM2 para gerenciar processo
npm install -g pm2
pm2 start npm --name "aura-fit-api" -- run start:prod
pm2 save
pm2 startup
```

### **Docker (Opcional)**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npx prisma generate
RUN npm run build
EXPOSE 3001
CMD ["npm", "run", "start:prod"]
```

---

## 📊 Monitoramento

### **Logs**
- Console logs estruturados
- Níveis: `log`, `error`, `warn`, `debug`
- Timestamps automáticos

### **Health Check**
```http
GET /health
```

### **Métricas Sugeridas**
- Uptime
- Latência de requisições
- Taxa de erros
- Uso de memória/CPU
- Conexões de DB ativas

---

## 🧪 Testes

### **Estrutura**
```
src/
├── **/*.spec.ts         # Testes unitários
test/
└── **/*.e2e-spec.ts    # Testes E2E
```

### **Cobertura Recomendada**
- Services: 80%+
- Controllers: 70%+
- Guards: 90%+

---

## 🤝 Contribuindo

1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

### **Code Style**
- ESLint + Prettier configurados
- Commits semânticos
- Testes obrigatórios para novas features

---

## 📝 Licença

Este projeto é privado e propriedade da equipe Aura Fit.

---

## 📞 Suporte

- 📧 Email: suporte@aurafit.ia.br
- 💬 WhatsApp: [+55 61 98280-0249](https://wa.me/556198280249)
- 🌐 Site: [aurafit.ia.br](https://aurafit.ia.br)

---

<div align="center">

**[⬆ Voltar ao topo](#-aura-fit---backend-api)**

Made with 💜 by Aura Fit Team

</div>
