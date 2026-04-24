import { IsISO8601, IsNumber, IsString, MaxLength, Min } from 'class-validator';

export class BalanceUpdateWebhookDto {
  @IsString()
  eventId: string;

  @IsNumber()
  timestamp: number;

  @IsString()
  eventType: string;

  @IsString()
  @MaxLength(64)
  employeeId: string;

  @IsString()
  @MaxLength(64)
  locationId: string;

  @IsString()
  @MaxLength(64)
  leaveType: string;

  @IsNumber()
  @Min(0)
  newBalance: number;

  @IsString()
  reason: string;

  @IsISO8601({ strict: true })
  effectiveAt: string;
}
