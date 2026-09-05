import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaymentMilestone, PlanCode } from '@eventhub/contracts';

export class CreateIntentDto {
  @ApiProperty()
  @IsMongoId()
  bookingId!: string;

  @ApiProperty({ enum: PaymentMilestone })
  @IsEnum(PaymentMilestone)
  milestone!: PaymentMilestone;
}

export class RefundDto {
  /**
   * Integer paisa. Omitted means the whole remaining captured amount - the
   * server decides what that is, the client never computes it.
   */
  @ApiPropertyOptional({ description: 'Integer paisa; omit to refund the remainder' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class BuyPlanDto {
  @ApiProperty({ enum: PlanCode })
  @IsEnum(PlanCode)
  plan!: PlanCode;
}
