import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { ClientSession, Model } from 'mongoose';
import {
  LedgerAccount,
  type LedgerEntryDto,
  type Paisa,
  type PaymentSplit,
} from '@eventhub/contracts';

import {
  LedgerEntry,
  type LedgerEntryDocument,
} from '../schemas/ledger-entry.schema.js';

interface PostContext {
  paymentId: Types.ObjectId;
  /** Absent for subscription revenue, which belongs to no booking. */
  bookingId?: Types.ObjectId;
  vendorId?: Types.ObjectId;
  session?: ClientSession;
}

interface LedgerLine {
  account: LedgerAccount;
  debit: Paisa;
  credit: Paisa;
  description: string;
}

const ZERO = 0 as Paisa;

/**
 * The only writer of ledger entries.
 *
 * Every posting is balanced before it is written - if the debits and credits of
 * a group disagree the write is refused rather than persisted, because a ledger
 * that does not balance cannot be reconciled afterwards. Postings are made
 * inside the caller's transaction, so a capture and its accounting commit
 * together or not at all.
 */
@Injectable()
export class LedgerService {
  constructor(
    @InjectModel(LedgerEntry.name)
    private readonly entries: Model<LedgerEntryDocument>,
  ) {}

  /**
   * Records a captured payment: money arrives in escrow and is owed onward in
   * three directions.
   */
  async postCapture(split: PaymentSplit, ctx: PostContext): Promise<void> {
    await this.post(`capture:${ctx.paymentId.toString()}`, 'payment', ctx, [
      {
        account: LedgerAccount.ESCROW,
        debit: split.gross,
        credit: ZERO,
        description: 'Payment captured into escrow',
      },
      {
        account: LedgerAccount.COMMISSION_INCOME,
        debit: ZERO,
        credit: split.commission,
        description: 'Platform commission earned',
      },
      {
        account: LedgerAccount.TDS_PAYABLE,
        debit: ZERO,
        credit: split.tds,
        description: 'TDS withheld under section 194-O',
      },
      {
        account: LedgerAccount.VENDOR_PAYABLE,
        debit: ZERO,
        credit: split.vendorNet,
        description: 'Net amount owed to vendor',
      },
    ]);
  }

  /**
   * Records a refund, as two balanced groups.
   *
   * The cash group says money left escrow and went back to a customer. The
   * reversal group says what funded it: the commission, the withheld tax and
   * the vendor's payable are each clawed back in the proportion they were
   * credited in at capture.
   *
   * CUSTOMER_REFUND is the clearing account between the two, so its net
   * balance returns to zero - what makes it useful is the sum of its debits,
   * which is exactly what has been paid back to customers, and which an escrow
   * balance alone could not distinguish from a vendor payout.
   */
  async postRefund(
    refundId: string,
    split: PaymentSplit,
    ctx: PostContext,
  ): Promise<void> {
    await this.post(`refund:${refundId}:cash`, 'refund', ctx, [
      {
        account: LedgerAccount.CUSTOMER_REFUND,
        debit: split.gross,
        credit: ZERO,
        description: 'Refunded to customer',
      },
      {
        account: LedgerAccount.ESCROW,
        debit: ZERO,
        credit: split.gross,
        description: 'Escrow released for refund',
      },
    ]);

    await this.post(`refund:${refundId}:reversal`, 'refund', ctx, [
      {
        account: LedgerAccount.COMMISSION_INCOME,
        debit: split.commission,
        credit: ZERO,
        description: 'Commission reversed on refund',
      },
      {
        account: LedgerAccount.TDS_PAYABLE,
        debit: split.tds,
        credit: ZERO,
        description: 'TDS reversed on refund',
      },
      {
        account: LedgerAccount.VENDOR_PAYABLE,
        debit: split.vendorNet,
        credit: ZERO,
        description: 'Vendor payable reduced by refund',
      },
      {
        account: LedgerAccount.CUSTOMER_REFUND,
        debit: ZERO,
        credit: split.gross,
        description: 'Refund funded by reversing the original split',
      },
    ]);
  }

  /** What has actually been paid back to customers, in paisa. */
  async refundedToCustomers(): Promise<Paisa> {
    const [row] = await this.entries.aggregate<{ total: number }>([
      { $match: { account: LedgerAccount.CUSTOMER_REFUND } },
      { $group: { _id: null, total: { $sum: '$debit' } } },
    ]);
    return (row?.total ?? 0) as Paisa;
  }

  /**
   * Records a subscription sale.
   *
   * Deliberately nowhere near escrow: escrow is money held on behalf of a
   * vendor, and this is money the platform has earned and keeps. Posting them
   * to the same account would make the escrow balance impossible to reconcile
   * against gateway settlements, because it would include money nobody is owed.
   *
   * The GST is split out because it is not revenue - it is collected on behalf
   * of the government and paid onward.
   */
  async postSubscription(
    net: Paisa,
    gst: Paisa,
    ctx: PostContext & { planCode: string },
  ): Promise<void> {
    await this.post(`subscription:${ctx.paymentId.toString()}`, 'subscription', ctx, [
      {
        account: LedgerAccount.PLATFORM_CASH,
        debit: (net + gst) as Paisa,
        credit: ZERO,
        description: `Subscription payment received (${ctx.planCode})`,
      },
      {
        account: LedgerAccount.SUBSCRIPTION_INCOME,
        debit: ZERO,
        credit: net,
        description: 'Subscription revenue',
      },
      {
        account: LedgerAccount.GST_PAYABLE,
        debit: ZERO,
        credit: gst,
        description: 'GST collected on a subscription',
      },
    ]);
  }

  /** Sums an account. Reconciliation reads this; nothing writes through it. */
  async balance(account: LedgerAccount): Promise<Paisa> {
    const [row] = await this.entries.aggregate<{ total: number }>([
      { $match: { account } },
      {
        $group: {
          _id: null,
          total: { $sum: { $subtract: ['$debit', '$credit'] } },
        },
      },
    ]);
    return (row?.total ?? 0) as Paisa;
  }

  async forBooking(bookingId: string): Promise<LedgerEntryDto[]> {
    const rows = await this.entries
      .find({ bookingId: new Types.ObjectId(bookingId) })
      .sort({ createdAt: 1 });
    return rows.map((r) => this.toDto(r));
  }

  private async post(
    groupId: string,
    refType: string,
    ctx: PostContext,
    lines: LedgerLine[],
  ): Promise<void> {
    const debits = lines.reduce((n, l) => n + l.debit, 0);
    const credits = lines.reduce((n, l) => n + l.credit, 0);

    // A refusal here means the split arithmetic has a bug. Failing loudly is
    // the point - the alternative is a books discrepancy discovered at audit.
    if (debits !== credits) {
      throw new Error(
        `Refusing to post unbalanced ledger group ${groupId}: ${debits} != ${credits}`,
      );
    }

    await this.entries.create(
      lines.map((line) => ({
        ...line,
        refType,
        refId: ctx.paymentId,
        bookingId: ctx.bookingId,
        vendorId: ctx.vendorId,
        groupId,
      })),
      { session: ctx.session, ordered: true },
    );
  }

  private toDto(entry: LedgerEntryDocument): LedgerEntryDto {
    return {
      id: entry.id as string,
      account: entry.account,
      debit: entry.debit as Paisa,
      credit: entry.credit as Paisa,
      refType: entry.refType,
      refId: entry.refId.toString(),
      description: entry.description,
      createdAt: (entry as unknown as { createdAt: Date }).createdAt.toISOString(),
    };
  }
}
