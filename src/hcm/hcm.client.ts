import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';

export interface HcmBalance {
  employeeId: string;
  locationId: string;
  leaveType: string;
  balance: number;
}

export interface HcmDeductResult {
  transactionId: string;
  remainingBalance: number;
}

/** HTTP status codes that warrant a retry attempt. */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

@Injectable()
export class HcmClient {
  private readonly logger = new Logger(HcmClient.name);
  private readonly http: AxiosInstance;
  private readonly maxRetries: number;

  constructor(private readonly config: ConfigService) {
    this.maxRetries = config.get<number>('HCM_MAX_RETRIES', 3);
    this.http = axios.create({
      baseURL: config.get<string>('HCM_BASE_URL'),
      timeout: config.get<number>('HCM_TIMEOUT_MS', 4000),
    });
  }

  async getBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): Promise<HcmBalance> {
    return this.withRetry(() =>
      this.http
        .get<HcmBalance>('/balance', { params: { employeeId, locationId, leaveType } })
        .then((r) => r.data),
    );
  }

  async deductBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
    idempotencyKey: string,
  ): Promise<HcmDeductResult> {
    return this.withRetry(() =>
      this.http
        .post<HcmDeductResult>('/balance/deduct', {
          employeeId,
          locationId,
          leaveType,
          days,
          idempotencyKey,
        })
        .then((r) => r.data),
    );
  }

  async creditBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
    originalTransactionId: string,
  ): Promise<void> {
    return this.withRetry(() =>
      this.http
        .post('/balance/credit', {
          employeeId,
          locationId,
          leaveType,
          days,
          originalTransactionId,
        })
        .then(() => undefined),
    );
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (err) {
        const axiosErr = err as AxiosError;
        const status = axiosErr.response?.status;

        const isRetryable = !status || RETRYABLE_STATUSES.has(status);
        attempt++;

        if (!isRetryable || attempt > this.maxRetries) {
          throw err;
        }

        const retryAfterHeader = axiosErr.response?.headers?.['retry-after'];
        const delayMs = retryAfterHeader
          ? Number(retryAfterHeader) * 1000
          : Math.min(500 * Math.pow(2, attempt - 1), 2000);

        this.logger.warn(`HCM call failed (attempt ${attempt}/${this.maxRetries}), retrying in ${delayMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
}
