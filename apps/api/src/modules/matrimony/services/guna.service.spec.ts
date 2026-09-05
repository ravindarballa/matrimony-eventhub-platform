import { KOOTA_MAX, type KootaName } from '@eventhub/contracts';

import { GunaService } from './guna.service.js';

describe('GunaService', () => {
  const guna = new GunaService();

  /** Rohini / Vrishabha and Hasta / Kanya - a conventional pairing. */
  const bride = { nakshatra: 4, rashi: 2 };
  const groom = { nakshatra: 13, rashi: 6 };

  it('returns null unless both sides have a nakshatra and a rashi', () => {
    expect(guna.score({ nakshatra: 4 }, groom)).toBeNull();
    expect(guna.score({ rashi: 2 }, groom)).toBeNull();
    expect(guna.score(bride, {})).toBeNull();
    expect(guna.score(bride, groom)).not.toBeNull();
  });

  it('scores all eight kootas, each within its own maximum', () => {
    const result = guna.score(bride, groom)!;

    expect(result.kootas).toHaveLength(8);
    for (const koota of result.kootas) {
      expect(koota.max).toBe(KOOTA_MAX[koota.koota as KootaName]);
      expect(koota.points).toBeGreaterThanOrEqual(0);
      expect(koota.points).toBeLessThanOrEqual(koota.max);
      // A score without a reason is not something a family will trust.
      expect(koota.note.length).toBeGreaterThan(10);
    }
  });

  it('totals the kootas and never exceeds 36', () => {
    const result = guna.score(bride, groom)!;
    const summed = result.kootas.reduce((n, k) => n + k.points, 0);

    expect(result.total).toBe(summed);
    expect(result.total).toBeLessThanOrEqual(36);
    expect(result.max).toBe(36);
  });

  /**
   * The kootas are only worth 36 together if the table is right, so this walks
   * every nakshatra and rashi combination looking for one that breaks the cap.
   */
  it('holds the 36-point cap across every combination', () => {
    for (let bn = 1; bn <= 27; bn += 1) {
      for (let br = 1; br <= 12; br += 1) {
        const result = guna.score({ nakshatra: bn, rashi: br }, groom)!;
        expect(result.total).toBeGreaterThanOrEqual(0);
        expect(result.total).toBeLessThanOrEqual(36);
      }
    }
  });

  it('scores a perfect self-match highly but not blindly', () => {
    // The same star and sign shares a nadi, which scores nothing at all - the
    // heaviest koota in the system deliberately punishes sameness.
    const result = guna.score(bride, bride)!;
    const nadi = result.kootas.find((k) => k.koota === 'Nadi')!;

    expect(nadi.points).toBe(0);
    expect(result.total).toBeLessThan(36);
  });

  it('gives no Nadi points when both are the same nadi', () => {
    // Ashwini (Adi) against Rohini (Adi).
    const result = guna.score({ nakshatra: 1, rashi: 1 }, { nakshatra: 4, rashi: 2 })!;
    expect(result.kootas.find((k) => k.koota === 'Nadi')!.points).toBe(0);
  });

  it('gives full Nadi points when the nadis differ', () => {
    // Ashwini (Adi) against Bharani (Madhya).
    const result = guna.score({ nakshatra: 1, rashi: 1 }, { nakshatra: 2, rashi: 1 })!;
    expect(result.kootas.find((k) => k.koota === 'Nadi')!.points).toBe(8);
  });

  it('zeroes Bhakoot for the afflicted 6/8 distance', () => {
    // Mesha (1) and Kanya (6) are 6 and 8 apart.
    const result = guna.score({ nakshatra: 1, rashi: 1 }, { nakshatra: 13, rashi: 6 })!;
    expect(result.kootas.find((k) => k.koota === 'Bhakoot')!.points).toBe(0);
  });

  it('awards full Graha Maitri when both signs share a lord', () => {
    // Mithuna and Kanya are both ruled by Mercury.
    const result = guna.score({ nakshatra: 5, rashi: 3 }, { nakshatra: 13, rashi: 6 })!;
    const maitri = result.kootas.find((k) => k.koota === 'Graha Maitri')!;
    expect(maitri.points).toBe(5);
    expect(maitri.note).toContain('Mercury');
  });

  describe('Mangal Dosha', () => {
    it('reads Mars in the 7th house as manglik', () => {
      expect(guna.isManglik({ marsHouse: 7 })).toBe(true);
    });

    it('reads Mars in the 5th house as not manglik', () => {
      expect(guna.isManglik({ marsHouse: 5 })).toBe(false);
    });

    it('falls back to what the family declared when no house is known', () => {
      expect(guna.isManglik({ manglik: true })).toBe(true);
      expect(guna.isManglik({})).toBe(false);
    });

    it('treats both-manglik as compatible, and one-sided as not', () => {
      const both = guna.score(
        { ...bride, marsHouse: 7 },
        { ...groom, marsHouse: 8 },
      )!;
      expect(both.mangalDosha.compatible).toBe(true);

      const oneSided = guna.score(
        { ...bride, marsHouse: 7 },
        { ...groom, marsHouse: 5 },
      )!;
      expect(oneSided.mangalDosha.compatible).toBe(false);
      expect(oneSided.mangalDosha.note).toContain('bride');
    });
  });

  it('maps a total to the conventional verdict', () => {
    const verdicts = new Set<string>();
    for (let bn = 1; bn <= 27; bn += 1) {
      const result = guna.score({ nakshatra: bn, rashi: 2 }, groom)!;
      verdicts.add(result.verdict);

      if (result.total >= 28) expect(result.verdict).toBe('EXCELLENT');
      else if (result.total >= 21) expect(result.verdict).toBe('GOOD');
      else if (result.total >= 18) expect(result.verdict).toBe('ACCEPTABLE');
      else expect(result.verdict).toBe('POOR');
    }
    // The tables are varied enough to produce more than one verdict.
    expect(verdicts.size).toBeGreaterThan(1);
  });

  it('names the stars and signs it scored', () => {
    expect(guna.nakshatraName(4)).toBe('Rohini');
    expect(guna.rashiName(2)).toBe('Vrishabha');
  });
});
