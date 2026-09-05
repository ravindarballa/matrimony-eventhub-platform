import { COMMISSION_BPS, TDS_BPS, type Paisa } from '@eventhub/contracts';

import { CommissionService } from './commission.service.js';

describe('CommissionService', () => {
  const service = new CommissionService();
  const paisa = (n: number): Paisa => n as Paisa;

  it('splits a round amount exactly as the rates say', () => {
    // Rs 1,00,000 at the PHOTOGRAPHY rate of 12%, TDS 1%.
    const split = service.split(paisa(100_000_00), COMMISSION_BPS.PHOTOGRAPHY);

    expect(split.commission).toBe(12_000_00);
    expect(split.tds).toBe(1_000_00);
    expect(split.vendorNet).toBe(87_000_00);
  });

  it('uses the snapshotted rate, not the current category rate', () => {
    // A deal struck at 8% stays at 8% even though MAKEUP is 15% today.
    const split = service.split(paisa(100_000_00), 800);
    expect(split.commission).toBe(8_000_00);
    expect(split.commission).not.toBe(
      Math.round((100_000_00 * COMMISSION_BPS.MAKEUP) / 10_000),
    );
  });

  /**
   * The invariant the whole module rests on. If the three parts ever fail to
   * sum to the gross, the ledger cannot balance and reconciliation against the
   * gateway's settlement report will not tie out.
   */
  it('never creates or loses a paisa, at any amount or rate', () => {
    const rates = [...Object.values(COMMISSION_BPS), 833, 1_234];
    const amounts = [1, 3, 7, 99, 333_33, 1_00_000, 333_333, 999_999_99, 12_345_678];

    for (const gross of amounts) {
      for (const bps of rates) {
        const s = service.split(paisa(gross), bps);
        expect(s.commission + s.tds + s.vendorNet).toBe(gross);
        expect(Number.isInteger(s.vendorNet)).toBe(true);
        expect(s.vendorNet).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('withholds TDS on the gross, not on the net of commission', () => {
    const gross = paisa(50_000_00);
    const split = service.split(gross, 1_200);
    expect(split.tds).toBe(Math.round((gross * TDS_BPS) / 10_000));
  });

  it('reverses a refund in the same proportions it was captured in', () => {
    const captured = service.split(paisa(100_000_00), 1_000);
    const reversed = service.reverse(paisa(50_000_00), 1_000);

    // Half the money back means half the commission given back.
    expect(reversed.commission * 2).toBe(captured.commission);
    expect(reversed.gross + reversed.gross).toBe(captured.gross);
  });

  it('reports the rates that would apply to a new booking', () => {
    expect(service.breakdownFor('VENUE')).toEqual({
      category: 'VENUE',
      commissionBps: 800,
      tdsBps: TDS_BPS,
    });
  });
});
