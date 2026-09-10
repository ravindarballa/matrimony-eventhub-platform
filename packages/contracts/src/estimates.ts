import type { Paisa } from './common.js';
import { PricingModel } from './enums.js';

/**
 * What a package is likely to cost for a given wedding, and whether it fits.
 *
 * A price list is not an answer. "From ₹1,200" on a caterer means one thing at
 * 200 guests and quite another at 600, and a family comparing five vendors is
 * doing that multiplication in their heads five times and getting it wrong. The
 * arithmetic is the same everywhere it is shown, so it lives here.
 *
 * These are estimates and must be labelled as such wherever they appear. The
 * binding number is the quote the vendor sends; this only decides which vendors
 * are worth asking.
 */

export interface CostEstimate {
  /** Null when the model cannot be priced without information we do not have. */
  total: Paisa | null;
  /** How the number was reached, for a tooltip: '₹1,200 × 500 plates'. */
  basis: string;
  /** True when the shape of the price depends on something not asked for yet. */
  indicative: boolean;
}

export interface EstimateInput {
  pricingModel: PricingModel;
  basePrice: Paisa;
  minimumUnits?: number | null;
  guestCount: number;
}

const inr = (paisa: number): string =>
  '₹' + Math.round(paisa / 100).toLocaleString('en-IN');

/**
 * The likely cost of one package for this many guests.
 *
 * Per-plate scales with the guest count and respects the vendor's minimum
 * billing, which is the number families are caught out by. Per-day and
 * per-package are flat. Per-hour cannot be totalled without knowing how many
 * hours, so it says so rather than inventing a number.
 */
export function estimateCost(input: EstimateInput): CostEstimate {
  const { pricingModel, basePrice, guestCount } = input;

  switch (pricingModel) {
    case PricingModel.PER_PLATE: {
      const billable = Math.max(guestCount, input.minimumUnits ?? 0);
      const belowMinimum = billable > guestCount;
      return {
        total: (basePrice * billable) as Paisa,
        basis: belowMinimum
          ? `${inr(basePrice)} × ${billable} plates (their minimum, above your ${guestCount})`
          : `${inr(basePrice)} × ${guestCount} plates`,
        indicative: false,
      };
    }
    case PricingModel.PER_DAY:
      return { total: basePrice, basis: `${inr(basePrice)} for the day`, indicative: false };
    case PricingModel.PER_PACKAGE:
      return { total: basePrice, basis: `${inr(basePrice)} for the package`, indicative: false };
    case PricingModel.PER_HOUR:
      return {
        total: null,
        basis: `${inr(basePrice)} per hour — depends on how long you need them`,
        indicative: true,
      };
    default:
      return { total: basePrice, basis: inr(basePrice), indicative: true };
  }
}

/** How a vendor's cheapest workable package sits against a budget. */
export type BudgetFit = 'WITHIN' | 'TIGHT' | 'OVER' | 'UNKNOWN';

/**
 * Within, tight or over.
 *
 * 'Tight' exists because a vendor at 95% of the budget is not the same news as
 * one at 40%, and hiding that until the quote arrives wastes everyone's time.
 * The band is deliberately wide: these are estimates, and a false 'over' costs
 * a family a vendor they could have afforded.
 */
export function budgetFit(total: Paisa | null, budget: Paisa | null): BudgetFit {
  if (total === null || budget === null || budget <= 0) return 'UNKNOWN';
  if (total > budget) return 'OVER';
  if (total > budget * 0.85) return 'TIGHT';
  return 'WITHIN';
}

/** Whether a venue can seat the wedding. Null capacity means it is not a venue. */
export function seatsEveryone(
  capacity: number | null | undefined,
  guestCount: number,
): boolean | null {
  if (capacity == null || capacity <= 0) return null;
  return capacity >= guestCount;
}
