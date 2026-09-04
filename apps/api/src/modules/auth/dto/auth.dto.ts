import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';
import { INDIAN_MOBILE_REGEX, OtpPurpose, Role } from '@eventhub/contracts';

const SIGNUP_INTENTS = [Role.SEEKER, Role.CUSTOMER, Role.VENDOR_OWNER] as const;

export class RegisterDto {
  @ApiProperty({ example: 'Ravindar Balla' })
  @IsString()
  @MinLength(3, { message: 'Enter the name as it appears on your ID' })
  fullName!: string;

  @ApiProperty({ example: '9876543210', description: '10 digits, starting 6-9' })
  @Matches(INDIAN_MOBILE_REGEX, {
    message: 'Enter a 10-digit Indian mobile number',
  })
  mobile!: string;

  @ApiProperty({ enum: SIGNUP_INTENTS })
  @IsIn(SIGNUP_INTENTS)
  intent!: (typeof SIGNUP_INTENTS)[number];

  @ApiProperty({ example: true })
  @IsBoolean()
  consent!: boolean;
}

export class VerifyOtpDto {
  @ApiProperty()
  @IsString()
  challengeId!: string;

  @ApiProperty({ example: '123456' })
  @Length(6, 6, { message: 'The code is 6 digits' })
  @Matches(/^\d{6}$/, { message: 'The code is 6 digits' })
  code!: string;

  @ApiProperty({ enum: Object.values(OtpPurpose) })
  @IsIn(Object.values(OtpPurpose))
  purpose!: OtpPurpose;
}

export class LoginDto {
  @ApiProperty({ example: '9876543210' })
  @Matches(INDIAN_MOBILE_REGEX, { message: 'Enter a valid mobile number' })
  mobile!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  otpChallengeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{6}$/)
  otpCode?: string;
}

export class SetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(8, { message: 'Use at least 8 characters' })
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Include an uppercase letter, a lowercase letter and a number',
  })
  password!: string;
}

export class AddRoleDto {
  @ApiProperty({ enum: [Role.SEEKER, Role.CUSTOMER] })
  @IsIn([Role.SEEKER, Role.CUSTOMER])
  role!: typeof Role.SEEKER | typeof Role.CUSTOMER;
}
