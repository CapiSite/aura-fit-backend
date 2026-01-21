import { SubscriptionPlan } from '@prisma/client';
import { PrismaService } from '../../prisma_connection/prisma.service';
import { AsaasBillingType } from '../dto/create-plan-payment.dto';
import { AsaasPayment, AsaasSubscription } from '../entities/asaas.types';
import { AsaasApiClient } from './asaas-api.client';
import { AsaasPaymentService } from './asaas-payment.service';
import { AsaasSubscriptionService } from './asaas-subscription.service';

describe('AsaasSubscriptionService', () => {
  let service: AsaasSubscriptionService;
  let apiClient: { request: jest.Mock };
  let prisma: {
    userProfile: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    payment: {
      count: jest.Mock;
    };
  };
  let paymentService: {
    createPayment: jest.Mock;
    getPaymentStatus: jest.Mock;
    getPixQrCode: jest.Mock;
    getPaymentBySubscription: jest.Mock;
    getUpcomingPaymentBySubscription: jest.Mock;
    upsertPaymentRecord: jest.Mock;
  };

  beforeEach(() => {
    apiClient = { request: jest.fn() };
    prisma = {
      userProfile: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      payment: {
        count: jest.fn(),
      },
    };
    paymentService = {
      createPayment: jest.fn(),
      getPaymentStatus: jest.fn(),
      getPixQrCode: jest.fn(),
      getPaymentBySubscription: jest.fn(),
      getUpcomingPaymentBySubscription: jest.fn(),
      upsertPaymentRecord: jest.fn(),
    };

    service = new AsaasSubscriptionService(
      apiClient as unknown as AsaasApiClient,
      prisma as unknown as PrismaService,
      paymentService as unknown as AsaasPaymentService,
    );
  });

  it('getPixForSubscription returns payment and pix when available', async () => {
    const payment: AsaasPayment = {
      id: 'pay_1',
      customer: 'cus_1',
      billingType: 'PIX',
      value: 29.9,
      status: 'PENDING',
      dueDate: '2026-01-10',
      subscription: 'sub_1',
    };
    const pix = {
      encodedImage: 'qr_base64',
      payload: 'pix_payload',
      expirationDate: '2026-01-10',
    };

    paymentService.getPaymentBySubscription.mockResolvedValueOnce(payment);
    paymentService.getPixQrCode.mockResolvedValueOnce(pix);

    const result = await service.getPixForSubscription('sub_1', { attempts: 1, delayMs: 0 });

    expect(paymentService.getPaymentBySubscription).toHaveBeenCalledWith('sub_1');
    expect(paymentService.getPixQrCode).toHaveBeenCalledWith('pay_1');
    expect(result.payment).toBe(payment);
    expect(result.pix).toEqual(pix);
  });

  it('createSubscription returns pix and payment for PIX billing', async () => {
    const subscription: AsaasSubscription = {
      id: 'sub_1',
      customer: 'cus_1',
      billingType: 'PIX',
      value: 29.9,
      nextDueDate: '2026-01-10',
      cycle: 'MONTHLY',
      status: 'ACTIVE',
    };
    const payment: AsaasPayment = {
      id: 'pay_1',
      customer: 'cus_1',
      billingType: 'PIX',
      value: 29.9,
      status: 'PENDING',
      dueDate: '2026-01-10',
      subscription: 'sub_1',
    };
    const pix = {
      encodedImage: 'qr_base64',
      payload: 'pix_payload',
      expirationDate: '2026-01-10',
    };

    apiClient.request.mockResolvedValueOnce(subscription);
    jest.spyOn(service, 'getPixForSubscription').mockResolvedValueOnce({
      payment,
      pix,
    });

    const result = await service.createSubscription(SubscriptionPlan.PLUS, 'cus_1', {
      billingType: AsaasBillingType.PIX,
    });

    expect(service.getPixForSubscription).toHaveBeenCalledWith('sub_1');
    expect(result.payment).toBe(payment);
    expect(result.pix).toEqual(pix);
  });

  it('changeSubscriptionPlan returns pix for PIX upgrade payments', async () => {
    prisma.userProfile.findUnique.mockResolvedValue({
      id: 1,
      subscriptionPlan: SubscriptionPlan.PLUS,
      subscriptionExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      isPaymentActive: true,
      pendingPlan: null,
      asaasSubscriptionId: 'sub_old',
      asaasCustomerId: 'cus_1',
      phoneNumber: '5511999999999',
    });

    jest.spyOn(service, 'calculatePlanChange').mockResolvedValue({
      canChange: true,
      changePrice: 10,
      daysRemaining: 5,
      isDowngrade: false,
    });

    const payment: AsaasPayment = {
      id: 'pay_1',
      customer: 'cus_1',
      billingType: 'PIX',
      value: 10,
      status: 'PENDING',
      dueDate: '2026-01-10',
    };
    const pix = {
      encodedImage: 'qr_base64',
      payload: 'pix_payload',
      expirationDate: '2026-01-10',
    };

    paymentService.createPayment.mockResolvedValue(payment);
    paymentService.getPaymentStatus.mockReturnValue('PENDING');
    paymentService.getPixQrCode.mockResolvedValue(pix);
    paymentService.upsertPaymentRecord.mockResolvedValue(undefined);

    const result = await service.changeSubscriptionPlan(
      1,
      SubscriptionPlan.PRO,
      'cus_1',
      { paymentMethod: AsaasBillingType.PIX, chatId: '5511999999999' },
    );

    expect(paymentService.createPayment).toHaveBeenCalled();
    expect(paymentService.getPixQrCode).toHaveBeenCalledWith('pay_1');
    expect(result.pix).toEqual(pix);
    expect(result.changeInfo.waitingPayment).toBe(true);
  });

  it('changeSubscriptionPlan does not include pix for credit card upgrades', async () => {
    prisma.userProfile.findUnique.mockResolvedValue({
      id: 2,
      subscriptionPlan: SubscriptionPlan.PLUS,
      subscriptionExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      isPaymentActive: true,
      pendingPlan: null,
      asaasSubscriptionId: 'sub_old',
      asaasCustomerId: 'cus_1',
      phoneNumber: '5511999999999',
    });

    jest.spyOn(service, 'calculatePlanChange').mockResolvedValue({
      canChange: true,
      changePrice: 10,
      daysRemaining: 5,
      isDowngrade: false,
    });

    const payment: AsaasPayment = {
      id: 'pay_2',
      customer: 'cus_1',
      billingType: 'CREDIT_CARD',
      value: 10,
      status: 'PENDING',
      dueDate: '2026-01-10',
    };

    paymentService.createPayment.mockResolvedValue(payment);
    paymentService.getPaymentStatus.mockReturnValue('PENDING');
    paymentService.upsertPaymentRecord.mockResolvedValue(undefined);

    const result = await service.changeSubscriptionPlan(
      2,
      SubscriptionPlan.PRO,
      'cus_1',
      { paymentMethod: AsaasBillingType.CREDIT_CARD, chatId: '5511999999999' },
    );

    expect(paymentService.getPixQrCode).not.toHaveBeenCalled();
    expect(result.pix).toBeUndefined();
    expect(result.changeInfo.waitingPayment).toBe(true);
  });

  it('changeSubscriptionPlan schedules downgrade without charging', async () => {
    prisma.userProfile.findUnique.mockResolvedValue({
      id: 3,
      subscriptionPlan: SubscriptionPlan.PRO,
      subscriptionExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      isPaymentActive: true,
      pendingPlan: null,
      asaasSubscriptionId: 'sub_old',
      asaasCustomerId: 'cus_1',
      phoneNumber: '5511999999999',
    });

    prisma.payment.count.mockResolvedValue(0);

    jest.spyOn(service, 'calculatePlanChange').mockResolvedValue({
      canChange: true,
      changePrice: 0,
      daysRemaining: 10,
      isDowngrade: true,
    });

    const result = await service.changeSubscriptionPlan(
      3,
      SubscriptionPlan.PLUS,
      'cus_1',
      { paymentMethod: AsaasBillingType.CREDIT_CARD, chatId: '5511999999999' },
    );

    expect(prisma.userProfile.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { pendingPlan: SubscriptionPlan.PLUS },
    });
    expect(result.changeInfo.scheduled).toBe(true);
    expect(result.changeInfo.isDowngrade).toBe(true);
    expect(result.changeInfo.charged).toBe(false);
  });

  it('calculatePlanChange uses real cycle for monthly to annual upgrade', async () => {
    const now = new Date('2026-01-10T10:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);

    apiClient.request.mockResolvedValueOnce({
      id: 'sub_1',
      customer: 'cus_1',
      billingType: 'CREDIT_CARD',
      value: 29.9,
      nextDueDate: '2026-02-10',
      cycle: 'MONTHLY',
      status: 'ACTIVE',
    });
    paymentService.getUpcomingPaymentBySubscription.mockResolvedValue(null);

    const result = await service.calculatePlanChange(
      SubscriptionPlan.PLUS,
      SubscriptionPlan.PRO_ANUAL,
      'sub_1',
    );

    const annualEnd = new Date(now);
    annualEnd.setFullYear(annualEnd.getFullYear() + 1);
    const expectedAnnualDays = Math.max(
      1,
      Math.ceil((annualEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    );

    expect(result.canChange).toBe(true);
    expect(result.isDowngrade).toBe(false);
    expect(result.daysRemaining).toBe(expectedAnnualDays);
    expect(result.changePrice).toBeGreaterThanOrEqual(0);

    jest.useRealTimers();
  });

  it('calculatePlanChange uses upcoming payment dueDate for monthly to annual upgrade', async () => {
    const now = new Date('2026-01-12T00:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);

    apiClient.request.mockResolvedValueOnce({
      id: 'sub_2',
      customer: 'cus_1',
      billingType: 'CREDIT_CARD',
      value: 49.9,
      nextDueDate: '2026-03-12',
      cycle: 'MONTHLY',
      status: 'ACTIVE',
    });

    paymentService.getUpcomingPaymentBySubscription.mockResolvedValueOnce({
      id: 'pay_3',
      customer: 'cus_1',
      billingType: 'CREDIT_CARD',
      value: 49.9,
      status: 'PENDING',
      dueDate: '2026-02-12',
    });

    const result = await service.calculatePlanChange(
      SubscriptionPlan.PRO,
      SubscriptionPlan.PLUS_ANUAL,
      'sub_2',
    );

    expect(result.canChange).toBe(true);
    expect(result.isDowngrade).toBe(false);
    expect(result.changePrice).toBeCloseTo(237.1, 2);
    expect(result.daysRemaining).toBeGreaterThanOrEqual(365);

    jest.useRealTimers();
  });

  it('calculatePlanChange treats downgrade with zero charge', async () => {
    const now = new Date('2026-01-12T00:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);

    apiClient.request.mockResolvedValueOnce({
      id: 'sub_3',
      customer: 'cus_1',
      billingType: 'CREDIT_CARD',
      value: 49.9,
      nextDueDate: '2026-02-12',
      cycle: 'MONTHLY',
      status: 'ACTIVE',
    });
    paymentService.getUpcomingPaymentBySubscription.mockResolvedValueOnce(null);

    const result = await service.calculatePlanChange(
      SubscriptionPlan.PRO,
      SubscriptionPlan.PLUS,
      'sub_3',
    );

    expect(result.canChange).toBe(true);
    expect(result.isDowngrade).toBe(true);
    expect(result.changePrice).toBe(0);
    expect(result.daysRemaining).toBe(31);

    jest.useRealTimers();
  });
});
