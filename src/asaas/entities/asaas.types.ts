export type AsaasCustomer = {
  id: string;
  name: string;
  email?: string;
  cpfCnpj?: string;
  mobilePhone?: string;
  phone?: string;
  postalCode?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  notificationDisabled?: boolean;
  dateCreated?: string;
};

export type AsaasPaymentStatus =
  | 'PENDING'
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'RECEIVED_IN_CASH'
  | 'RECEIVED_IN_CASH_UNDONE'
  | 'CHARGED_BACK'
  | 'CANCELLED';

export type AsaasPayment = {
  object?: string;
  id: string;
  customer: string;
  subscription?: string; // ID da assinatura se pertencer a uma
  billingType: string;
  value: number;
  netValue?: number;
  description?: string;
  status: AsaasPaymentStatus;
  dueDate: string;
  originalDueDate?: string;
  confirmedDate?: string;
  paymentDate?: string;
  clientPaymentDate?: string;
  installmentNumber?: number;
  externalReference?: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  transactionReceiptUrl?: string;
  pixTransaction?: {
    endToEndIdentifier?: string;
    payload?: string;
    qrCode?: string;
  };
};

export type AsaasWebhookPayload = {
  event?: string;
  payment: AsaasPayment;
};

export type CreditCardHolderInfoPayload = {
  name: string;
  email?: string;
  cpfCnpj: string;
  postalCode?: string;
  addressNumber?: string;
  addressComplement?: string;
  phone?: string;
  mobilePhone?: string;
};

export type AsaasSubscription = {
  id: string;
  customer: string;
  billingType: string;
  value: number;
  nextDueDate: string;
  cycle: 'MONTHLY' | 'YEARLY';
  status: 'ACTIVE' | 'INACTIVE' | 'EXPIRED';
  description?: string;
  externalReference?: string;
  dateCreated?: string;
  deleted?: boolean;
};

export type CreditCardPayload = {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
};
