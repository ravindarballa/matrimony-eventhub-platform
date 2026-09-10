import type { Paisa } from './common.js';
import type { InterestStatus, PhotoPrivacy, ProfileStatus } from './enums.js';

/** Who is actually operating the account. It changes the tone of every message. */
export const ProfileManagedBy = {
  SELF: 'SELF',
  PARENT: 'PARENT',
  SIBLING: 'SIBLING',
  RELATIVE: 'RELATIVE',
} as const;
export type ProfileManagedBy =
  (typeof ProfileManagedBy)[keyof typeof ProfileManagedBy];

export const MaritalStatus = {
  NEVER_MARRIED: 'NEVER_MARRIED',
  DIVORCED: 'DIVORCED',
  WIDOWED: 'WIDOWED',
  AWAITING_DIVORCE: 'AWAITING_DIVORCE',
} as const;
export type MaritalStatus = (typeof MaritalStatus)[keyof typeof MaritalStatus];

export const Diet = {
  VEGETARIAN: 'VEGETARIAN',
  NON_VEGETARIAN: 'NON_VEGETARIAN',
  EGGETARIAN: 'EGGETARIAN',
  VEGAN: 'VEGAN',
  JAIN: 'JAIN',
} as const;
export type Diet = (typeof Diet)[keyof typeof Diet];

export const Gender = { MALE: 'MALE', FEMALE: 'FEMALE' } as const;
export type Gender = (typeof Gender)[keyof typeof Gender];

export interface EducationDetails {
  highestQualification: string;
  fieldOfStudy?: string | null;
  institution?: string | null;
}

export interface CareerDetails {
  occupation: string;
  employer?: string | null;
  /** Integer paisa per year. Shown as a band, never as an exact figure. */
  annualIncome?: Paisa | null;
}

/**
 * How well off the family is, in the words Indian matrimony sites use.
 *
 * Distinct from familyType, which is only whether the household is joint or
 * nuclear. Families ask both, and answering one does not answer the other.
 */
export const FamilyStatus = {
  MIDDLE_CLASS: 'MIDDLE_CLASS',
  UPPER_MIDDLE_CLASS: 'UPPER_MIDDLE_CLASS',
  AFFLUENT: 'AFFLUENT',
} as const;
export type FamilyStatus = (typeof FamilyStatus)[keyof typeof FamilyStatus];

export interface FamilyDetails {
  fatherOccupation?: string | null;
  motherOccupation?: string | null;
  /**
   * Counted separately rather than as one sibling total. Families ask how many
   * brothers and how many sisters, and how many of each are already married -
   * a single number answers none of that.
   */
  brothers?: number | null;
  sisters?: number | null;
  familyType?: 'JOINT' | 'NUCLEAR' | null;
  familyStatus?: FamilyStatus | null;
  nativePlace?: string | null;
}

/** How often, for the habits families ask about directly. */
export const HabitFrequency = {
  NEVER: 'NEVER',
  OCCASIONALLY: 'OCCASIONALLY',
  REGULARLY: 'REGULARLY',
} as const;
export type HabitFrequency = (typeof HabitFrequency)[keyof typeof HabitFrequency];

/**
 * Habits, kept apart from diet.
 *
 * Diet is on the profile itself because it is a hard filter for many families;
 * these two are asked about but rarely filtered on, so they live together here
 * and are optional throughout.
 */
export interface LifestyleDetails {
  smoking?: HabitFrequency | null;
  drinking?: HabitFrequency | null;
}

/**
 * Birth details, and the two derived values every guna calculation needs.
 *
 * `nakshatra` (1-27) and `rashi` (1-12) are stored rather than recomputed from
 * the birth time on every comparison: they are the input to Ashtakoota, and a
 * family that has had a kundli drawn up will want to enter them directly rather
 * than trust our ephemeris.
 */
export interface HoroscopeDetails {
  birthTime?: string | null;
  birthPlace?: string | null;
  /** 1-27, Ashwini through Revati. */
  nakshatra?: number | null;
  /** 1-12, Mesha through Meena. */
  rashi?: number | null;
  /** House position of Mars from the ascendant, 1-12. Drives Mangal Dosha. */
  marsHouse?: number | null;
  manglik?: boolean | null;
}

export interface ProfilePhoto {
  id: string;
  url: string;
  isPrimary: boolean;
  /** Photos are moderated before anyone but the owner can see them. */
  moderation: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string | null;
}

export interface ProfilePrivacy {
  photos: PhotoPrivacy;
  /** Contact details unlock only on mutual interest. This is the paywall. */
  showContact: 'ON_MUTUAL_INTEREST' | 'MEMBERS_ONLY';
}

export interface MatrimonyProfileDto {
  id: string;
  userId: string;
  displayName: string;
  managedBy: ProfileManagedBy;
  gender: Gender;
  dateOfBirth: string;
  age: number;
  heightCm: number;
  maritalStatus: MaritalStatus;
  religion: string;
  community: string;
  gotra?: string | null;
  motherTongue: string;
  city: string;
  state?: string | null;
  diet: Diet;
  about?: string | null;
  education: EducationDetails;
  career: CareerDetails;
  family: FamilyDetails;
  lifestyle: LifestyleDetails;
  horoscope: HoroscopeDetails;
  /** Free text, one per entry: 'Carnatic music', 'Trekking'. */
  hobbies: string[];
  /**
   * Named personalInterests, not interests. On this platform an Interest is
   * already a proposal one member sends another, and two meanings for that word
   * in one profile would be a bug waiting to be written.
   */
  personalInterests: string[];
  photos: ProfilePhoto[];
  privacy: ProfilePrivacy;
  status: ProfileStatus;
  /** 0-100. Drives the nudges, and search ranking. */
  completeness: number;
  verified: boolean;
  updatedAt: string;
}

/**
 * What another member is allowed to see.
 *
 * Contact details and unblurred photos are absent rather than masked, so a
 * client bug cannot reveal them - a field that is not on the wire cannot leak.
 */
export interface ProfileCardDto {
  id: string;
  displayName: string;
  age: number;
  heightCm: number;
  religion: string;
  community: string;
  city: string;
  education: string;
  occupation: string;
  /** Null when the viewer has not earned the right to see the photo. */
  photoUrl?: string | null;
  photosBlurred: boolean;
  /** 0-36, present only when both horoscopes carry a nakshatra and rashi. */
  gunaScore?: number | null;
  /** The viewer's interest state toward this profile, if any. */
  interestStatus?: InterestStatus | null;
  shortlisted: boolean;
}

export interface ProfileDetailDto extends ProfileCardDto {
  managedBy: ProfileManagedBy;
  maritalStatus: MaritalStatus;
  motherTongue: string;
  gotra?: string | null;
  diet: Diet;
  about?: string | null;
  educationDetails: EducationDetails;
  career: Omit<CareerDetails, 'annualIncome'> & { incomeBand?: string | null };
  family: FamilyDetails;
  lifestyle: LifestyleDetails;
  hobbies: string[];
  personalInterests: string[];
  horoscope: Omit<HoroscopeDetails, 'birthTime' | 'birthPlace'>;
  photos: { id: string; url: string | null; isPrimary: boolean }[];
  /** Present only when the viewer has earned it: mutual interest AND a plan. */
  contact?: { mobile: string; managedBy: ProfileManagedBy } | null;
  /**
   * Why the number is not here, so the client can say something useful instead
   * of showing an empty space. Null when the contact is present.
   */
  contactLock?: 'MUTUAL_REQUIRED' | 'PLAN_REQUIRED' | null;
  compatibility?: GunaResult | null;
}

export interface UpsertProfileRequest {
  displayName: string;
  managedBy: ProfileManagedBy;
  gender: Gender;
  dateOfBirth: string;
  heightCm: number;
  maritalStatus: MaritalStatus;
  religion: string;
  community: string;
  gotra?: string;
  motherTongue: string;
  city: string;
  state?: string;
  diet: Diet;
  about?: string;
  education?: Partial<EducationDetails>;
  career?: Partial<CareerDetails>;
  family?: Partial<FamilyDetails>;
  lifestyle?: Partial<LifestyleDetails>;
  horoscope?: Partial<HoroscopeDetails>;
  hobbies?: string[];
  personalInterests?: string[];
  privacy?: Partial<ProfilePrivacy>;
}

export interface PartnerPreferencesDto {
  profileId: string;
  ageMin: number;
  ageMax: number;
  heightMinCm?: number | null;
  heightMaxCm?: number | null;
  communities: string[];
  cities: string[];
  education: string[];
  diet?: Diet | null;
  maritalStatuses: MaritalStatus[];
  /** Families exclude their own gotra. Never a suggestion - a hard filter. */
  excludeGotras: string[];
}

export interface ProfileSearchQuery {
  ageMin?: number;
  ageMax?: number;
  heightMinCm?: number;
  heightMaxCm?: number;
  religion?: string;
  community?: string;
  city?: string;
  motherTongue?: string;
  diet?: Diet;
  maritalStatus?: MaritalStatus;
  /** Gotras the family cannot consider. */
  excludeGotras?: string[];
  /** Only profiles that clear this guna score. Requires the viewer's horoscope. */
  minGunaScore?: number;
  sort?: 'recent' | 'guna' | 'age';
  page?: number;
  limit?: number;
}

export interface InterestDto {
  id: string;
  fromProfileId: string;
  toProfileId: string;
  status: InterestStatus;
  message?: string | null;
  createdAt: string;
  respondedAt?: string | null;
  /** The other party, from the point of view of whoever is reading. */
  counterpart: ProfileCardDto;
  /** Present only on an accepted interest. */
  contact?: { mobile: string; managedBy: ProfileManagedBy } | null;
}

export interface SendInterestRequest {
  toProfileId: string;
  message?: string;
}

export interface ShortlistEntryDto {
  targetProfileId: string;
  /** Private to the owner and never projected for anyone else. */
  note?: string | null;
  addedAt: string;
  profile: ProfileCardDto;
}

// ---------------------------------------------------------------------------
// Ashtakoota
// ---------------------------------------------------------------------------

export const KOOTA_NAMES = [
  'Varna',
  'Vashya',
  'Tara',
  'Yoni',
  'Graha Maitri',
  'Gana',
  'Bhakoot',
  'Nadi',
] as const;
export type KootaName = (typeof KOOTA_NAMES)[number];

/** The eight kootas and what each is worth. They sum to 36. */
export const KOOTA_MAX: Readonly<Record<KootaName, number>> = {
  Varna: 1,
  Vashya: 2,
  Tara: 3,
  Yoni: 4,
  'Graha Maitri': 5,
  Gana: 6,
  Bhakoot: 7,
  Nadi: 8,
};

export interface KootaScore {
  koota: KootaName;
  points: number;
  max: number;
  /** Plain-language reason, so a family can see why it scored that way. */
  note: string;
}

export interface GunaResult {
  total: number;
  max: 36;
  kootas: KootaScore[];
  /** Both manglik or neither is considered compatible. */
  mangalDosha: {
    brideManglik: boolean;
    groomManglik: boolean;
    compatible: boolean;
    note: string;
  };
  verdict: 'EXCELLENT' | 'GOOD' | 'ACCEPTABLE' | 'POOR';
}

/** The conventional reading of a 36-point total. */
export function gunaVerdict(total: number): GunaResult['verdict'] {
  if (total >= 28) return 'EXCELLENT';
  if (total >= 21) return 'GOOD';
  if (total >= 18) return 'ACCEPTABLE';
  return 'POOR';
}

/** The 27 nakshatras, in order. Index + 1 is the stored value. */
export const NAKSHATRAS = [
  'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra',
  'Punarvasu', 'Pushya', 'Ashlesha', 'Magha', 'Purva Phalguni', 'Uttara Phalguni',
  'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha',
  'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha',
  'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati',
] as const;

/** The 12 rashis, in order. Index + 1 is the stored value. */
export const RASHIS = [
  'Mesha', 'Vrishabha', 'Mithuna', 'Karka', 'Simha', 'Kanya',
  'Tula', 'Vrishchika', 'Dhanu', 'Makara', 'Kumbha', 'Meena',
] as const;

/** Houses in which Mars causes Mangal Dosha, counted from the ascendant. */
export const MANGLIK_HOUSES = [1, 2, 4, 7, 8, 12] as const;

/**
 * Legal minimum marriage ages in India. Enforced server-side on every profile:
 * an underage profile is not a validation nicety, it is a legal obligation.
 */
export const MIN_AGE_BY_GENDER: Readonly<Record<Gender, number>> = {
  FEMALE: 18,
  MALE: 21,
};

/**
 * The free interest allowance now lives with the plan table, in
 * subscriptions.ts, so the paywall has one source of truth. Re-exported here
 * only so existing imports keep working.
 */
export { FREE_DAILY_INTERESTS as FREE_DAILY_INTEREST_QUOTA } from './subscriptions.js';

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

/**
 * A conversation between two profiles.
 *
 * Threads are created by the platform when an interest is accepted, never by a
 * member reaching out cold - which is what stops chat becoming an unsolicited
 * inbox and is the whole reason families are willing to have one.
 */
export interface ChatThreadDto {
  id: string;
  /** The other person, from the reader's point of view. */
  counterpart: ProfileCardDto;
  lastMessageAt?: string | null;
  lastMessagePreview?: string | null;
  unreadCount: number;
  createdAt: string;
}

export interface ChatMessageDto {
  id: string;
  threadId: string;
  /** True when the reader wrote it. */
  mine: boolean;
  body: string;
  sentAt: string;
  readAt?: string | null;
}

export interface SendMessageRequest {
  body: string;
}

/** Nobody needs a longer message than this to arrange a meeting. */
export const MAX_MESSAGE_LENGTH = 2000;

/**
 * Limits on profile photos, shared so the browser refuses a file the server
 * would only reject after uploading it.
 *
 * Six is a product decision rather than a technical one: past that, members
 * stop curating and start uploading the whole album, and the moderation queue
 * is what pays for it.
 */
export const MAX_PROFILE_PHOTOS = 6;

/** 5 MB. Large enough for a phone photo, small enough to survive a 4G upload. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * The formats accepted. Deliberately a short list of raster formats: SVG is
 * excluded because it can carry script, and a profile photo is never a vector.
 */
export const ALLOWED_PHOTO_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type AllowedPhotoMimeType = (typeof ALLOWED_PHOTO_MIME_TYPES)[number];

/**
 * Caps on the free-text lists. Chosen so a profile stays scannable: past about
 * a dozen, hobbies stop describing a person and start being a word cloud.
 */
export const MAX_HOBBIES = 12;
export const MAX_PERSONAL_INTERESTS = 12;
/** Long enough for 'Watching Telugu classic cinema', short enough to be a tag. */
export const MAX_TAG_LENGTH = 40;
