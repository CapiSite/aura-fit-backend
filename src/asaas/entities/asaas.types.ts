export type AsaasEnvironment = 'production' | 'sandbox';

export type AsaasError = {
  code?: string;
  description?: string;
};

export type AsaasResponseMeta = {
  object?: string;
};

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
  | 'RECEIVED_IN_CASH_UNDONE'
  | 'CHARGED_BACK'
  | 'CANCELLED';

export type AsaasPayment = {
  object?: string;
  id: string;
  customer: string;
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
