import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveRequestDto {
  @IsString()
  @MaxLength(64)
  managerId: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
