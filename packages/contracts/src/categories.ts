import { VendorCategory } from './enums.js';

/**
 * How each vendor category is presented.
 *
 * It lives in contracts rather than in the web app because the same words have
 * to appear in an enquiry email, a booking record and a search card, and three
 * copies of "Mehendi artists" drift into three slightly different phrasings.
 *
 * The blurb is written for someone who has never planned a wedding. "Decor"
 * means nothing on its own; "mandap, stage, entrance and table settings" tells
 * a family whether it is the thing they are looking for.
 */
export interface CategoryMeta {
  /** One of them: "Photographer". Used on a booking, a quote, a review. */
  label: string;
  /** The section heading: "Photographers". */
  plural: string;
  /** What this actually covers, in a family's words. */
  blurb: string;
  /** Shown on the category tile. Emoji, so it needs no asset pipeline. */
  glyph: string;
  /** Which band of the browse page it sits in. */
  group: CategoryGroup;
}

/**
 * How the nineteen categories are banded, for the browse page and the menu.
 *
 * These used to be named for the planning order - "The day itself", "How you
 * look", "Keeping the day". That is how a planner thinks about a wedding, and
 * it reads well on a page you are browsing. It is the wrong label on a menu:
 * somebody who came for a photographer scans for the word "photography" and
 * finds "Keeping the day", which means nothing until it is opened.
 *
 * The groups are now named for what is being bought. The trade is deliberate -
 * a little of the editorial voice for a menu that can be scanned in one pass -
 * and it is why Photography and Venues are groups of one rather than being
 * tidied in with something else. They are the two categories people arrive
 * already looking for, and a group of one that is instantly found beats a
 * tidier grouping that is not.
 */
export const CategoryGroup = {
  VENUES: 'Venues',
  PHOTOGRAPHY: 'Photography',
  CATERING: 'Catering',
  DECORATION: 'Decoration',
  EVENTS: 'Events',
  BOUTIQUE: 'Boutique',
  SERVICES: 'Planning & services',
} as const;
export type CategoryGroup = (typeof CategoryGroup)[keyof typeof CategoryGroup];

/**
 * The handful a family books first, for the menu's "Most booked" column.
 *
 * Ordered by how early in the planning each one is decided rather than by
 * volume: the venue fixes the date, and everything else is chosen around it.
 */
export const MOST_BOOKED: VendorCategory[] = [
  VendorCategory.VENUE,
  VendorCategory.PHOTOGRAPHY,
  VendorCategory.CATERING,
  VendorCategory.DECOR,
  VendorCategory.MAKEUP,
];

export const CATEGORY_META: Record<VendorCategory, CategoryMeta> = {
  [VendorCategory.VENUE]: {
    label: 'Venue',
    plural: 'Venues',
    blurb: 'Banquet halls, lawns, palaces and resorts, with capacity and parking.',
    glyph: '🏛️',
    group: CategoryGroup.VENUES,
  },
  [VendorCategory.CATERING]: {
    label: 'Caterer',
    plural: 'Caterers',
    blurb: 'Veg, non-veg, Jain and regional menus, priced by the plate.',
    glyph: '🍛',
    group: CategoryGroup.CATERING,
  },
  [VendorCategory.CAKE]: {
    label: 'Cake designer',
    plural: 'Cakes and desserts',
    blurb: 'Tiered cakes, dessert tables and eggless options.',
    glyph: '🎂',
    group: CategoryGroup.CATERING,
  },
  [VendorCategory.MAKEUP]: {
    label: 'Makeup artist',
    plural: 'Makeup and hair',
    blurb: 'Bridal makeup, hair and draping, at the venue or at home.',
    glyph: '💄',
    group: CategoryGroup.BOUTIQUE,
  },
  [VendorCategory.MEHENDI]: {
    label: 'Mehendi artist',
    plural: 'Mehendi artists',
    blurb: 'Bridal and guest mehendi — Rajasthani, Arabic and minimal styles.',
    glyph: '🌿',
    group: CategoryGroup.EVENTS,
  },
  [VendorCategory.BRIDAL_WEAR]: {
    label: 'Bridal wear',
    plural: 'Bridal wear',
    blurb: 'Lehengas, sarees and gowns to buy or rent, with fittings.',
    glyph: '👰',
    group: CategoryGroup.BOUTIQUE,
  },
  [VendorCategory.GROOM_WEAR]: {
    label: "Groom's wear",
    plural: "Groom's wear",
    blurb: 'Sherwanis, bandhgalas, suits and safas, tailored or off the rack.',
    glyph: '🤵',
    group: CategoryGroup.BOUTIQUE,
  },
  [VendorCategory.JEWELLERY]: {
    label: 'Jeweller',
    plural: 'Jewellery',
    blurb: 'Bridal sets in gold, polki and kundan, to buy or on rent.',
    glyph: '💍',
    group: CategoryGroup.BOUTIQUE,
  },
  [VendorCategory.PHOTOGRAPHY]: {
    label: 'Photographer',
    plural: 'Photo and video',
    blurb: 'Candid photography, cinematic films, pre-wedding shoots and drones.',
    glyph: '📷',
    group: CategoryGroup.PHOTOGRAPHY,
  },
  [VendorCategory.INVITATION]: {
    label: 'Invitations',
    plural: 'Invitations',
    blurb: 'Printed cards, boxed invites and digital save-the-dates.',
    glyph: '💌',
    group: CategoryGroup.DECORATION,
  },
  [VendorCategory.GIFTS]: {
    label: 'Trousseau and favours',
    plural: 'Trousseau and favours',
    blurb: 'Return gifts, hampers, trousseau packing and welcome bags.',
    glyph: '🎁',
    group: CategoryGroup.SERVICES,
  },
  [VendorCategory.DECOR]: {
    label: 'Decorator',
    plural: 'Decor and flowers',
    blurb: 'Mandap, stage, entrance and table settings, fresh or artificial.',
    glyph: '🌸',
    group: CategoryGroup.DECORATION,
  },
  [VendorCategory.PANDIT]: {
    label: 'Pandit',
    plural: 'Pandits and priests',
    blurb: 'Ceremonies by tradition and language, with the samagri arranged.',
    glyph: '🕉️',
    group: CategoryGroup.SERVICES,
  },
  [VendorCategory.MUSIC]: {
    label: 'DJ or band',
    plural: 'Music and DJs',
    blurb: 'DJs, live bands, shehnai and sound systems with lighting.',
    glyph: '🎧',
    group: CategoryGroup.EVENTS,
  },
  [VendorCategory.CHOREOGRAPHY]: {
    label: 'Choreographer',
    plural: 'Sangeet choreographers',
    blurb: 'Sangeet routines for the families, rehearsed over a few weeks.',
    glyph: '💃',
    group: CategoryGroup.EVENTS,
  },
  [VendorCategory.ENTERTAINMENT]: {
    label: 'Entertainment',
    plural: 'Baraat and entertainment',
    blurb: 'Dhol, baraat horses, anchors, magicians and firework alternatives.',
    glyph: '🥁',
    group: CategoryGroup.EVENTS,
  },
  [VendorCategory.PLANNER]: {
    label: 'Wedding planner',
    plural: 'Wedding planners',
    blurb: 'Full planning or day-of coordination, when you would rather not.',
    glyph: '📋',
    group: CategoryGroup.SERVICES,
  },
  [VendorCategory.TRANSPORT]: {
    label: 'Transport',
    plural: 'Transport',
    blurb: 'Guest coaches, vintage cars for the couple and airport pickups.',
    glyph: '🚗',
    group: CategoryGroup.SERVICES,
  },
  [VendorCategory.HONEYMOON]: {
    label: 'Honeymoon',
    plural: 'Honeymoon',
    blurb: 'Packages and visas, once the last guest has finally gone home.',
    glyph: '✈️',
    group: CategoryGroup.SERVICES,
  },
};

/**
 * One category as the browse grid draws it.
 *
 * The count was here first, because a tile that promises vendors and opens onto
 * an empty page is a lie. The photograph and the price are the same argument
 * carried further: a family choosing a category is choosing what to look at,
 * and a wall of identical labels gives them nothing to choose with. Both are
 * nullable because a brand-new category legitimately has neither.
 */
export interface CategoryTile {
  category: VendorCategory;
  count: number;
  /** The cover photo of the best-rated vendor in the category. */
  coverUrl: string | null;
  /** The cheapest package anyone in the category lists, in paisa. */
  priceFrom: number | null;
}

/** Every category, in the order the browse page shows them. */
export const ALL_CATEGORIES = Object.keys(CATEGORY_META) as VendorCategory[];

/** The groups, each with its categories, for a banded browse page. */
export const CATEGORY_GROUPS: { group: CategoryGroup; categories: VendorCategory[] }[] =
  Object.values(CategoryGroup).map((group) => ({
    group,
    categories: ALL_CATEGORIES.filter((c) => CATEGORY_META[c].group === group),
  }));

/**
 * The URL segment for a category: `bridal-wear`, not `BRIDAL_WEAR`.
 *
 * A shouty enum in the address bar is the sort of thing that tells a visitor
 * they are looking at somebody's database, and these URLs are what gets shared
 * in a family WhatsApp group.
 */
export function categorySlug(category: VendorCategory): string {
  return category.toLowerCase().replace(/_/g, '-');
}

const BY_SLUG = new Map<string, VendorCategory>(
  ALL_CATEGORIES.map((c) => [categorySlug(c), c]),
);

/** The category a URL segment names, or null if it names nothing. */
export function categoryFromSlug(slug: string): VendorCategory | null {
  return BY_SLUG.get(slug.toLowerCase()) ?? null;
}

/** The display name for a category, safe for a value from an old record. */
export function categoryLabel(category: string): string {
  return (
    CATEGORY_META[category as VendorCategory]?.label ??
    category.charAt(0) + category.slice(1).toLowerCase().replace(/_/g, ' ')
  );
}
