import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  MAX_MESSAGE_LENGTH,
  Diet,
  Gender,
  MaritalStatus,
  PhotoPrivacy,
  ProfileManagedBy,
} from '@eventhub/contracts';

class EducationDto {
  @IsOptional() @IsString() @MaxLength(120) highestQualification?: string;
  @IsOptional() @IsString() @MaxLength(120) fieldOfStudy?: string;
  @IsOptional() @IsString() @MaxLength(160) institution?: string;
}

class CareerDto {
  @IsOptional() @IsString() @MaxLength(120) occupation?: string;
  @IsOptional() @IsString() @MaxLength(160) employer?: string;
  /** Integer paisa per year. */
  @IsOptional() @IsInt() @Min(0) annualIncome?: number;
}

class FamilyDto {
  @IsOptional() @IsString() @MaxLength(120) fatherOccupation?: string;
  @IsOptional() @IsString() @MaxLength(120) motherOccupation?: string;
  @IsOptional() @IsInt() @Min(0) @Max(20) siblings?: number;
  @IsOptional() @IsIn(['JOINT', 'NUCLEAR']) familyType?: 'JOINT' | 'NUCLEAR';
  @IsOptional() @IsString() @MaxLength(120) nativePlace?: string;
}

class HoroscopeDto {
  @IsOptional() @IsString() @MaxLength(20) birthTime?: string;
  @IsOptional() @IsString() @MaxLength(160) birthPlace?: string;
  @IsOptional() @IsInt() @Min(1) @Max(27) nakshatra?: number;
  @IsOptional() @IsInt() @Min(1) @Max(12) rashi?: number;
  @IsOptional() @IsInt() @Min(1) @Max(12) marsHouse?: number;
  @IsOptional() @IsBoolean() manglik?: boolean;
}

class PrivacyDto {
  @IsOptional() @IsEnum(PhotoPrivacy) photos?: PhotoPrivacy;
  @IsOptional()
  @IsIn(['ON_MUTUAL_INTEREST', 'MEMBERS_ONLY'])
  showContact?: 'ON_MUTUAL_INTEREST' | 'MEMBERS_ONLY';
}

export class UpsertProfileDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName!: string;

  @ApiProperty({ enum: ProfileManagedBy })
  @IsEnum(ProfileManagedBy)
  managedBy!: ProfileManagedBy;

  @ApiProperty({ enum: Gender })
  @IsEnum(Gender)
  gender!: Gender;

  @ApiProperty()
  @IsISO8601()
  dateOfBirth!: string;

  @ApiProperty({ description: 'Centimetres' })
  @IsInt()
  @Min(120)
  @Max(250)
  heightCm!: number;

  @ApiProperty({ enum: MaritalStatus })
  @IsEnum(MaritalStatus)
  maritalStatus!: MaritalStatus;

  @ApiProperty() @IsString() @MinLength(2) @MaxLength(60) religion!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(60) community!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) gotra?: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(60) motherTongue!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) city!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) state?: string;

  @ApiProperty({ enum: Diet })
  @IsEnum(Diet)
  diet!: Diet;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  about?: string;

  @IsOptional() @ValidateNested() @Type(() => EducationDto) education?: EducationDto;
  @IsOptional() @ValidateNested() @Type(() => CareerDto) career?: CareerDto;
  @IsOptional() @ValidateNested() @Type(() => FamilyDto) family?: FamilyDto;
  @IsOptional() @ValidateNested() @Type(() => HoroscopeDto) horoscope?: HoroscopeDto;
  @IsOptional() @ValidateNested() @Type(() => PrivacyDto) privacy?: PrivacyDto;
}

export class PartnerPreferencesDto {
  @ApiProperty() @IsInt() @Min(18) @Max(100) ageMin!: number;
  @ApiProperty() @IsInt() @Min(18) @Max(100) ageMax!: number;

  @IsOptional() @IsInt() @Min(120) @Max(250) heightMinCm?: number;
  @IsOptional() @IsInt() @Min(120) @Max(250) heightMaxCm?: number;

  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) communities!: string[];
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) cities!: string[];
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) education!: string[];

  @IsOptional() @IsEnum(Diet) diet?: Diet;

  @IsArray()
  @ArrayMaxSize(4)
  @IsEnum(MaritalStatus, { each: true })
  maritalStatuses!: MaritalStatus[];

  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) excludeGotras!: string[];
}

/** Query strings arrive as text, so every numeric filter is coerced. */
export class ProfileSearchDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(18) @Max(100) ageMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(18) @Max(100) ageMax?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(120) @Max(250) heightMinCm?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(120) @Max(250) heightMaxCm?: number;

  @IsOptional() @IsString() @MaxLength(60) religion?: string;
  @IsOptional() @IsString() @MaxLength(60) community?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(60) motherTongue?: string;

  @IsOptional() @IsEnum(Diet) diet?: Diet;
  @IsOptional() @IsEnum(MaritalStatus) maritalStatus?: MaritalStatus;

  /**
   * A query string carries one value as a bare string and several as an array,
   * so a single gotra would otherwise be validated as an array of characters
   * and rejected. Normalising here keeps ?excludeGotras=Kashyap working.
   */
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null
      ? undefined
      : Array.isArray(value)
        ? value
        : [value],
  )
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  excludeGotras?: string[];

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(36) minGunaScore?: number;

  @IsOptional() @IsIn(['recent', 'guna', 'age']) sort?: 'recent' | 'guna' | 'age';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

export class SendInterestDto {
  @ApiProperty() @IsMongoId() toProfileId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) message?: string;
}

export class InterestTabQuery {
  @IsOptional()
  @IsIn(['received', 'sent', 'accepted'])
  tab?: 'received' | 'sent' | 'accepted';
}

export class ShortlistDto {
  @ApiProperty() @IsMongoId() targetProfileId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class BlockDto {
  @ApiProperty() @IsMongoId() targetProfileId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class SendMessageDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_MESSAGE_LENGTH)
  body!: string;
}
