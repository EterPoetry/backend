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
    this.logger.log(
      `Creating checkout invoice: ${this.stringifyForLog(this.sanitizePayloadForLog(payload))}`,
    );
    const response = await this.post<ProviderInvoiceCreateResponseRaw>(
      '/api/merchant/invoice/create',
      payload,
    );

    return this.normalizeInvoiceCreateResponse(response);
  }

  async fetchPublicKey(): Promise<string> {
    this.logger.log('Fetching payments provider public key.');
    const response = await this.get<{ publicKey?: string; key?: string } | string>(
      '/api/merchant/pubkey',
      true,
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
    this.logger.log(`Cancelling provider invoice ${invoiceId}.`);
    await this.post('/api/merchant/invoice/cancel', { invoiceId });
  }

  async fetchInvoiceStatus(invoiceId: string): Promise<ProviderInvoiceStatusResponse> {
    this.logger.log(`Fetching provider invoice status for ${invoiceId}.`);
    return this.get<ProviderInvoiceStatusResponse>(
      `/api/merchant/invoice/status?invoiceId=${encodeURIComponent(invoiceId)}`,
    );
  }

  async createWalletPayment(payload: Record<string, unknown>): Promise<ProviderInvoiceResponse> {
    this.logger.log(
      `Creating wallet payment: ${this.stringifyForLog(this.sanitizePayloadForLog(payload))}`,
    );
    const response = await this.post<ProviderInvoiceCreateResponseRaw>(
      '/api/merchant/wallet/payment',
      payload,
    );

    return this.normalizeInvoiceCreateResponse(response);
  }

  async deleteCard(cardToken: string): Promise<void> {
    try {
      this.logger.log(`Deleting provider card token ${this.maskToken(cardToken)}.`);
      await this.delete(`/api/merchant/wallet/card?cardToken=${encodeURIComponent(cardToken)}`);
    } catch (error) {
      this.logger.warn(
        `Failed to delete payment provider card token ${this.maskToken(cardToken)}: ${this.getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  private async delete<T = void>(path: string, authorized = true): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' }, authorized);
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

    const url = new URL(path, baseUrl);
    this.logger.log(
      `Payments API request ${init.method} ${url.pathname}${url.search} auth=${authorized ? 'x-token' : 'none'}`,
    );

    const response = await fetch(new URL(path, baseUrl), {
      ...init,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.warn(
        `Payments API response ${response.status} ${url.pathname}${url.search}: ${this.limitForLog(errorText)}`,
      );
      throw new ServiceUnavailableException(
        `Payments API request failed with ${response.status}: ${errorText || response.statusText}`,
      );
    }

    if (response.status === 204) {
      this.logger.log(`Payments API response 204 ${url.pathname}${url.search}.`);
      return undefined as T;
    }

    const responseText = await response.text();
    if (!responseText.trim()) {
      this.logger.log(`Payments API response ${response.status} ${url.pathname}${url.search}: [empty body]`);
      return undefined as T;
    }

    const json = JSON.parse(responseText) as T;
    this.logger.log(
      `Payments API response ${response.status} ${url.pathname}${url.search}: ${this.stringifyForLog(
        this.sanitizePayloadForLog(json),
      )}`,
    );
    return json;
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

  private sanitizePayloadForLog(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizePayloadForLog(item));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
      if (key === 'cardToken' && typeof entryValue === 'string') {
        return [key, this.maskToken(entryValue)];
      }

      return [key, this.sanitizePayloadForLog(entryValue)];
    });

    return Object.fromEntries(entries);
  }

  private maskToken(value: string): string {
    if (value.length <= 8) {
      return '****';
    }

    return `${value.slice(0, 4)}...${value.slice(-4)}`;
  }

  private stringifyForLog(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable]';
    }
  }

  private limitForLog(value: string): string {
    return value.length > 1000 ? `${value.slice(0, 1000)}...` : value;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown error';
  }
}
