import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AsaasApiClient {
  private readonly logger = new Logger(AsaasApiClient.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    const rawBaseUrl =
      this.configService.get<string>('asaas.baseUrl') ??
      'https://sandbox.asaas.com/api/v3';
    this.baseUrl = this.normalizeBaseUrl(rawBaseUrl);
    this.apiKey = this.configService.get<string>('asaas.apiKey') ?? '';
  }

  private normalizeBaseUrl(url: string): string {
    return url.replace(/\/+$/, '');
  }

  async request<T>(
    path: string,
    init: RequestInit & { body?: string },
  ): Promise<T> {
    if (!this.apiKey) {
      this.logger.error('ASAAS_API_KEY ausente. Pagamentos indisponiveis.');
      throw new HttpException(
        'Pagamento indisponivel no momento. Tente novamente em instantes.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        access_token: this.apiKey,
        ...(init.headers ?? {}),
      },
    });

    const text = await response.text();
    let data: unknown = undefined;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch (parseError) {
      this.logger.warn(`Falha ao parsear resposta do Asaas em ${path}: ${text}`);
    }

    if (!response.ok) {
      const responseData = data as { errors?: { description?: string }[]; message?: string } | undefined;
      const description =
        responseData?.errors?.[0]?.description ||
        responseData?.message ||
        'Erro ao comunicar com o Asaas';

      this.logger.error(
        `Asaas error ${response.status} on ${path}: ${description}`,
        text,
      );

      const userMessage =
        response.status === HttpStatus.BAD_REQUEST ||
          response.status === HttpStatus.PAYMENT_REQUIRED ||
          response.status === HttpStatus.UNPROCESSABLE_ENTITY
          ? 'Dados de pagamento invalidos. Verifique as informacoes e tente novamente.'
          : 'Nao foi possivel processar o pagamento agora. Tente novamente em instantes.';

      throw new HttpException(
        userMessage,
        (response.status as HttpStatus) || HttpStatus.BAD_GATEWAY,
      );
    }

    return data as T;
  }
}
