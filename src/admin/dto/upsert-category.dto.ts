import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAdminCategoryDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  categoryName: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  categoryDescription?: string | null;
}

export class UpdateAdminCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  categoryName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  categoryDescription?: string | null;
}
