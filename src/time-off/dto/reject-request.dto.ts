import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectRequestDto {
  @IsString()
  @MaxLength(64)
  managerId: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
