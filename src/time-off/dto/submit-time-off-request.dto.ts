import {
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { LeaveType } from '../../common/enums/leave-type.enum';

export class SubmitTimeOffRequestDto {
  @IsString()
  @MaxLength(64)
  employeeId: string;

  @IsString()
  @MaxLength(64)
  locationId: string;

  @IsEnum(LeaveType)
  leaveType: LeaveType;

  @IsISO8601({ strict: true })
  startDate: string;

  @IsISO8601({ strict: true })
  endDate: string;

  @IsNumber()
  @Min(0.5)
  @Max(90)
  daysRequested: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
