import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  GSTIN_REGEX,
  IFSC_REGEX,
  PAN_REGEX,
  PricingModel,
  VendorCategory,
} from '@eventhub/contracts';

export class OnboardVendorDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  businessName!: string;

  @ApiProperty({ enum: VendorCategory })
  @IsEnum(VendorCategory)
  category!: VendorCategory;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  city!: string;

  @ApiProperty()
  @IsString()
  @MinLength(20, { message: 'Tell customers a little more than that.' })
  @MaxLength(2000)
  description!: string;
}

export class SubmitKycDto {
  @ApiProperty({ example: 'ABCDE1234F' })
  @Matches(PAN_REGEX, { message: 'That is not a valid PAN.' })
  pan!: string;

  @ApiPropertyOptional({ description: 'Required above the Rs 20 lakh threshold' })
  @IsOptional()
  @Matches(GSTIN_REGEX, { message: 'That is not a valid GSTIN.' })
  gstin?: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  bankAccountName!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^\d{9,18}$/, { message: 'That is not a valid account number.' })
  bankAccountNumber!: string;

  @ApiProperty({ example: 'HDFC0001234' })
  @Matches(IFSC_REGEX, { message: 'That is not a valid IFSC code.' })
  ifsc!: string;
}

export class KycDecisionDto {
  @ApiProperty({ enum: ['VERIFIED', 'REJECTED'] })
  @IsIn(['VERIFIED', 'REJECTED'])
  decision!: 'VERIFIED' | 'REJECTED';

  @ApiPropertyOptional({ description: 'Required when rejecting' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpsertServiceDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  description!: string;

  @ApiProperty({ enum: PricingModel })
  @IsEnum(PricingModel)
  pricingModel!: PricingModel;

  @ApiProperty({ description: 'Integer paisa, per unit of the pricing model' })
  @IsInt()
  @IsPositive()
  basePrice!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  minimumUnits?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  inclusions!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Query params arrive as strings, so every numeric field is coerced. */
export class VendorSearchDto {
  @ApiPropertyOptional({ enum: VendorCategory })
  @IsOptional()
  @IsEnum(VendorCategory)
  category?: VendorCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ description: 'ISO date; excludes vendors already booked' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}/, { message: 'Use an ISO date.' })
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  maxPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({ enum: ['rating', 'price', 'response'] })
  @IsOptional()
  @IsIn(['rating', 'price', 'response'])
  sort?: 'rating' | 'price' | 'response';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class CalendarRangeDto {
  @ApiProperty({ description: 'ISO date, inclusive' })
  @Matches(/^\d{4}-\d{2}-\d{2}/, { message: 'Use an ISO date.' })
  from!: string;

  @ApiProperty({ description: 'ISO date, inclusive' })
  @Matches(/^\d{4}-\d{2}-\d{2}/, { message: 'Use an ISO date.' })
  to!: string;
}

export class BlockDatesDto {
  @ApiProperty({ type: [String], description: 'ISO dates' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(90)
  @Matches(/^\d{4}-\d{2}-\d{2}/, { each: true, message: 'Use ISO dates.' })
  dates!: string[];

  @ApiPropertyOptional({ example: 'Family wedding' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
