import { Injectable } from '@nestjs/common';
import {
  KOOTA_MAX,
  MANGLIK_HOUSES,
  NAKSHATRAS,
  RASHIS,
  gunaVerdict,
  type GunaResult,
  type HoroscopeDetails,
  type KootaName,
  type KootaScore,
} from '@eventhub/contracts';

/**
 * Ashtakoota (36-guna) matching.
 *
 * The architecture is blunt about why this exists: a matrimony platform without
 * guna scoring and Mangal Dosha loses a large share of the Indian market
 * outright. Families will compare our number against their family astrologer's,
 * so the tables below follow the conventional readings rather than anything
 * invented here, and every koota returns its reasoning - a score with no
 * explanation is not trusted, and rightly so.
 *
 * Input is the moon nakshatra (1-27) and rashi (1-12) of each side. We store
 * those rather than deriving them from birth time: a family that has had a
 * kundli drawn up enters the values they already trust.
 */

/** Rashi (1-12) to varna. Water signs are Brahmin, and so on by element. */
const VARNA_BY_RASHI: readonly number[] = [
  // Mesha Vrishabha Mithuna Karka Simha Kanya
  2, 3, 4, 1, 2, 3,
  // Tula Vrishchika Dhanu Makara Kumbha Meena
  4, 1, 2, 3, 4, 1,
];
const VARNA_NAMES = ['', 'Brahmin', 'Kshatriya', 'Vaishya', 'Shudra'] as const;

/** Rashi to vashya group. */
const VASHYA_BY_RASHI: readonly string[] = [
  'Chatushpada', // Mesha
  'Chatushpada', // Vrishabha
  'Manava', // Mithuna
  'Jalachara', // Karka
  'Vanachara', // Simha
  'Manava', // Kanya
  'Manava', // Tula
  'Keeta', // Vrishchika
  'Manava', // Dhanu (first half manava)
  'Jalachara', // Makara
  'Manava', // Kumbha
  'Jalachara', // Meena
];

/** Vashya points, by [bride group][groom group]. */
const VASHYA_TABLE: Record<string, Record<string, number>> = {
  Chatushpada: { Chatushpada: 2, Manava: 1, Jalachara: 2, Vanachara: 0, Keeta: 1 },
  Manava: { Chatushpada: 0, Manava: 2, Jalachara: 1, Vanachara: 1, Keeta: 1 },
  Jalachara: { Chatushpada: 1, Manava: 1, Jalachara: 2, Vanachara: 0, Keeta: 1 },
  Vanachara: { Chatushpada: 1, Manava: 0, Jalachara: 1, Vanachara: 2, Keeta: 0 },
  Keeta: { Chatushpada: 1, Manava: 1, Jalachara: 1, Vanachara: 0, Keeta: 2 },
};

/** Nakshatra to yoni animal, and its sex. Opposing sexes of a pair clash. */
const YONI_BY_NAKSHATRA: readonly [string, 'M' | 'F'][] = [
  ['Horse', 'M'], ['Elephant', 'F'], ['Sheep', 'F'], ['Serpent', 'M'],
  ['Serpent', 'F'], ['Dog', 'F'], ['Cat', 'F'], ['Sheep', 'M'],
  ['Cat', 'M'], ['Rat', 'M'], ['Rat', 'F'], ['Cow', 'M'],
  ['Buffalo', 'F'], ['Tiger', 'F'], ['Buffalo', 'M'], ['Tiger', 'M'],
  ['Deer', 'F'], ['Deer', 'M'], ['Dog', 'M'], ['Monkey', 'M'],
  ['Mongoose', 'M'], ['Monkey', 'F'], ['Lion', 'F'], ['Horse', 'F'],
  ['Lion', 'M'], ['Cow', 'F'], ['Elephant', 'M'],
];

/** Enmity between yoni animals. Anything not listed is neutral. */
const YONI_ENEMIES: Record<string, string> = {
  Cow: 'Tiger',
  Tiger: 'Cow',
  Elephant: 'Lion',
  Lion: 'Elephant',
  Horse: 'Buffalo',
  Buffalo: 'Horse',
  Dog: 'Deer',
  Deer: 'Dog',
  Serpent: 'Mongoose',
  Mongoose: 'Serpent',
  Cat: 'Rat',
  Rat: 'Cat',
  Monkey: 'Sheep',
  Sheep: 'Monkey',
};

/** Rashi lords, 1-12. */
const LORD_BY_RASHI: readonly string[] = [
  'Mars', 'Venus', 'Mercury', 'Moon', 'Sun', 'Mercury',
  'Venus', 'Mars', 'Jupiter', 'Saturn', 'Saturn', 'Jupiter',
];

/** Planetary friendship, used for Graha Maitri. */
const FRIENDS: Record<string, string[]> = {
  Sun: ['Moon', 'Mars', 'Jupiter'],
  Moon: ['Sun', 'Mercury'],
  Mars: ['Sun', 'Moon', 'Jupiter'],
  Mercury: ['Sun', 'Venus'],
  Jupiter: ['Sun', 'Moon', 'Mars'],
  Venus: ['Mercury', 'Saturn'],
  Saturn: ['Mercury', 'Venus'],
};

const ENEMIES: Record<string, string[]> = {
  Sun: ['Venus', 'Saturn'],
  Moon: [],
  Mars: ['Mercury'],
  Mercury: ['Moon'],
  Jupiter: ['Mercury', 'Venus'],
  Venus: ['Sun', 'Moon'],
  Saturn: ['Sun', 'Moon', 'Mars'],
};

/** Nakshatra to gana. */
const GANA_BY_NAKSHATRA: readonly string[] = [
  'Deva', 'Manushya', 'Rakshasa', 'Manushya', 'Deva', 'Manushya',
  'Deva', 'Deva', 'Rakshasa', 'Rakshasa', 'Manushya', 'Manushya',
  'Deva', 'Rakshasa', 'Deva', 'Rakshasa', 'Deva', 'Rakshasa',
  'Rakshasa', 'Manushya', 'Manushya', 'Deva', 'Rakshasa', 'Rakshasa',
  'Manushya', 'Manushya', 'Deva',
];

/** Nadi by nakshatra: Adi, Madhya, Antya. Same nadi scores nothing. */
const NADI_BY_NAKSHATRA: readonly string[] = [
  'Adi', 'Madhya', 'Antya', 'Adi', 'Madhya', 'Antya',
  'Adi', 'Madhya', 'Antya', 'Antya', 'Madhya', 'Adi',
  'Antya', 'Madhya', 'Adi', 'Adi', 'Madhya', 'Antya',
  'Antya', 'Madhya', 'Adi', 'Antya', 'Madhya', 'Adi',
  'Adi', 'Madhya', 'Antya',
];

@Injectable()
export class GunaService {
  /**
   * Scores a pair. Returns null when either side has not entered both a
   * nakshatra and a rashi - showing a made-up number would be worse than
   * showing none, because families act on it.
   */
  score(
    bride: Pick<HoroscopeDetails, 'nakshatra' | 'rashi' | 'marsHouse' | 'manglik'>,
    groom: Pick<HoroscopeDetails, 'nakshatra' | 'rashi' | 'marsHouse' | 'manglik'>,
  ): GunaResult | null {
    if (!isComplete(bride) || !isComplete(groom)) return null;

    const b = { nakshatra: bride.nakshatra!, rashi: bride.rashi! };
    const g = { nakshatra: groom.nakshatra!, rashi: groom.rashi! };

    const kootas: KootaScore[] = [
      this.varna(b.rashi, g.rashi),
      this.vashya(b.rashi, g.rashi),
      this.tara(b.nakshatra, g.nakshatra),
      this.yoni(b.nakshatra, g.nakshatra),
      this.grahaMaitri(b.rashi, g.rashi),
      this.gana(b.nakshatra, g.nakshatra),
      this.bhakoot(b.rashi, g.rashi),
      this.nadi(b.nakshatra, g.nakshatra),
    ];

    const total = round(kootas.reduce((sum, k) => sum + k.points, 0));
    const brideManglik = this.isManglik(bride);
    const groomManglik = this.isManglik(groom);
    // The conventional reading: a dosha on both sides cancels out.
    const compatible = brideManglik === groomManglik;

    return {
      total,
      max: 36,
      kootas,
      mangalDosha: {
        brideManglik,
        groomManglik,
        compatible,
        note: compatible
          ? brideManglik
            ? 'Both are manglik, which is traditionally considered to cancel out.'
            : 'Neither side has Mangal Dosha.'
          : `Only the ${brideManglik ? 'bride' : 'groom'} is manglik. Families usually seek a remedy or an astrologer's view.`,
      },
      verdict: gunaVerdict(total),
    };
  }

  /** Mars in the 1st, 2nd, 4th, 7th, 8th or 12th house from the ascendant. */
  isManglik(
    horoscope: Pick<HoroscopeDetails, 'marsHouse' | 'manglik'>,
  ): boolean {
    if (horoscope.marsHouse) {
      return (MANGLIK_HOUSES as readonly number[]).includes(horoscope.marsHouse);
    }
    // Falls back to what the family entered when no chart position is known.
    return horoscope.manglik === true;
  }

  // ------------------------------------------------------------------ kootas

  /** Varna (1). Scores when the groom's varna is not below the bride's. */
  private varna(brideRashi: number, groomRashi: number): KootaScore {
    const bride = VARNA_BY_RASHI[brideRashi - 1]!;
    const groom = VARNA_BY_RASHI[groomRashi - 1]!;
    // Lower number is the higher varna, so the groom must be <= the bride.
    const points = groom <= bride ? 1 : 0;
    return koota(
      'Varna',
      points,
      `Bride ${VARNA_NAMES[bride]}, groom ${VARNA_NAMES[groom]}.`,
    );
  }

  /** Vashya (2). Mutual attraction and influence. */
  private vashya(brideRashi: number, groomRashi: number): KootaScore {
    const bride = VASHYA_BY_RASHI[brideRashi - 1]!;
    const groom = VASHYA_BY_RASHI[groomRashi - 1]!;
    const points = VASHYA_TABLE[bride]?.[groom] ?? 0;
    return koota('Vashya', points, `${bride} and ${groom} groups.`);
  }

  /** Tara (3). Birth-star compatibility, counted in both directions. */
  private tara(brideNakshatra: number, groomNakshatra: number): KootaScore {
    const forward = countTara(brideNakshatra, groomNakshatra);
    const backward = countTara(groomNakshatra, brideNakshatra);
    const points = (forward ? 1.5 : 0) + (backward ? 1.5 : 0);
    return koota(
      'Tara',
      points,
      points === 3
        ? 'Both birth-star counts are auspicious.'
        : points === 0
          ? 'Neither direction gives an auspicious count.'
          : 'One direction is auspicious, the other is not.',
    );
  }

  /** Yoni (4). Temperament, by the animal of each birth star. */
  private yoni(brideNakshatra: number, groomNakshatra: number): KootaScore {
    const [brideAnimal, brideSex] = YONI_BY_NAKSHATRA[brideNakshatra - 1]!;
    const [groomAnimal, groomSex] = YONI_BY_NAKSHATRA[groomNakshatra - 1]!;

    let points: number;
    let note: string;

    if (brideAnimal === groomAnimal) {
      points = brideSex === groomSex ? 3 : 4;
      note = `Both are ${brideAnimal}.`;
    } else if (YONI_ENEMIES[brideAnimal] === groomAnimal) {
      points = 0;
      note = `${brideAnimal} and ${groomAnimal} are opposed.`;
    } else {
      points = 2;
      note = `${brideAnimal} and ${groomAnimal} are neutral to each other.`;
    }

    return koota('Yoni', points, note);
  }

  /** Graha Maitri (5). Friendship between the two moon-sign lords. */
  private grahaMaitri(brideRashi: number, groomRashi: number): KootaScore {
    const bride = LORD_BY_RASHI[brideRashi - 1]!;
    const groom = LORD_BY_RASHI[groomRashi - 1]!;

    if (bride === groom) {
      return koota('Graha Maitri', 5, `Both signs are ruled by ${bride}.`);
    }

    const brideView = relation(bride, groom);
    const groomView = relation(groom, bride);
    const both = `${bride} and ${groom}`;

    if (brideView === 'friend' && groomView === 'friend') {
      return koota('Graha Maitri', 5, `${both} are mutual friends.`);
    }
    if (brideView === 'enemy' && groomView === 'enemy') {
      return koota('Graha Maitri', 0, `${both} are mutual enemies.`);
    }
    if (brideView === 'friend' || groomView === 'friend') {
      return koota(
        'Graha Maitri',
        brideView === 'neutral' || groomView === 'neutral' ? 4 : 1,
        `${both} are partly friendly.`,
      );
    }
    if (brideView === 'neutral' && groomView === 'neutral') {
      return koota('Graha Maitri', 3, `${both} are neutral.`);
    }
    return koota('Graha Maitri', 0.5, `${both} are largely unfriendly.`);
  }

  /** Gana (6). Nature: divine, human or demonic. */
  private gana(brideNakshatra: number, groomNakshatra: number): KootaScore {
    const bride = GANA_BY_NAKSHATRA[brideNakshatra - 1]!;
    const groom = GANA_BY_NAKSHATRA[groomNakshatra - 1]!;

    if (bride === groom) return koota('Gana', 6, `Both are ${bride} gana.`);

    const pair = `${bride} and ${groom}`;
    if (
      (bride === 'Deva' && groom === 'Manushya') ||
      (bride === 'Manushya' && groom === 'Deva')
    ) {
      return koota('Gana', 5, `${pair} go together well enough.`);
    }
    if (bride === 'Deva' && groom === 'Rakshasa') {
      return koota('Gana', 1, `${pair} are poorly matched.`);
    }
    if (bride === 'Rakshasa' && groom === 'Deva') {
      return koota('Gana', 0, `${pair} are considered incompatible.`);
    }
    // Manushya with Rakshasa, either way round.
    return koota('Gana', 0, `${pair} are considered incompatible.`);
  }

  /** Bhakoot (7). The distance between the two moon signs. */
  private bhakoot(brideRashi: number, groomRashi: number): KootaScore {
    const forward = distance(brideRashi, groomRashi);
    const backward = distance(groomRashi, brideRashi);
    const pair = [forward, backward].sort((a, b) => a - b).join('/');

    // 6/8, 5/9 and 2/12 are the afflicted distances.
    const afflicted = ['6/8', '5/9', '2/12'];
    return afflicted.includes(pair)
      ? koota('Bhakoot', 0, `The signs are ${pair} apart, which is afflicted.`)
      : koota('Bhakoot', 7, `The signs are ${pair} apart, which is fine.`);
  }

  /** Nadi (8). The heaviest koota; the same nadi scores nothing at all. */
  private nadi(brideNakshatra: number, groomNakshatra: number): KootaScore {
    const bride = NADI_BY_NAKSHATRA[brideNakshatra - 1]!;
    const groom = NADI_BY_NAKSHATRA[groomNakshatra - 1]!;

    return bride === groom
      ? koota(
          'Nadi',
          0,
          `Both are ${bride} nadi. This is the most serious mismatch in the system.`,
        )
      : koota('Nadi', 8, `${bride} and ${groom} nadi differ, which is what is wanted.`);
  }

  /** Human-readable names, for the UI and for tests. */
  nakshatraName(index: number): string {
    return NAKSHATRAS[index - 1] ?? 'Unknown';
  }

  rashiName(index: number): string {
    return RASHIS[index - 1] ?? 'Unknown';
  }
}

function isComplete(
  h: Pick<HoroscopeDetails, 'nakshatra' | 'rashi'>,
): boolean {
  return (
    typeof h.nakshatra === 'number' &&
    h.nakshatra >= 1 &&
    h.nakshatra <= 27 &&
    typeof h.rashi === 'number' &&
    h.rashi >= 1 &&
    h.rashi <= 12
  );
}

function koota(name: KootaName, points: number, note: string): KootaScore {
  return { koota: name, points, max: KOOTA_MAX[name], note };
}

/** Counts from `from` to `to` inclusive, then takes the remainder over 9. */
function countTara(from: number, to: number): boolean {
  const count = ((to - from + 27) % 27) + 1;
  const remainder = count % 9;
  // 3rd, 5th and 7th taras are the inauspicious ones.
  return ![3, 5, 7].includes(remainder);
}

/** 1-based distance from one rashi to another, going forwards. */
function distance(from: number, to: number): number {
  return ((to - from + 12) % 12) + 1;
}

function relation(of: string, towards: string): 'friend' | 'enemy' | 'neutral' {
  if (FRIENDS[of]?.includes(towards)) return 'friend';
  if (ENEMIES[of]?.includes(towards)) return 'enemy';
  return 'neutral';
}

/** Halves are real in this system (Tara, Graha Maitri), quarters are not. */
function round(value: number): number {
  return Math.round(value * 2) / 2;
}
