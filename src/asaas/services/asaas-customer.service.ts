import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { CreateCustomerDto } from '../dto/create-customer.dto';
import { AsaasCustomer } from '../entities/asaas.types';
import { AsaasApiClient } from './asaas-api.client';

@Injectable()
export class AsaasCustomerService {
  private readonly logger = new Logger(AsaasCustomerService.name);

  constructor(private readonly apiClient: AsaasApiClient) { }

  async createCustomer(dto: CreateCustomerDto): Promise<AsaasCustomer> {
    return this.apiClient.request<AsaasCustomer>('/customers', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  }

  async findCustomerByCpf(cpfCnpj: string): Promise<AsaasCustomer | null> {
    try {
      const result = await this.apiClient.request<{ data?: AsaasCustomer[]; customers?: AsaasCustomer[] }>(
        `/customers?cpfCnpj=${cpfCnpj}`,
        { method: 'GET' },
      );
      const list: AsaasCustomer[] = result?.data ?? result?.customers ?? [];
      return list[0] ?? null;
    } catch (error) {
      this.logger.warn(`Nao foi possivel localizar cliente Asaas por CPF ${cpfCnpj}`);
      return null;
    }
  }

  async ensureCustomerFromProfile(profile: {
    name: string;
    cpfCnpj: string;
    email?: string;
    phone?: string;
    mobilePhone?: string;
  }): Promise<AsaasCustomer> {
    const dto: CreateCustomerDto = {
      name: profile.name,
      cpfCnpj: profile.cpfCnpj,
      email: profile.email,
      phone: profile.phone,
      mobilePhone: profile.mobilePhone,
    };

    try {
      return await this.createCustomer(dto);
    } catch (error: unknown) {
      const status =
        typeof (error as { getStatus?: () => number }).getStatus === 'function'
          ? (error as { getStatus: () => number }).getStatus()
          : 0;
      if (status === HttpStatus.CONFLICT || status === HttpStatus.BAD_REQUEST) {
        const existing = await this.findCustomerByCpf(profile.cpfCnpj);
        if (existing) return existing;
      }
      throw error;
    }
  }
}
