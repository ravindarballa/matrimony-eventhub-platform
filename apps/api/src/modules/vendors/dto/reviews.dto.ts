import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsMongoId,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  MAX_REVIEW_BODY,
  MAX_REVIEW_TITLE,
  MAX_VENDOR_REPLY,
  MIN_REVIEW_BODY,
} from '@eventhub/contracts';

/**
 * The four scores, validated as a nested object rather than four flat fields,
 * so the error a client gets back names `scores.value` and not `value` - which
 * matters when the form renders one star row per aspect.
 */
export class ReviewScoresDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  quality!: number;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  professionalism!: number;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  value!: number;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  flexibility!: number;
}

export class CreateReviewDto {
  @ApiProperty({ description: 'The completed booking being reviewed' })
  @IsMongoId()
  bookingId!: string;

  @ApiProperty({ type: ReviewScoresDto })
  @ValidateNested()
  @Type(() => ReviewScoresDto)
  scores!: ReviewScoresDto;

  @ApiProperty({ maxLength: MAX_REVIEW_TITLE })
  @IsString()
  @MinLength(3)
  @MaxLength(MAX_REVIEW_TITLE)
  title!: string;

  /**
   * A floor of thirty characters, because "good" helps nobody choose a
   * photographer and a rating with no reason behind it is just a number.
   */
  @ApiProperty({ minLength: MIN_REVIEW_BODY, maxLength: MAX_REVIEW_BODY })
  @IsString()
  @MinLength(MIN_REVIEW_BODY, {
    message: 'Tell other couples what the day was actually like.',
  })
  @MaxLength(MAX_REVIEW_BODY)
  body!: string;
}

export class VendorReplyDto {
  @ApiProperty({ maxLength: MAX_VENDOR_REPLY })
  @IsString()
  @MinLength(2)
  @MaxLength(MAX_VENDOR_REPLY)
  body!: string;
}
