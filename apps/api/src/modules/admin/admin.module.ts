import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  Param,
  Post,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Types } from 'mongoose';
import type { Connection } from 'mongoose';
import { IsIn, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  BookingStatus,
  KycStatus,
  LedgerAccount,
  ProfileStatus,
  type Paisa,
  type PhotoModerationItemDto,
  type PlatformMetricsDto,
} from '@eventhub/contracts';

import { Roles } from '../../core/decorators.js';

class ModerationDecisionDto {
  @IsMongoId() profileId!: string;
  @IsString() @MaxLength(64) photoId!: string;
  @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

/**
 * Read-mostly views across every module, for the people who run the platform.
 *
 * It reads collections directly rather than importing each module's services,
 * for the same reason the notifier does: an admin view that goes through six
 * modules' services couples the back office to all of them, and every one of
 * these queries is an aggregate that no single module owns.
 *
 * Writes are the exception - photo moderation is here because it is a
 * moderator's action, not a member's.
 */
@Injectable()
export class AdminService {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  /** The dashboard. One round trip per figure, all of them counts or sums. */
  async metrics(): Promise<PlatformMetricsDto> {
    const users = this.conn.collection('users');
    const vendors = this.conn.collection('vendors');
    const profiles = this.conn.collection('matrimony_profiles');
    const bookings = this.conn.collection('bookings');

    const [
      totalUsers,
      customers,
      vendorUsers,
      seekers,
      totalVendors,
      verifiedVendors,
      awaitingKyc,
      totalProfiles,
      activeProfiles,
      interestsSent,
      totalBookings,
      confirmed,
      cancelled,
      gmvRow,
      escrow,
      commission,
      refunded,
    ] = await Promise.all([
      users.countDocuments({}),
      users.countDocuments({ roles: 'CUSTOMER' }),
      users.countDocuments({ roles: 'VENDOR_OWNER' }),
      users.countDocuments({ roles: 'SEEKER' }),
      vendors.countDocuments({}),
      vendors.countDocuments({ kycStatus: KycStatus.VERIFIED }),
      vendors.countDocuments({
        kycStatus: { $in: [KycStatus.SUBMITTED, KycStatus.IN_REVIEW] },
      }),
      profiles.countDocuments({}),
      profiles.countDocuments({ status: ProfileStatus.ACTIVE }),
      this.conn.collection('interests').countDocuments({}),
      bookings.countDocuments({}),
      bookings.countDocuments({
        status: {
          $in: [
            BookingStatus.CONFIRMED,
            BookingStatus.IN_PROGRESS,
            BookingStatus.COMPLETED,
          ],
        },
      }),
      bookings.countDocuments({ status: BookingStatus.CANCELLED }),
      bookings
        .aggregate([
          {
            $match: {
              status: {
                $in: [
                  BookingStatus.CONFIRMED,
                  BookingStatus.IN_PROGRESS,
                  BookingStatus.COMPLETED,
                ],
              },
            },
          },
          { $group: { _id: null, total: { $sum: '$totalAmount' } } },
        ])
        .toArray(),
      this.accountBalance(LedgerAccount.ESCROW),
      this.accountBalance(LedgerAccount.COMMISSION_INCOME),
      this.refundedToCustomers(),
    ]);

    return {
      users: {
        total: totalUsers,
        customers,
        vendors: vendorUsers,
        seekers,
      },
      vendors: {
        total: totalVendors,
        verified: verifiedVendors,
        awaitingKyc,
      },
      matrimony: {
        profiles: totalProfiles,
        active: activeProfiles,
        interestsSent,
      },
      bookings: { total: totalBookings, confirmed, cancelled },
      money: {
        gmv: ((gmvRow[0]?.['total'] as number) ?? 0) as Paisa,
        inEscrow: escrow,
        // Income accounts carry credit balances, so the sign is flipped for
        // display: "earned 10,000", not "-10,000".
        commissionEarned: Math.abs(commission) as Paisa,
        refunded,
      },
    };
  }

  /**
   * Photos waiting on a moderator.
   *
   * Nothing a member uploads is visible to anyone else until it passes through
   * here - which is why an unmoderated photo is filtered out of every read
   * rather than merely flagged.
   */
  async pendingPhotos(): Promise<PhotoModerationItemDto[]> {
    const rows = await this.conn
      .collection('matrimony_profiles')
      .find(
        { 'photos.moderation': 'PENDING' },
        { projection: { displayName: 1, photos: 1, updatedAt: 1 } },
      )
      .limit(100)
      .toArray();

    return rows.flatMap((profile) =>
      ((profile['photos'] as Record<string, unknown>[] | undefined) ?? [])
        .filter((photo) => photo['moderation'] === 'PENDING')
        .map((photo) => ({
          profileId: profile['_id']!.toString(),
          displayName: (profile['displayName'] as string) ?? 'Member',
          photoId: photo['id'] as string,
          url: photo['url'] as string,
          submittedAt:
            (profile['updatedAt'] as Date | undefined)?.toISOString() ??
            new Date().toISOString(),
        })),
    );
  }

  async decidePhoto(dto: ModerationDecisionDto): Promise<{ status: string }> {
    const result = await this.conn.collection('matrimony_profiles').updateOne(
      {
        _id: new Types.ObjectId(dto.profileId),
        'photos.id': dto.photoId,
      },
      {
        $set: {
          'photos.$.moderation': dto.decision,
          // A rejection without a reason leaves the member with nothing to fix.
          'photos.$.rejectionReason':
            dto.decision === 'REJECTED' ? (dto.reason ?? 'Does not meet the guidelines') : undefined,
        },
      },
    );

    if (result.matchedCount === 0) {
      return { status: 'NOT_FOUND' };
    }
    return { status: dto.decision };
  }

  /** Recent bookings, for support answering "what happened to my booking?". */
  async recentBookings(): Promise<Record<string, unknown>[]> {
    return this.conn
      .collection('bookings')
      .find({}, { projection: { statusHistory: 0 } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
  }

  private async accountBalance(account: LedgerAccount): Promise<Paisa> {
    const [row] = await this.conn
      .collection('ledger_entries')
      .aggregate([
        { $match: { account } },
        {
          $group: {
            _id: null,
            total: { $sum: { $subtract: ['$debit', '$credit'] } },
          },
        },
      ])
      .toArray();
    return (((row?.['total'] as number) ?? 0) as number) as Paisa;
  }

  /** Debits on the customer-refund clearing account: what actually went back. */
  private async refundedToCustomers(): Promise<Paisa> {
    const [row] = await this.conn
      .collection('ledger_entries')
      .aggregate([
        { $match: { account: LedgerAccount.CUSTOMER_REFUND } },
        { $group: { _id: null, total: { $sum: '$debit' } } },
      ])
      .toArray();
    return (((row?.['total'] as number) ?? 0) as number) as Paisa;
  }
}

@ApiTags('admin')
@Controller('admin')
@Roles('ADMIN', 'SUPPORT')
class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Platform counts and money, at a glance' })
  metrics() {
    return this.admin.metrics();
  }

  @Get('moderation/photos')
  @ApiOperation({ summary: 'Photos waiting on a moderator' })
  pendingPhotos() {
    return this.admin.pendingPhotos();
  }

  @Post('moderation/photos')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve or reject one photo' })
  decidePhoto(@Body() dto: ModerationDecisionDto) {
    return this.admin.decidePhoto(dto);
  }

  @Get('bookings')
  recentBookings() {
    return this.admin.recentBookings();
  }
}

@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
