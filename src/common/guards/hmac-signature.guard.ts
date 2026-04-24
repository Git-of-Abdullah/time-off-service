import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';

const REPLAY_WINDOW_SECONDS = 300;

@Injectable()
export class HmacSignatureGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    const signature = req.headers['x-hcm-signature'] as string | undefined;
    if (!signature) throw new UnauthorizedException('Missing HCM signature');

    const rawBody: Buffer = (req as any).rawBody;
    if (!rawBody) throw new UnauthorizedException('Raw body unavailable');

    if (!this.isTimestampValid(req.body?.timestamp)) {
      throw new UnauthorizedException('Webhook timestamp outside replay window');
    }

    if (!this.verifySignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid HCM signature');
    }

    return true;
  }

  private isTimestampValid(timestamp: unknown): boolean {
    // Batch-sync payloads carry no timestamp — replay protection comes from payload-hash
    // idempotency instead. Only enforce the window when a timestamp field is present.
    if (timestamp === undefined || timestamp === null) return true;
    if (typeof timestamp !== 'number') return false;
    const diffSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
    return diffSeconds <= REPLAY_WINDOW_SECONDS;
  }

  private verifySignature(rawBody: Buffer, incomingSignature: string): boolean {
    const secret = this.config.get<string>('HCM_WEBHOOK_SECRET', '');
    const prevSecret = this.config.get<string>('HCM_WEBHOOK_SECRET_PREV', '');

    if (this.checkHmac(rawBody, secret, incomingSignature)) return true;
    if (prevSecret && this.checkHmac(rawBody, prevSecret, incomingSignature)) return true;
    return false;
  }

  private checkHmac(body: Buffer, secret: string, incoming: string): boolean {
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(incoming, 'hex'));
    } catch {
      return false;
    }
  }
}
