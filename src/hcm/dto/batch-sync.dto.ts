import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsNumber,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BatchSyncRecordDto {
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
  balance: number;
}

export class BatchSyncDto {
  @IsString()
  syncId: string;

  @IsISO8601({ strict: true })
  generatedAt: string;

  @IsArray()
  @ArrayMaxSize(100_000)
  @ValidateNested({ each: true })
  @Type(() => BatchSyncRecordDto)
  records: BatchSyncRecordDto[];
}
