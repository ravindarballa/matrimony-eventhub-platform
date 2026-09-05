import { Injectable } from '@nestjs/common';
import {
  COMMISSION_BPS,
  TDS_BPS,
  type CommissionBreakdown,
  type Paisa,
  type PaymentSplit,
  type VendorCategory,
} from '@eventhub/contracts';

/**
 * How a captured payment divides between the platform, the tax authority and
 * the vendor.
 *
 * Basis points, not percentages, and integer paisa throughout - 1200 bps of
 * Rs 1,00,000 is exactly Rs 12,000, with no float anywhere near it. The vendor
 * share is derived by subtraction rather than computed independently, so the
 * three parts sum to the gross exactly however the two rounded shares landed.
 * No paisa is created or destroyed.
 */
@Injectable()
export class CommissionService {
  /**
   * `commissionBps` is the rate snapshotted on the booking, not today's config
   * value: a deal struck at 8% stays at 8% even if the category rate changes.
   */
  split(gross: Paisa, commissionBps: number): PaymentSplit {
    const commission = Math.round((gross * commissionBps) / 10_000) as Paisa;
    // TDS under section 194-O is withheld on the gross sale value, not on the
    // net after commission.
    const tds = Math.round((gross * TDS_BPS) / 10_000) as Paisa;
    const vendorNet = (gross - commission - tds) as Paisa;

    return { gross, commission, tds, vendorNet };
  }

  /** The rates that would apply to a new booking in this category. */
  breakdownFor(category: VendorCategory): CommissionBreakdown {
    return {
      category,
      commissionBps: COMMISSION_BPS[category],
      tdsBps: TDS_BPS,
    };
  }

  /**
   * A refund reverses the same proportions the capture was split into, so the
   * platform gives back commission on money the customer did not spend.
   */
  reverse(refunded: Paisa, commissionBps: number): PaymentSplit {
    return this.split(refunded, commissionBps);
  }
}
