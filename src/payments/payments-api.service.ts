import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface ProviderInvoiceResponse {
  invoiceId: string;
  checkoutUrl: string | null;
  status?: string;
  modifiedDate?: string;
}

interface ProviderInvoiceCreateResponseRaw {
  invoiceId?: string;
  checkoutUrl?: string;
  url?: string;
  pageUrl?: string;
  paymentUrl?: string;
  redirectUrl?: string;
  status?: string;
  modifiedDate?: string;
}

interface ProviderInvoiceStatusResponse {
  invoiceId: string;
  status: string;
  amount?: number;
  ccy?: string | number;
  createdDate?: string;
  modifiedDate?: string;
  walletData?: {
    walletId?: string;
    cardToken?: string;
    status?: string;
  };
  paymentInfo?: {
    paymentSystem?: string;
    maskedPan?: string;
  };
}

@Injectable()
export class PaymentsApiService {
  private readonly logger = new Logger(PaymentsApiService.name);

  constructor(private readonly configService: ConfigService) {}

  async createCheckoutInvoice(payload: Record<string, unknown>): Promise<ProviderInvoiceResponse> {
    const response = await this.post<ProviderInvoiceCreateResponseRaw>(
      '/api/merchant/invoice/create',
      payload,
    );

    return this.normalizeInvoiceCreateResponse(response);
  }

  async fetchPublicKey(): Promise<string> {
    const response = await this.get<{ publicKey?: string; key?: string } | string>(
      '/api/merchant/pubkey',
      false,
    );

    if (typeof response === 'string') {
      return response;
    }

    const publicKey = response.publicKey ?? response.key;
    if (!publicKey) {
      throw new ServiceUnavailableException('Payment provider public key is missing.');
    }

    return Buffer.from(publicKey, 'base64').toString('utf8');
  }

  async cancelInvoice(invoiceId: string): Promise<void> {
    await this.post('/api/merchant/invoice/cancel', { invoiceId });
  }

  async fetchInvoiceStatus(invoiceId: string): Promise<ProviderInvoiceStatusResponse> {
    return this.get<ProviderInvoiceStatusResponse>(
      `/api/merchant/invoice/status?invoiceId=${encodeURIComponent(invoiceId)}`,
    );
  }

  async createWalletPayment(payload: Record<string, unknown>): Promise<ProviderInvoiceResponse> {
    const response = await this.post<ProviderInvoiceCreateResponseRaw>(
      '/api/merchant/wallet/payment',
      payload,
    );

    return this.normalizeInvoiceCreateResponse(response);
  }

  async deleteCard(cardToken: string): Promise<void> {
    try {
      await this.post('/api/merchant/wallet/card/delete', { cardToken });
    } catch (error) {
      this.logger.warn(`Failed to delete payment provider card token: ${cardToken}`);
      throw error;
    }
  }

  private async get<T>(path: string, authorized = true): Promise<T> {
    return this.request<T>(path, { method: 'GET' }, authorized);
  }

  private async post<T = void>(
    path: string,
    body: Record<string, unknown>,
    authorized = true,
  ): Promise<T> {
    return this.request<T>(
      path,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      authorized,
    );
  }

  private async request<T>(path: string, init: RequestInit, authorized = true): Promise<T> {
    const baseUrl = this.configService.get<string>('PAYMENTS_API_BASE_URL')?.trim();
    if (!baseUrl) {
      throw new ServiceUnavailableException('Payments API base URL is not configured.');
    }

    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');

    if (authorized) {
      const token = this.configService.get<string>('PAYMENTS_API_TOKEN')?.trim();
      if (!token) {
        throw new ServiceUnavailableException('Payments API token is not configured.');
      }

      headers.set('x-token', token);
    }

    const response = await fetch(new URL(path, baseUrl), {
      ...init,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ServiceUnavailableException(
        `Payments API request failed with ${response.status}: ${errorText || response.statusText}`,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  private normalizeInvoiceCreateResponse(
    response: ProviderInvoiceCreateResponseRaw,
  ): ProviderInvoiceResponse {
    const invoiceId = response.invoiceId?.trim();
    if (!invoiceId) {
      throw new ServiceUnavailableException('Payments API did not return invoiceId.');
    }

    const checkoutUrl =
      response.checkoutUrl?.trim() ||
      response.url?.trim() ||
      response.pageUrl?.trim() ||
      response.paymentUrl?.trim() ||
      response.redirectUrl?.trim() ||
      null;

    if (!checkoutUrl) {
      this.logger.warn(`Payments API returned invoiceId ${invoiceId} without checkout URL.`);
    }

    return {
      invoiceId,
      checkoutUrl,
      status: response.status,
      modifiedDate: response.modifiedDate,
    };
  }
}
