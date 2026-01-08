# Implementação de Pagamentos Recorrentes (Asaas Subscriptions)

## Objetivo

Implementar sistema de assinaturas recorrentes usando a API do Asaas, permitindo cobranças automáticas mensais/anuais sem necessidade do usuário pagar manualmente a cada ciclo.

## User Review Required

> [!NOTE]
> **✅ DECISÕES CONFIRMADAS**
> - **TODOS os usuários**: Usarão assinaturas recorrentes (sem exceção)
> - **Usuários antigos**: Migrados automaticamente para assinaturas
> - **Upgrade**: Acesso aplicado imediatamente + assinatura atualizada (cobranças futuras refletem novo valor)
> - **Downgrade**: Só no próximo ciclo (mantém plano atual até renovação)
> - **PIX**: Permitido com avisos de que pagamento é manual a cada ciclo

> [!IMPORTANT]
> **Implementação Simplificada - Apenas Assinaturas**
> - Sistema terá **UM ÚNICO FLUXO**: `/subscriptions/create` para todos
> - Endpoint `/payments/plan` será **removido/depreciado**
> - Usuários antigos com pagamentos avulsos: ao expirar, próximo pagamento será assinatura
> - Frontend não precisa detectar fluxo (sempre usa subscriptions)

---

## Proposed Changes

### Database Schema

> [!NOTE]
> **✅ Banco de Dados Já Configurado**
> 
> As colunas necessárias para assinaturas recorrentes **já estão criadas** no banco de dados e as migrations **já foram aplicadas**.
> 
> **Campos disponíveis no modelo `UserProfile`:**
> - `asaasSubscriptionId`: ID da subscription no Asaas (String?, @unique)
> - `subscriptionStatus`: Status da assinatura - ACTIVE, INACTIVE, EXPIRED (String?)
> - `subscriptionCycle`: Ciclo de cobrança - MONTHLY, YEARLY (String?)
> 
> Estes campos podem ser utilizados diretamente no código sem necessidade de criar novas migrations.

---

### Backend Implementation

#### [NEW] `src/asaas/dto/create-subscription.dto.ts`

Nova DTO para criar assinaturas:

```typescript
export class CreateSubscriptionDto {
  @IsEnum(SubscriptionPlan)
  plan: SubscriptionPlan;

  @IsEnum(AsaasBillingType)
  @IsOptional()
  billingType?: AsaasBillingType;

  @IsString()
  @IsOptional()
  creditCardHolderName?: string;

  @ValidateIf((o) => o.billingType === AsaasBillingType.CREDIT_CARD)
  @IsString()
  creditCardNumber?: string;

  @ValidateIf((o) => o.billingType === AsaasBillingType.CREDIT_CARD)
  @IsString()
  creditCardExpiryMonth?: string;

  @ValidateIf((o) => o.billingType === AsaasBillingType.CREDIT_CARD)
  @IsString()
  creditCardExpiryYear?: string;

  @ValidateIf((o) => o.billingType === AsaasBillingType.CREDIT_CARD)
  @IsString()
  creditCardCcv?: string;

  @IsString()
  @IsOptional()
  postalCode?: string;
}
```

---

#### [MODIFY] `src/asaas/asaas.service.ts`

**Novos métodos:**

##### `createSubscription`
Cria uma nova assinatura no Asaas usando `POST /subscriptions`:

```typescript
async createSubscription(dto: CreateSubscriptionInput): Promise<AsaasSubscription> {
  const cycle = dto.plan.includes('ANUAL') ? 'YEARLY' : 'MONTHLY';
  const value = this.getPlanAmount(dto.plan);
  
  const payload = {
    customer: dto.customerId,
    billingType: dto.billingType ?? AsaasBillingType.CREDIT_CARD,
    value,
    nextDueDate: new Date().toISOString().slice(0, 10), // Primeira cobrança hoje
    cycle, // MONTHLY ou YEARLY
    description: `Assinatura ${dto.plan}`,
    externalReference: `SUB:${dto.plan}:${dto.chatId}:${Date.now()}`,
    creditCard: dto.creditCard,
    creditCardHolderInfo: dto.holderInfo,
  };

  return this.request<AsaasSubscription>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
```

##### `updateSubscription` (com Pro-Rata)
Atualiza uma assinatura existente para upgrade/downgrade:

```typescript
async updateSubscription(
  userId: number,
  subscriptionId: string,
  newPlan: SubscriptionPlan,
  opts: {
    chatId: string;
    paymentMethod?: AsaasBillingType;
    creditCard?: CreditCardPayload;
    holderInfo?: CreditCardHolderInfoPayload;
  },
): Promise<{ subscription: AsaasSubscription; payment?: AsaasPayment; immediateUpgrade: boolean }> {
  const value = this.getPlanAmount(newPlan);
  const cycle = newPlan.includes('ANUAL') ? 'YEARLY' : 'YEARLY';

  // Buscar plano atual do usuário
  const user = await this.prisma.userProfile.findUnique({
    where: { id: userId },
    select: { 
      subscriptionPlan: true, 
      subscriptionExpiresAt: true,
      asaasSubscriptionId: true,
    },
  });

  const isUpgrade = this.isUpgrade(user.subscriptionPlan, newPlan);

  // ===== UPGRADE: Cobrar diferença proporcional + Atualizar assinatura =====
  if (isUpgrade) {
    // 1. Calcular pro-rata
    const planChange = this.calculatePlanChange(
      user.subscriptionPlan,
      newPlan,
      user.subscriptionExpiresAt,
    );
    
    // 2. Criar pagamento da diferença (se houver custo)
    let payment: AsaasPayment | undefined;
    
    if (planChange.changePrice > 0.1) {
      const customerId = await this.getOrCreateCustomer(opts.chatId);
      
      payment = await this.createPayment({
        customerId,
        value: planChange.changePrice,
        dueDate: new Date().toISOString().slice(0, 10),
        description: `Upgrade de ${user.subscriptionPlan} para ${newPlan} (${planChange.daysRemaining} dias)`,
        externalReference: `UPGRADE_SUB:${newPlan}:${opts.chatId}:${Date.now()}`,
        billingType: opts.paymentMethod ?? AsaasBillingType.CREDIT_CARD,
        creditCard: opts.creditCard,
        creditCardHolderInfo: opts.holderInfo,
      });
      
      // Salvar pagamento no banco
      await this.upsertPaymentRecord({
        payment,
        chatId: opts.chatId,
        plan: newPlan,
        status: this.getPaymentStatus(payment),
      });
      
      // Se pagamento não for confirmado imediatamente, esperar webhook
      if (!['CONFIRMED', 'RECEIVED'].includes(payment.status)) {
        this.logger.log(`Upgrade pendente - aguardando pagamento ${payment.id}`);
        return { subscription: null, payment, immediateUpgrade: false };
      }
    }
    
    // 3. Atualizar assinatura no Asaas (novo valor + resetar ciclo)
    const newDueDate = new Date();
    newDueDate.setDate(newDueDate.getDate() + (cycle === 'YEARLY' ? 365 : 30));
    
    const subscription = await this.request<AsaasSubscription>(`/subscriptions/${subscriptionId}`, {
      method: 'PUT',
      body: JSON.stringify({
        value,
        cycle,
        nextDueDate: newDueDate.toISOString().slice(0, 10), // Resetar ciclo
        description: `Assinatura ${newPlan}`,
        updatePendingPayments: true,
      }),
    });
    
    // 4. Aplicar upgrade imediatamente no banco
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (cycle === 'YEARLY' ? 365 : 30));
    
    await this.prisma.userProfile.update({
      where: { id: userId },
      data: {
        subscriptionPlan: newPlan,
        subscriptionExpiresAt: expiresAt,
        subscriptionCycle: cycle,
        pendingPlan: null,
      },
    });
    
    this.logger.log(
      `Upgrade aplicado - User: ${userId}, From: ${user.subscriptionPlan}, To: ${newPlan}, Charged: R$ ${planChange.changePrice}`
    );
    
    return { subscription, payment, immediateUpgrade: true };
  }
  
  // ===== DOWNGRADE: Apenas atualizar assinatura (próximo ciclo) =====
  else {
    const subscription = await this.request<AsaasSubscription>(`/subscriptions/${subscriptionId}`, {
      method: 'PUT',
      body: JSON.stringify({
        value,
        cycle,
        description: `Assinatura ${newPlan}`,
        updatePendingPayments: false, // Não atualizar cobranças pendentes
      }),
    });
    
    // Agendar downgrade para próximo ciclo
    await this.prisma.userProfile.update({
      where: { id: userId },
      data: {
        pendingPlan: newPlan,
      },
    });
    
    this.logger.log(
      `Downgrade agendado - User: ${userId}, From: ${user.subscriptionPlan}, To: ${newPlan}, Effective: ${user.subscriptionExpiresAt}`
    );
    
    return { subscription, immediateUpgrade: false };
  }
}

private isUpgrade(currentPlan: SubscriptionPlan, targetPlan: SubscriptionPlan): boolean {
  const planHierarchy = {
    FREE: 0,
    PLUS: 1,
    PLUS_ANUAL: 2,
    PRO: 3,
    PRO_ANUAL: 4,
  };
  return planHierarchy[targetPlan] > planHierarchy[currentPlan];
}

// Reutilizar a lógica de cálculo pro-rata do sistema antigo
private calculatePlanChange(
  currentPlan: SubscriptionPlan,
  targetPlan: SubscriptionPlan,
  expiresAt: Date,
): { changePrice: number; daysRemaining: number } {
  const now = new Date();
  const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysRemaining <= 0) {
    return { changePrice: this.getPlanAmount(targetPlan), daysRemaining: 0 };
  }
  
  const currentValue = this.getPlanAmount(currentPlan);
  const targetValue = this.getPlanAmount(targetPlan);
  
  const isCurrentAnnual = currentPlan.includes('ANUAL');
  const totalDays = isCurrentAnnual ? 365 : 30;
  const currentRemainingValue = (daysRemaining / totalDays) * currentValue;
  
  const isTargetAnnual = targetPlan.includes('ANUAL');
  const targetFullValue = targetValue; // Novo ciclo completo
  
  // Preço = valor cheio do novo plano MENOS o crédito do plano atual
  const changePrice = Math.max(0, targetFullValue - currentRemainingValue);
  
  return { changePrice: Number(changePrice.toFixed(2)), daysRemaining };
}
```

##### `cancelSubscription`
Cancela uma assinatura:

```typescript
async cancelSubscription(subscriptionId: string): Promise<void> {
  await this.request(`/subscriptions/${subscriptionId}`, {
    method: 'DELETE',
  });
}
```

##### `handleSubscriptionWebhook`
Processa webhooks de eventos de assinatura:

```typescript
async handleSubscriptionWebhook(body: AsaasWebhookPayload): Promise<void> {
  const event = body.event;
  
  switch (event) {
    case 'SUBSCRIPTION_CREATED':
      await this.onSubscriptionCreated(body.subscription);
      break;
      
    case 'SUBSCRIPTION_UPDATED':
      await this.onSubscriptionUpdated(body.subscription);
      break;
      
    case 'SUBSCRIPTION_INACTIVATED':
    case 'SUBSCRIPTION_DELETED':
      await this.onSubscriptionCanceled(body.subscription);
      break;
      
    case 'PAYMENT_CREATED':
      // Cobrança recorrente gerada (PIX ou Cartão)
      // PIX: Usuário recebe notificação para pagar
      // Cartão: Será cobrado automaticamente no vencimento
      this.logger.log(`Cobrança gerada para subscription ${body.payment.subscription}`);
      break;
      
    case 'PAYMENT_RECEIVED':
    case 'PAYMENT_CONFIRMED':
      // Pagamento confirmado, renovar acesso
      await this.applyConfirmedPayment(body.payment, 'CONFIRMED');
      break;
      
    case 'PAYMENT_OVERDUE':
      // Pagamento PIX vencido - suspender assinatura
      await this.onPaymentOverdue(body.payment);
      break;
  }
}

private async onPaymentOverdue(payment: AsaasPayment) {
  if (!payment.subscription) return;
  
  const user = await this.prisma.userProfile.findUnique({
    where: { asaasSubscriptionId: payment.subscription },
  });
  
  if (!user) return;
  
  // Suspender acesso (manter assinatura ativa para permitir pagamento atrasado)
  await this.prisma.userProfile.update({
    where: { id: user.id },
    data: {
      subscriptionPlan: SubscriptionPlan.FREE,
      subscriptionStatus: 'OVERDUE',
    },
  });
  
  this.logger.warn(
    `Assinatura suspensa por falta de pagamento - User: ${user.id}, Subscription: ${payment.subscription}`
  );
}
```

> [!IMPORTANT]
> **Aplicação de Downgrade Pendente (pendingPlan)**
> 
> O método `applyConfirmedPayment` (que processa renovações) precisa incluir lógica para aplicar `pendingPlan`:
> 
> ```typescript
> async applyConfirmedPayment(payment: AsaasPayment, status: string) {
>   // ... lógica existente ...
>   
>   // IMPORTANTE: Aplicar pendingPlan se houver (downgrade agendado)
>   const updateData: any = {
>     isPaymentActive: true,
>     subscriptionExpiresAt: newExpiresAt,
>     lastPaymentAt: new Date(),
>   };
>   
>   // Se há pendingPlan, aplicar o downgrade agora
>   if (user.pendingPlan) {
>     updateData.subscriptionPlan = user.pendingPlan;
>     updateData.pendingPlan = null;
>     this.logger.log(`Downgrade aplicado - User: ${user.id}, To: ${user.pendingPlan}`);
>   }
>   
>   await this.prisma.userProfile.update({
>     where: { id: user.id },
>     data: updateData,
>   });
> }
> ```
> 
> **Fluxo Completo de Downgrade:**
> 1. User faz downgrade PRO → PLUS
> 2. Sistema marca `pendingPlan: PLUS`
> 3. Assinatura Asaas atualizada para R$ 29,90 (próxima cobrança)
> 4. User **continua com PRO** até expirar
> 5. Asaas cobra R$ 29,90 (novo valor)
> 6. Webhook `PAYMENT_RECEIVED` chega
> 7. `applyConfirmedPayment` vê `pendingPlan: PLUS`
> 8. **Agora sim** muda o plano para PLUS

---

**Métodos auxiliares:**

```typescript
private async onSubscriptionCreated(subscription: AsaasSubscription) {
  const chatId = this.extractChatIdFromReference(subscription.externalReference);
  
  await this.prisma.userProfile.update({
    where: { phoneNumber: String(chatId) },
    data: {
      asaasSubscriptionId: subscription.id,
      subscriptionStatus: 'ACTIVE',
      subscriptionCycle: subscription.cycle,
    },
  });
}

private async onSubscriptionCanceled(subscription: AsaasSubscription) {
  await this.prisma.userProfile.update({
    where: { asaasSubscriptionId: subscription.id },
    data: {
      subscriptionStatus: 'INACTIVE',
      asaasSubscriptionId: null,
    },
  });
}
```

---

#### [MODIFY] `src/asaas/asaas.controller.ts`

**Novos endpoints:**

```typescript
@Post('subscriptions/create')
@UseGuards(AuthGuard)
async createSubscription(@Req() req: AuthRequest, @Body() dto: CreateSubscriptionDto) {
  const cpf = req?.user?.cpf;
  if (!cpf) throw new HttpException('CPF não informado', 400);
  
  const user = await this.usersService.getMeByCpf(cpf);
  
  // Verificar se já tem assinatura ativa
  if (user.asaasSubscriptionId) {
    throw new HttpException('Você já possui uma assinatura ativa', 400);
  }
  
  const customer = await this.asaasService.ensureCustomerFromProfile({
    name: user.name,
    cpfCnpj: user.cpf ?? '',
    email: user.email ?? undefined,
  });
  
  const digits = (value: string | undefined) => value?.replace(/\D/g, '') ?? '';
  
  return this.asaasService.createSubscription(dto.plan, customer.id, {
    billingType: dto.billingType ?? AsaasBillingType.CREDIT_CARD,
    chatId: user.phoneNumber,
    creditCard: dto.billingType === AsaasBillingType.PIX ? undefined : {
      holderName: user.name,
      number: digits(dto.creditCardNumber),
      expiryMonth: digits(dto.creditCardExpiryMonth).padStart(2, '0').slice(0, 2),
      expiryYear: '20' + digits(dto.creditCardExpiryYear).slice(-2),
      ccv: digits(dto.creditCardCcv),
    },
    holderInfo: dto.billingType === AsaasBillingType.PIX ? undefined : {
      name: user.name,
      email: user.email ?? undefined,
      cpfCnpj: user.cpf ?? '',
      postalCode: digits(dto.postalCode) || digits(user.zipCode),
      addressNumber: user.addressNumber || 'S/N',
      addressComplement: user.addressComplement ?? undefined,
      mobilePhone: digits(user.phoneNumber),
      phone: digits(user.phoneNumber),
    },
  });
}

@Post('subscriptions/cancel')
@UseGuards(AuthGuard)
async cancelSubscription(@Req() req: AuthRequest) {
  const cpf = req?.user?.cpf;
  if (!cpf) throw new HttpException('CPF não informado', 400);
  
  const user = await this.usersService.getMeByCpf(cpf);
  
  if (!user.asaasSubscriptionId) {
    throw new HttpException('Você não possui assinatura ativa', 400);
  }
  
  await this.asaasService.cancelSubscription(user.asaasSubscriptionId);
  
  return { message: 'Assinatura cancelada com sucesso' };
}

@Post('subscriptions/change-plan')
@UseGuards(AuthGuard)
async changeSubscriptionPlan(
  @Req() req: AuthRequest,
  @Body() dto: ChangePlanDto // Usa mesma DTO do sistema atual (já tem campos de pagamento)
) {
  const cpf = req?.user?.cpf;
  if (!cpf) throw new HttpException('CPF não informado', 400);
  
  const user = await this.usersService.getMeByCpf(cpf);
  
  if (!user.asaasSubscriptionId) {
    throw new HttpException('Você não possui assinatura ativa', 400);
  }
  
  const digits = (value: string | undefined) => value?.replace(/\D/g, '') ?? '';
  const month = digits(dto.creditCardExpiryMonth).padStart(2, '0').slice(0, 2);
  const yearRaw = digits(dto.creditCardExpiryYear).slice(-2);
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
  
  const result = await this.asaasService.updateSubscription(
    user.id,
    user.asaasSubscriptionId,
    dto.targetPlan,
    {
      chatId: user.phoneNumber,
      paymentMethod: dto.paymentMethod ?? AsaasBillingType.CREDIT_CARD,
      creditCard: dto.paymentMethod === AsaasBillingType.PIX ? undefined : {
        holderName: user.name,
        number: digits(dto.creditCardNumber),
        expiryMonth: month,
        expiryYear: year,
        ccv: digits(dto.creditCardCcv),
      },
      holderInfo: dto.paymentMethod === AsaasBillingType.PIX ? undefined : {
        name: user.name,
        email: user.email ?? undefined,
        cpfCnpj: user.cpf ?? '',
        postalCode: digits(dto.postalCode) || digits(user.zipCode),
        addressNumber: user.addressNumber || 'S/N',
        addressComplement: user.addressComplement ?? undefined,
        mobilePhone: digits(user.phoneNumber),
        phone: digits(user.phoneNumber),
      },
    },
  );
  
  // Se retornou pagamento (upgrade com custo), retornar dados do pagamento
  if (result.payment) {
    return {
      message: result.immediateUpgrade ? 'Upgrade aplicado com sucesso' : 'Aguardando pagamento',
      payment: result.payment,
      subscription: result.subscription,
    };
  }
  
  return { 
    message: result.immediateUpgrade ? 'Upgrade gratuito aplicado' : 'Downgrade agendado',
    subscription: result.subscription,
  };
}
```

---

### Funcionalidade de Cancelamento (Detalhada)

#### Como Funciona o Cancelamento

**Comportamento ao Cancelar:**
1. Assinatura é **inativada no Asaas** (nenhuma cobrança futura)
2. Usuário **mantém acesso até** `subscriptionExpiresAt` (fim do período já pago)
3. Após expiração, plano volta para **FREE**
4. Usuário pode **renovar/reativar** criando nova assinatura

**Endpoint de Cancelamento:**
```typescript
POST /asaas/subscriptions/cancel
Headers: { Authorization: Bearer <token> }

// Resposta
{
  message: 'Assinatura cancelada com sucesso',
  expiresAt: '2026-02-08T00:00:00.000Z',
  remainingDays: 30
}
```

**Webhook que Processa:**
- `SUBSCRIPTION_DELETED` ou `SUBSCRIPTION_INACTIVATED`
- Atualiza `subscriptionStatus` para `INACTIVE`
- Remove `asaasSubscriptionId` do usuário
- **NÃO** altera `subscriptionPlan` nem `subscriptionExpiresAt` (mantém acesso)

**Lógica de Expiração (Cron Job ou Webhook):**
```typescript
// Verificar diariamente usuários com assinatura expirada
const expiredUsers = await prisma.userProfile.findMany({
  where: {
    subscriptionStatus: 'INACTIVE',
    subscriptionExpiresAt: { lt: new Date() },
    subscriptionPlan: { not: SubscriptionPlan.FREE },
  },
});

for (const user of expiredUsers) {
  await prisma.userProfile.update({
    where: { id: user.id },
    data: {
      subscriptionPlan: SubscriptionPlan.FREE,
      subscriptionStatus: null,
    },
  });
}
```

---

### Frontend Integration

> [!NOTE]
> O frontend já possui todos os campos e componentes necessários implementados (`Plans.tsx` e `Settings.tsx`). 
> 
> **Para conectar com o backend:**
> - Atualizar as chamadas de API para usar os novos endpoints de subscription:
>   - `POST /asaas/subscriptions/create` - Criar assinatura
>   - `POST /asaas/subscriptions/change-plan` - Mudar plano
>   - `POST /asaas/subscriptions/cancel` - Cancelar assinatura
>   - `GET /asaas/subscriptions/change-plan/preview/:targetPlan` - Preview de mudança
> 
> O frontend já conta com toda a lógica de formulários, validação, modais e tratamento de erros.

---

## Verification Plan

### Automated Tests

```bash
# Testar criação de assinatura
curl -X POST http://localhost:3000/asaas/subscriptions/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"plan": "PLUS", "billingType": "CREDIT_CARD", ...}'

# Testar cancelamento
curl -X POST http://localhost:3000/asaas/subscriptions/cancel \
  -H "Authorization: Bearer $TOKEN"

# Testar mudança de plano
curl -X POST http://localhost:3000/asaas/subscriptions/change-plan \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"targetPlan": "PRO"}'
```

### Manual Verification

1. **Criar assinatura via Frontend:**
   - Verificar modal de aviso de recorrência
   - Confirmar criação da subscription no Asaas Dashboard
   - Verificar `asaasSubscriptionId` salvo no banco

2. **Testar Webhooks:**
   - Simular webhook `SUBSCRIPTION_CREATED`
   - Simular webhook `PAYMENT_RECEIVED` (primeira cobrança)
   - Verificar renovação de acesso do usuário

3. **Cancelamento:**
   - Cancelar via Frontend
   - Verificar que assinatura foi inativada no Asaas
   - Verificar que usuário mantém acesso até `subscriptionExpiresAt`

4. **Upgrade/Downgrade:**
   - Trocar de PLUS para PRO
   - Verificar que assinatura foi atualizada no Asaas
   - Verificar que próximas cobranças refletem novo valor

---

## Migration Strategy

### ✅ Migração para Assinaturas (Todos os Usuários)

**Estratégia:**
- **Sistema novo**: Apenas assinaturas recorrentes (`/subscriptions/create`)
- **Endpoint `/payments/plan`**: Será depreciado e removido
- **Usuários com pagamento avulso ativo**: Mantêm acesso até expirar
- **Próximo pagamento**: Automaticamente será assinatura recorrente

**Vantagens:**
- ✅ Código simplificado (um único fluxo)
- ✅ Experiência consistente para todos
- ✅ Menor chance de bugs (sem lógica condicional)
- ✅ Migração suave e automática

**Lógica no Frontend (Simplificada):**

```typescript
// Em Plans.tsx - SEMPRE usa subscriptions
const handleSelectPlan = async (plan: string) => {
  if (userProfile.asaasSubscriptionId) {
    // Usuário já tem assinatura - fazer upgrade/downgrade
    await api.post('/asaas/subscriptions/change-plan', { targetPlan: plan });
  } else {
    // Criar nova assinatura (novo usuário OU usuário legado renovando)
    await api.post('/asaas/subscriptions/create', { plan });
  }
};
```

**Migração de Usuários Antigos:**

1. **Ao Expirar Plano Atual:**
   - Frontend detecta que `subscriptionExpiresAt < now()`
   - Ao tentar renovar, cria assinatura (não pagamento avulso)
   - Sistema converte automaticamente

2. **Upgrade/Downgrade de Usuário Legado:**
   - Se tentar mudar plano SEM `asaasSubscriptionId`, criar assinatura
   - Aplicar upgrade imediatamente
   - A partir daí, renovações são automáticas

3. **Comunicação ao Usuário:**
   - Banner no dashboard: "Agora suas renovações são automáticas! 🎉"
   - Email explicando benefícios da recorrência
   - Modal na primeira renovação explicando mudança


