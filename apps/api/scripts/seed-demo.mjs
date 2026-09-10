/**
 * Seeds a demo dataset: accounts you can sign into, verified vendors with real
 * catalogues, and published matrimony profiles.
 *
 * It writes straight to Mongo rather than driving the API, for two reasons: the
 * OTP endpoints are rate limited to 5/min and a seed would trip them, and a
 * seed should be re-runnable without a running server.
 *
 * What it deliberately does NOT seed is anything downstream of a business rule
 * - no payments, no ledger entries, and no enquiry or quote without --funnel.
 * Those are what you walk through in the app, and inventing them here would
 * produce records the real code paths would never have created.
 *
 * Completed bookings are the one exception, and only because a review cannot
 * exist without one. Reviews are read on the public search page by visitors who
 * will never have a booking of their own, so a dataset with none leaves the
 * ratings meaning exactly as little as they did before there were reviews.
 *
 * Photos are generated rather than shipped: the upload path checks magic
 * bytes and the browser has to render them, but a folder of stock photographs
 * committed to make a demo look nice is a poor trade. Flat colour blocks are
 * enough to prove a gallery, a cover photo and the moderation queue all work.
 *
 *   npm run seed              accounts, vendors, galleries, profiles
 *   npm run seed -- --funnel  the above, plus enquiries, quotes and a booking
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mongoose from 'mongoose';
import * as argon2 from 'argon2';

import { COMMUNITIES_BY_RELIGION } from '@eventhub/contracts';

import { PALETTE, portraitPng, solidPng } from './lib/png.mjs';

/**
 * Anything downstream of a business rule - enquiries, quotes, bookings - is
 * opt-in. The default seed stays a starting point you walk forward from; the
 * flag is for when you want to land on a screen that already has something on
 * it, such as quote comparison, without playing both sides first.
 */
const WITH_FUNNEL = process.argv.includes('--funnel');

const here = dirname(fileURLToPath(import.meta.url));

/** Everyone in the demo shares this. Long enough for the 8-char minimum. */
const PASSWORD = 'EventHub@2026';

/** Argon2id parameters, matching AuthService exactly. */
const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

function mongoUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  try {
    const env = readFileSync(join(here, '..', '.env'), 'utf8');
    const line = env.match(/^MONGODB_URI=(.*)$/m);
    if (line) return line[1].trim();
  } catch {
    // falls through to the default below
  }
  return 'mongodb://127.0.0.1:27077/eventhub?replicaSet=testset&directConnection=true';
}

const uri = mongoUri();
console.log(`\n  Seeding ${uri}\n`);
await mongoose.connect(uri);
const db = mongoose.connection;

/**
 * Where LocalDiskStorage will look for these files. The rule is duplicated from
 * the driver rather than imported, because this script talks to Mongo directly
 * and booting Nest to resolve one path would be a heavy way to learn it.
 */
const mediaRoot = process.env.MEDIA_LOCAL_ROOT?.trim()
  ? process.env.MEDIA_LOCAL_ROOT.trim()
  : join(here, '..', 'var', 'uploads');

/**
 * Clears the image folders this script owns.
 *
 * The seed wipes its collections so it can be re-run; without the same
 * treatment here every run would leave another set of files behind, referenced
 * by nothing and growing until someone noticed the disk.
 */
function resetMedia() {
  for (const prefix of ['vendor-portfolio', 'profile-photos']) {
    rmSync(join(mediaRoot, prefix), { recursive: true, force: true });
  }
}

/** Writes one generated image where the media endpoint will find it. */
function storeImage(prefix, colour, { width = 640, height = 360, render = solidPng } = {}) {
  return storeBytes(prefix, render(width, height, colour), 'png');
}

/** Puts finished bytes in the store under a random key of the given type. */
function storeBytes(prefix, bytes, ext) {
  const key = `${prefix}/${randomBytes(16).toString('hex')}.${ext}`;
  const path = join(mediaRoot, key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return { key, url: `/api/v1/media/${key}` };
}

/**
 * The seed's portrait photos, read once from disk.
 *
 * Generated faces of people who do not exist - see faces/README.md for why a
 * real photograph is not an option on a fabricated profile. Sorted by gender so
 * a bride never gets a man's photograph, and cycled, so the same face turns up
 * on several profiles. That is a demo artefact and not worth more images.
 */
const FACES = { FEMALE: [], MALE: [] };
for (const [gender, folder] of [['FEMALE', 'female'], ['MALE', 'male']]) {
  const dir = join(here, 'lib', 'faces', folder);
  if (!existsSync(dir)) continue;
  // Any image in the folder, whatever it is called - so replacing the set is
  // dropping files in and re-running, with no naming scheme to observe.
  for (const name of readdirSync(dir).sort()) {
    const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;
    FACES[gender].push({ bytes: readFileSync(join(dir, name)), ext: ext.slice(1) });
  }
}

let faceCursor = 0;

/**
 * A portrait for one named account, if a file has been dropped in for it.
 *
 * The demo customer is the account a person actually signs into, so it is the
 * one worth putting a real face on - and unlike the generated set, this is a
 * photograph its owner supplied of themselves. Kept out of the female/ and
 * male/ pools so it lands on that profile and nowhere else.
 */
function storeNamedFace(name) {
  const file = join(here, 'lib', 'faces', `${name}.jpg`);
  return existsSync(file) ? storeBytes('profile-photos', readFileSync(file), 'jpg') : null;
}

/** One portrait for a profile of this gender, or null if the folder is empty. */
function storeFace(gender) {
  const set = FACES[gender] ?? [];
  if (set.length === 0) return null;
  const face = set[faceCursor++ % set.length];
  return storeBytes('profile-photos', face.bytes, face.ext === 'jpeg' ? 'jpg' : face.ext);
}

const now = new Date();
const id = () => new mongoose.Types.ObjectId();
const yearsAgo = (n) => new Date(Date.UTC(now.getUTCFullYear() - n, 4, 12));

/** Wipes only what this script owns, so it can be re-run safely. */
const collections = [
  'users',
  'vendors',
  'vendor_services',
  'vendor_availability',
  'matrimony_profiles',
  'partner_preferences',
  'interests',
  'shortlists',
  'blocks',
  'weddings',
  'enquiries',
  'quotes',
  'bookings',
  'vendor_reviews',
  'payments',
  'ledger_entries',
  'webhook_events',
];
for (const name of collections) {
  await db.collection(name).deleteMany({});
}
resetMedia();

const passwordHash = await argon2.hash(PASSWORD, ARGON_OPTS);

async function user(fullName, mobile, roles) {
  const _id = id();
  await db.collection('users').insertOne({
    _id,
    fullName,
    mobile,
    passwordHash,
    roles,
    status: 'ACTIVE',
    mobileVerified: true,
    emailVerified: false,
    failedLoginAttempts: 0,
    consent: { accepted: true, version: '2026-01-01', acceptedAt: now },
    createdAt: now,
    updatedAt: now,
  });
  return _id;
}

// ---------------------------------------------------------------- accounts

const customerId = await user('Ravindar Balla', '9876543210', [
  'CUSTOMER',
  'SEEKER',
]);
const adminId = await user('Platform Admin', '8008052727', ['ADMIN']);

// ----------------------------------------------------------------- vendors

/** A verified vendor with a catalogue, ready to be found and enquired with. */
async function vendor({ owner, mobile, businessName, category, city, description, services, rating, reviews, responseMins, palette = [PALETTE.slate], gallery = [] }) {
  const ownerId = await user(owner, mobile, ['VENDOR_OWNER']);
  const vendorId = id();

  await db.collection('vendors').insertOne({
    _id: vendorId,
    ownerId,
    businessName,
    category,
    city,
    description,
    kycStatus: 'VERIFIED',
    kycVerifiedAt: now,
    kyc: {
      pan: 'ABCDE1234F',
      bankAccountName: businessName,
      bankAccountNumber: '123456789012',
      ifsc: 'HDFC0001234',
      submittedAt: now,
    },
    isActive: true,
    // The gallery is the thing a couple actually compares, so a seeded vendor
    // without one shows an empty card and proves nothing about the feature.
    portfolio: gallery.map((caption, i) => {
      const stored = storeImage('vendor-portfolio', palette[i % palette.length]);
      return {
        id: randomUUID(),
        storageKey: stored.key,
        url: stored.url,
        caption,
        isCover: i === 0,
      };
    }),
    priceFrom: Math.min(...services.map((s) => s.basePrice)),
    // Both derived: seedReviews() recomputes them from the reviews it
    // writes, the same way the service does. A rating set here by hand would
    // be exactly the frozen number this feature exists to get rid of.
    rating: 0,
    reviewCount: 0,
    completedBookings: reviews,
    medianResponseMins: responseMins,
    recentResponseMins: [responseMins],
    createdAt: now,
    updatedAt: now,
  });

  await db.collection('vendor_services').insertMany(
    services.map((s) => ({
      _id: id(),
      vendorId,
      ...s,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })),
  );

  return { vendorId, ownerId, mobile, businessName };
}

const venue = await vendor({
  owner: 'Sunrise Banquets',
  mobile: '7702252727',
  palette: [PALETTE.saffron, PALETTE.clay, PALETTE.plum],
  gallery: ['The main hall set for 600', 'Entrance and porch', 'Bridal suite'],
  businessName: 'Sunrise Banquets',
  category: 'VENUE',
  city: 'Hyderabad',
  description:
    'A 900-capacity banquet hall in Banjara Hills with covered parking, a bridal suite and in-house decor.',
  rating: 4.6,
  reviews: 38,
  responseMins: 42,
  services: [
    {
      title: 'Full day hall hire',
      description: 'Exclusive use of the main hall, 8am to midnight.',
      pricingModel: 'PER_DAY',
      basePrice: 400_000_00,
      capacity: 900,
      inclusions: ['Parking for 200', 'Generator backup', 'Bridal suite'],
    },
    {
      title: 'Evening only',
      description: 'The main hall from 5pm to midnight.',
      pricingModel: 'PER_DAY',
      basePrice: 250_000_00,
      capacity: 900,
      inclusions: ['Parking for 200', 'Generator backup'],
    },
  ],
});

const venue2 = await vendor({
  owner: 'Pearl Gardens',
  mobile: '9876543211',
  palette: [PALETTE.moss, PALETTE.teal],
  gallery: ['The lawn at dusk', 'Monsoon backup hall'],
  businessName: 'Pearl Gardens',
  category: 'VENUE',
  city: 'Hyderabad',
  description:
    'An open-air garden venue in Gachibowli for 500 guests, with a covered stage and a monsoon backup hall.',
  rating: 4.2,
  reviews: 21,
  responseMins: 130,
  services: [
    {
      title: 'Garden lawn, full day',
      description: 'The lawn and stage for a full day, monsoon hall included.',
      pricingModel: 'PER_DAY',
      basePrice: 320_000_00,
      capacity: 500,
      inclusions: ['Monsoon backup hall', 'Stage and lighting'],
    },
  ],
});

const caterer = await vendor({
  owner: 'Annapurna Caterers',
  mobile: '9876543212',
  palette: [PALETTE.rose, PALETTE.saffron],
  gallery: ['A wedding thali', 'Live counters'],
  businessName: 'Annapurna Caterers',
  category: 'CATERING',
  city: 'Hyderabad',
  description:
    'Pure vegetarian Telugu and North Indian catering, three generations, live counters on request.',
  rating: 4.8,
  reviews: 64,
  responseMins: 25,
  services: [
    {
      title: 'Classic vegetarian thali',
      description: 'Eleven items, two sweets, served on the leaf.',
      pricingModel: 'PER_PLATE',
      basePrice: 850_00,
      minimumUnits: 200,
      inclusions: ['Service staff', 'Crockery', 'Two live counters'],
    },
    {
      title: 'Premium wedding menu',
      description: 'Nineteen items, four sweets, five live counters.',
      pricingModel: 'PER_PLATE',
      basePrice: 1_450_00,
      minimumUnits: 200,
      inclusions: ['Service staff', 'Crockery', 'Five live counters', 'Welcome drinks'],
    },
  ],
});

const photographer = await vendor({
  owner: 'Lens & Light Studio',
  mobile: '9876543213',
  palette: [PALETTE.indigo, PALETTE.plum, PALETTE.slate],
  gallery: ['Candid, Hyderabad 2026', 'Mandap coverage', 'Reception portraits'],
  businessName: 'Lens & Light Studio',
  category: 'PHOTOGRAPHY',
  city: 'Hyderabad',
  description:
    'Candid wedding photography and cinematic films. Two photographers, one cinematographer, drone on request.',
  rating: 4.9,
  reviews: 52,
  responseMins: 18,
  services: [
    {
      title: 'Wedding day package',
      description: 'Full day coverage, 300 edited photographs, a 5-minute film.',
      pricingModel: 'PER_PACKAGE',
      basePrice: 125_000_00,
      inclusions: ['Two photographers', 'Cinematographer', 'Online gallery'],
    },
  ],
});

// ------------------------------------------------- the rest of the categories

/**
 * Two vendors in each of the remaining categories.
 *
 * The category grid is the front door, and a front door where fifteen of the
 * nineteen tiles say "none yet" tells a visitor the platform is empty even
 * though it is not. Two is enough for a listing page to have something to sort
 * and filter, which is the thing being demonstrated.
 *
 * Written out rather than generated from name fragments. Randomly assembled
 * businesses read as randomly assembled - "Elite Royal Wedding Solutions Pvt
 * Ltd" - and the descriptions are what the search and the cards are actually
 * displaying, so they have to be sentences somebody might have written.
 */
let extraMobile = 7000000001;

const MORE = [
  ['MEHENDI', 'Henna by Ramya', 'Hyderabad',
    'Bridal mehendi in Rajasthani and Arabic styles, twelve years in the trade. Travels to the venue with her own team.',
    [['Bridal hands and feet', 'Full bridal design, both sides, up to six hours.', 'PER_PACKAGE', 25_000_00, null, ['Own cones', 'Aftercare oil', 'Travel within city']],
     ['Guest mehendi counter', 'Two artists for the guests during the function.', 'PER_HOUR', 2_500_00, null, ['Two artists', 'Unlimited guests']]],
    [PALETTE.moss, PALETTE.saffron], ['Bridal hands, 2026', 'Guest counter at a sangeet'], 41, 55],
  ['MEHENDI', 'Sitara Mehendi Art', 'Hyderabad',
    'Minimal and modern mehendi for brides who want something less dense, plus large guest counters for sangeet nights.',
    [['Contemporary bridal', 'Lighter, negative-space bridal design.', 'PER_PACKAGE', 18_000_00, null, ['Own cones', 'Trial sitting']]],
    [PALETTE.teal], ['A minimal bridal design'], 88, 23],

  ['BRIDAL_WEAR', 'Kanchi Silks & Bridal', 'Hyderabad',
    'Kanjeevaram and Banarasi bridal sarees, plus lehengas made to measure. Three fittings included, six weeks lead time.',
    [['Made-to-measure lehenga', 'Designed with you, three fittings, six weeks.', 'PER_PACKAGE', 145_000_00, null, ['Three fittings', 'Blouse included', 'Dupatta']],
     ['Bridal saree with blouse', 'Kanjeevaram from the Kanchipuram looms.', 'PER_PACKAGE', 65_000_00, null, ['Stitched blouse', 'Fall and pico']]],
    [PALETTE.rose, PALETTE.plum, PALETTE.saffron], ['The bridal floor', 'Kanjeevaram in gold', 'Fitting room'], 95, 61],
  ['BRIDAL_WEAR', 'Rent The Lehenga', 'Bengaluru',
    'Designer lehengas on rent for a fraction of buying, for the functions you will only wear once. Dry cleaning included.',
    [['Four-day rental', 'Pick up two days before, return two days after.', 'PER_PACKAGE', 22_000_00, null, ['Dry cleaning', 'One alteration', 'Insurance']]],
    [PALETTE.plum, PALETTE.rose], ['The rental rail', 'Sangeet lehengas'], 34, 78],

  ['GROOM_WEAR', 'Bandhgala House', 'Hyderabad',
    'Tailored sherwanis, bandhgalas and Jodhpuri suits. Measured in store or at home, four weeks from measurement to delivery.',
    [['Bespoke sherwani', 'Cut and stitched to measure, four weeks.', 'PER_PACKAGE', 55_000_00, null, ['Two fittings', 'Churidar', 'Stole']],
     ['Safa and accessories', 'Turban tied on the day, with brooch and kalgi.', 'PER_PACKAGE', 8_500_00, null, ['Tied on site', 'Brooch', 'Kalgi']]],
    [PALETTE.indigo, PALETTE.slate], ['Sherwanis on the rail', 'The fitting room'], 62, 44],
  ['GROOM_WEAR', 'The Groom Room', 'Chennai',
    'Suits, indo-westerns and coordinated outfits for the groomsmen, so the baraat photographs as a set rather than a crowd.',
    [['Groom and four groomsmen', 'Coordinated outfits, one fitting each.', 'PER_PACKAGE', 92_000_00, null, ['Five outfits', 'Pocket squares', 'One fitting each']]],
    [PALETTE.slate, PALETTE.teal], ['Coordinated groomsmen'], 120, 19],

  ['JEWELLERY', 'Polki House Jewellers', 'Hyderabad',
    'Uncut polki and kundan bridal sets, hallmarked, with a buyback in writing. Sets also available on rent for the sangeet.',
    [['Bridal polki set', 'Necklace, earrings, maang tikka. Hallmarked.', 'PER_PACKAGE', 385_000_00, null, ['Hallmarked', 'Buyback in writing', 'Insured transit']],
     ['Rental set for one function', 'Worn for one day, returned the next.', 'PER_PACKAGE', 28_000_00, null, ['Insured', 'Security escort']]],
    [PALETTE.saffron, PALETTE.clay], ['A polki bridal set', 'The rental vault'], 210, 37],
  ['JEWELLERY', 'Temple Jewels Chennai', 'Chennai',
    'South Indian temple jewellery — haram, vanki, oddiyanam — in gold and one-gram, for brides who want the traditional set.',
    [['Full temple set', 'Haram, necklace, vanki, jhumkas, oddiyanam.', 'PER_PACKAGE', 240_000_00, null, ['Hallmarked', 'Velvet case']]],
    [PALETTE.saffron], ['A full temple set'], 140, 26],

  ['CHOREOGRAPHY', 'Sangeet Nights Choreography', 'Hyderabad',
    'Sangeet routines for both families, rehearsed over four to six weeks. Works with people who insist they cannot dance.',
    [['Six-week sangeet package', 'Eight rehearsals, four routines, day-of direction.', 'PER_PACKAGE', 85_000_00, null, ['Eight rehearsals', 'Music editing', 'Day-of direction']],
     ['Couple dance only', 'One routine for the two of you, four sittings.', 'PER_PACKAGE', 28_000_00, null, ['Four sittings', 'Music editing']]],
    [PALETTE.plum, PALETTE.indigo], ['A sangeet in rehearsal', 'The couple routine'], 47, 33],
  ['CHOREOGRAPHY', 'Steps by Aditi', 'Mumbai',
    'Bollywood and semi-classical sangeet choreography, including over video call for the relatives who arrive two days before.',
    [['Remote plus on-site', 'Video rehearsals, then three days in person.', 'PER_PACKAGE', 62_000_00, null, ['Video rehearsals', 'Three days on site']]],
    [PALETTE.rose], ['Rehearsal over video'], 75, 21],

  ['ENTERTAINMENT', 'Dhol Baaje Baraat', 'Hyderabad',
    'Dhol players, baraat horses and a brass band, with the permissions and the sound limits already worked out.',
    [['Baraat package', 'Four dhol players, decorated horse, two hours.', 'PER_PACKAGE', 45_000_00, null, ['Four dhol players', 'Decorated horse', 'Permissions handled']],
     ['Dhol only', 'Two players for the entrance.', 'PER_HOUR', 6_000_00, null, ['Two players']]],
    [PALETTE.clay, PALETTE.saffron], ['A baraat on the move', 'The dhol line'], 52, 48],
  ['ENTERTAINMENT', 'Encore Events & Anchors', 'Bengaluru',
    'Anchors, magicians, caricaturists and cold-pyro entrances for receptions — everything except actual fireworks.',
    [['Anchor for the reception', 'Four hours, script written with you.', 'PER_PACKAGE', 35_000_00, null, ['Script written with you', 'Four hours']]],
    [PALETTE.teal, PALETTE.indigo], ['A reception in progress'], 66, 29],

  ['CAKE', 'Tiers of Joy', 'Hyderabad',
    'Tiered wedding cakes and dessert tables, eggless on request, delivered and assembled at the venue.',
    [['Three-tier wedding cake', 'Delivered and assembled on site.', 'PER_PACKAGE', 18_000_00, null, ['Eggless option', 'Delivery and setup', 'Tasting']],
     ['Dessert table', 'Priced per guest, six varieties.', 'PER_PLATE', 320_00, 100, ['Six varieties', 'Stands provided']]],
    [PALETTE.rose, PALETTE.moss], ['A three-tier cake', 'The dessert table'], 29, 52],
  ['CAKE', 'Sugar & Saffron', 'Pune',
    'Fusion dessert tables — mithai alongside patisserie — for couples whose families disagree about what pudding is.',
    [['Fusion dessert table', 'Mithai and patisserie, priced per guest.', 'PER_PLATE', 420_00, 100, ['Mithai and patisserie', 'Setup included']]],
    [PALETTE.saffron], ['Mithai meets patisserie'], 44, 18],

  ['PLANNER', 'Shaadi Sorted', 'Hyderabad',
    'Full wedding planning or day-of coordination. Runs the timeline so the family can attend their own wedding.',
    [['Full planning', 'From venue hunt to the last vendor payment.', 'PER_PACKAGE', 450_000_00, null, ['Vendor sourcing', 'Budget tracking', 'On-site team of four']],
     ['Day-of coordination', 'We take the file two weeks out and run the day.', 'PER_PACKAGE', 125_000_00, null, ['Timeline', 'Vendor wrangling', 'Team of two']]],
    [PALETTE.indigo, PALETTE.moss, PALETTE.slate], ['A run sheet in the wild', 'Setup morning', 'The team at work'], 26, 71],
  ['PLANNER', 'The Wedding Desk', 'Delhi NCR',
    'Destination weddings in Rajasthan and Goa, including the logistics of moving three hundred relatives across the country.',
    [['Destination wedding', 'Three days, guest logistics included.', 'PER_PACKAGE', 850_000_00, null, ['Guest travel desk', 'Room allocation', 'On-site team of six']]],
    [PALETTE.clay, PALETTE.plum], ['A Rajasthan mandap', 'The guest desk'], 190, 34],

  ['DECOR', 'Marigold & Mandap', 'Hyderabad',
    'Mandap, stage and entrance decor in fresh flowers. Marigold, tuberose and orchid, sourced the morning of the function.',
    [['Full function decor', 'Mandap, stage, entrance and aisle, fresh flowers.', 'PER_PACKAGE', 285_000_00, null, ['Fresh flowers', 'Mandap structure', 'Lighting']],
     ['Entrance and stage only', 'For a smaller reception.', 'PER_PACKAGE', 95_000_00, null, ['Fresh flowers', 'Stage backdrop']]],
    [PALETTE.saffron, PALETTE.moss, PALETTE.rose], ['A marigold mandap', 'Stage backdrop', 'The entrance'], 58, 67],
  ['DECOR', 'Studio Neel Events', 'Bengaluru',
    'Contemporary decor — pastels, dried florals and clean structures — for couples who do not want a marigold wedding.',
    [['Contemporary decor', 'Structures, dried florals, ambient lighting.', 'PER_PACKAGE', 320_000_00, null, ['Custom structures', 'Ambient lighting']]],
    [PALETTE.teal, PALETTE.slate], ['Pastel mandap', 'Dried floral installation'], 105, 31],

  ['MAKEUP', 'Blush by Nandini', 'Hyderabad',
    'Airbrush and HD bridal makeup with hair and draping. Trial included, and she arrives before the photographer does.',
    [['Bridal, all functions', 'Muhurtham, reception and sangeet, plus trial.', 'PER_PACKAGE', 95_000_00, null, ['Trial sitting', 'Hair and draping', 'Touch-up kit']],
     ['One function', 'Makeup, hair and draping for a single day.', 'PER_PACKAGE', 35_000_00, null, ['Hair and draping']]],
    [PALETTE.rose, PALETTE.plum], ['Bridal, muhurtham morning', 'Reception look'], 22, 84],
  ['MAKEUP', 'Glow Studio Chennai', 'Chennai',
    'Bridal and family makeup with a team, so the bride, her mother and four cousins are all ready before the muhurtham.',
    [['Bride plus family of six', 'One artist for the bride, two for the family.', 'PER_PACKAGE', 78_000_00, null, ['Three artists', 'Hair for all', 'Trial for bride']]],
    [PALETTE.saffron, PALETTE.rose], ['The family getting ready'], 51, 39],

  ['MUSIC', 'Bassline DJs', 'Hyderabad',
    'DJs with their own line array and lighting rig, plus a shehnai player for the morning if you want both.',
    [['Sangeet and reception', 'Two nights, sound and lighting included.', 'PER_PACKAGE', 165_000_00, null, ['Line array', 'Lighting rig', 'Two nights']],
     ['One night', 'DJ, sound and basic lighting.', 'PER_PACKAGE', 75_000_00, null, ['Sound system', 'Basic lighting']]],
    [PALETTE.indigo, PALETTE.plum], ['The rig at a sangeet', 'Reception lighting'], 39, 58],
  ['MUSIC', 'Raga Live Ensemble', 'Chennai',
    'Live Carnatic and light music for the muhurtham and the reception — nadaswaram, violin, mridangam and vocals.',
    [['Muhurtham ensemble', 'Nadaswaram and thavil for the ceremony.', 'PER_PACKAGE', 55_000_00, null, ['Four musicians', 'Own instruments']]],
    [PALETTE.saffron, PALETTE.clay], ['The ensemble at a muhurtham'], 82, 27],

  ['PANDIT', 'Vedic Rituals Hyderabad', 'Hyderabad',
    'Pandits for Telugu, Tamil and North Indian ceremonies, with the samagri arranged and each step explained in English.',
    [['Wedding ceremony', 'Full muhurtham with samagri arranged.', 'PER_PACKAGE', 32_000_00, null, ['Samagri arranged', 'Explained in English', 'Two assistants']],
     ['Engagement or housewarming', 'Shorter ceremony, one pandit.', 'PER_PACKAGE', 11_000_00, null, ['Samagri arranged']]],
    [PALETTE.saffron], ['A muhurtham in progress'], 36, 92],
  ['PANDIT', 'Shastri Ji Delhi', 'Delhi NCR',
    'North Indian pheras and havan, in Hindi or English, for families who want the meaning of each step said out loud.',
    [['Pheras and havan', 'Full ceremony, samagri included.', 'PER_PACKAGE', 28_000_00, null, ['Samagri included', 'Hindi or English']]],
    [PALETTE.clay], ['The havan set up'], 70, 45],

  ['TRANSPORT', 'Baraat Wheels', 'Hyderabad',
    'Vintage cars for the couple and air-conditioned coaches for the guests, with drivers who know the venue routes.',
    [['Guest coaches', 'Two 40-seat coaches for the day.', 'PER_DAY', 42_000_00, null, ['Two coaches', 'Drivers', 'Fuel included']],
     ['Vintage car for the couple', 'Decorated, for the vidaai.', 'PER_DAY', 25_000_00, null, ['Decoration', 'Chauffeur']]],
    [PALETTE.slate, PALETTE.moss], ['The vintage car', 'Guest coaches'], 60, 41],
  ['TRANSPORT', 'City Fleet Bengaluru', 'Bengaluru',
    'Airport pickups and inter-venue shuttles run on a timetable, with a coordinator watching who has actually arrived.',
    [['Airport and shuttle', 'Pickups and shuttles across three days.', 'PER_PACKAGE', 95_000_00, null, ['Coordinator', 'Live tracking', 'Three days']]],
    [PALETTE.teal], ['The shuttle desk'], 48, 22],

  ['INVITATION', 'Letterpress & Co', 'Hyderabad',
    'Letterpress and foil wedding cards, boxed invitations with mithai, and matching digital save-the-dates.',
    [['Printed cards, 300', 'Letterpress with foil, envelopes included.', 'PER_PACKAGE', 68_000_00, null, ['300 cards', 'Envelopes', 'Digital version']],
     ['Boxed invitations, 50', 'Box with card, mithai and a candle.', 'PER_PACKAGE', 55_000_00, null, ['50 boxes', 'Mithai included']]],
    [PALETTE.clay, PALETTE.saffron], ['Letterpress in gold', 'A boxed invitation'], 130, 36],
  ['INVITATION', 'Pixel Invites', 'Mumbai',
    'Animated digital invitations and a wedding website with RSVP tracking, for weddings where half the guests are abroad.',
    [['Digital suite', 'Animated invite, website and RSVP tracking.', 'PER_PACKAGE', 24_000_00, null, ['Animated invite', 'Wedding website', 'RSVP tracking']]],
    [PALETTE.indigo], ['An animated invite'], 18, 64],

  ['GIFTS', 'The Trousseau Trunk', 'Hyderabad',
    'Trousseau packing, return gifts and welcome hampers for out-of-town guests, delivered to the hotel before they land.',
    [['Return gifts, 200', 'Curated hampers, wrapped and labelled.', 'PER_PLATE', 850_00, 100, ['Wrapped and labelled', 'Delivered to venue']],
     ['Trousseau packing', 'Everything packed and presented for the vidaai.', 'PER_PACKAGE', 45_000_00, null, ['Packing', 'Presentation trays']]],
    [PALETTE.rose, PALETTE.saffron], ['Wrapped return gifts', 'Trousseau trays'], 72, 30],
  ['GIFTS', 'Hamper House Pune', 'Pune',
    'Welcome hampers and favours sourced from small Indian makers, with a card explaining where each thing came from.',
    [['Welcome hampers, 80', 'For guests staying at the hotel.', 'PER_PLATE', 1_200_00, 50, ['Delivered to rooms', 'Provenance card']]],
    [PALETTE.moss], ['A welcome hamper'], 90, 17],

  ['HONEYMOON', 'Two Tickets Travel', 'Hyderabad',
    'Honeymoon packages and visas, booked around the wedding date so nobody is filing paperwork during the sangeet.',
    [['Maldives, seven nights', 'Flights, resort and transfers for two.', 'PER_PACKAGE', 385_000_00, null, ['Flights', 'Overwater villa', 'Transfers']],
     ['Europe, twelve nights', 'Three cities, rail between, visas handled.', 'PER_PACKAGE', 520_000_00, null, ['Visas handled', 'Rail passes', 'Hotels']]],
    [PALETTE.teal, PALETTE.indigo], ['An overwater villa', 'A European itinerary'], 240, 25],
  ['HONEYMOON', 'Himalaya Honeymoons', 'Delhi NCR',
    'Quieter honeymoons — Spiti, Bhutan and Ladakh — for couples who would rather walk than lie on a beach.',
    [['Bhutan, nine nights', 'Guided, with permits and the daily fee included.', 'PER_PACKAGE', 295_000_00, null, ['Permits', 'Guide', 'All meals']]],
    [PALETTE.slate, PALETTE.moss], ['A Bhutan valley'], 300, 14],

  ['VENUE', 'Falaknuma Terrace', 'Hyderabad',
    'A heritage terrace above the old city for 250 guests, with the skyline behind the mandap and valet parking below.',
    [['Evening hire', 'The terrace from 5pm to midnight.', 'PER_DAY', 550_000_00, 250, ['Valet parking', 'Heritage lighting', 'Bridal room']]],
    [PALETTE.clay, PALETTE.saffron, PALETTE.plum], ['The terrace at dusk', 'Skyline behind the mandap', 'The approach'], 88, 42],
  ['CATERING', 'Hyderabadi Dawat', 'Hyderabad',
    'Non-vegetarian Hyderabadi catering — dum biryani cooked on site, haleem in season, and a separate vegetarian kitchen.',
    [['Dawat menu', 'Fifteen items, biryani cooked on site.', 'PER_PLATE', 1_150_00, 150, ['Biryani on site', 'Separate veg kitchen', 'Service staff']]],
    [PALETTE.clay, PALETTE.saffron], ['Dum biryani, lid on', 'The service line'], 33, 76],
  ['PHOTOGRAPHY', 'Frame & Fable', 'Bengaluru',
    'Documentary wedding photography — no posed group shots unless you ask — plus a printed album rather than a pen drive.',
    [['Two-day coverage', 'Both days, 400 images, printed album.', 'PER_PACKAGE', 185_000_00, null, ['Two photographers', 'Printed album', 'Online gallery']]],
    [PALETTE.slate, PALETTE.indigo], ['Documentary, Bengaluru', 'The album'], 27, 53],
];

for (const [category, businessName, city, description, svc, palette, gallery, responseMins, done] of MORE) {
  await vendor({
    owner: businessName,
    mobile: String(extraMobile++),
    businessName,
    category,
    city,
    description,
    palette,
    gallery,
    responseMins,
    reviews: done,
    // The fifth column means minimumUnits on a per-plate package and capacity
    // on everything else. A dessert table priced per head has a minimum order,
    // not a number of seats, and calling it capacity would put "seats 100" on
    // a card next to a wedding of four hundred.
    services: svc.map(([title, sdesc, pricingModel, basePrice, units, inclusions]) => ({
      title,
      description: sdesc,
      pricingModel,
      basePrice,
      ...(units && pricingModel === 'PER_PLATE' ? { minimumUnits: units } : {}),
      ...(units && pricingModel !== 'PER_PLATE' ? { capacity: units } : {}),
      inclusions,
    })),
  });
}

console.log(`  ${MORE.length} more vendors across ${new Set(MORE.map((m) => m[0])).size} categories.`);

// ----------------------------------------------------------------- reviews

/**
 * Reviews, and the ratings that come out of them.
 *
 * Every one is written against a completed booking, because that is the only
 * way the app itself will accept one - a seed that inserted bare review
 * documents would be testing a path no customer can walk. The vendor's rating
 * and review count are then recomputed from what was written, exactly as
 * ReviewsService.recomputeRating does, so the numbers on a search card are the
 * arithmetic of the reviews underneath it rather than a decision made here.
 */
let reviewerMobile = 6000000001;

async function seedReviews(vendorTarget, category, entries) {
  const reviewDocs = [];

  for (const entry of entries) {
    const reviewerId = await user(entry.author, String(reviewerMobile++), ['CUSTOMER']);
    const bookingId = id();
    const eventDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - entry.monthsAgo, 14),
    );

    await db.collection('bookings').insertOne({
      _id: bookingId,
      weddingId: id(),
      customerId: reviewerId,
      vendorId: vendorTarget.vendorId,
      quoteId: id(),
      category,
      status: 'COMPLETED',
      eventDate,
      totalAmount: entry.paid,
      paidAmount: entry.paid,
      advanceAmount: Math.round(entry.paid * 0.25),
      commissionBps: 1000,
      cancellationTiers: [],
      statusHistory: [],
      createdAt: eventDate,
      updatedAt: eventDate,
    });

    // The mean of the four, one decimal - the same rule as overallRating().
    const s = entry.scores;
    const values = [s.quality, s.professionalism, s.value, s.flexibility];
    const rating = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;

    // First name, last initial: how the service publishes a reviewer.
    const parts = entry.author.trim().split(/\s+/);
    const authorName =
      parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];

    reviewDocs.push({
      _id: id(),
      vendorId: vendorTarget.vendorId,
      bookingId,
      customerId: reviewerId,
      authorName,
      rating,
      scores: s,
      title: entry.title,
      body: entry.body,
      category,
      eventDate,
      amountPaid: entry.paid,
      ...(entry.reply
        ? {
            vendorReply: {
              body: entry.reply,
              repliedAt: new Date(eventDate.getTime() + 3 * 24 * 60 * 60 * 1000),
            },
          }
        : {}),
      createdAt: new Date(eventDate.getTime() + 7 * 24 * 60 * 60 * 1000),
      updatedAt: now,
    });
  }

  await db.collection('vendor_reviews').insertMany(reviewDocs);

  const average =
    Math.round((reviewDocs.reduce((sum, r) => sum + r.rating, 0) / reviewDocs.length) * 10) / 10;
  await db.collection('vendors').updateOne(
    { _id: vendorTarget.vendorId },
    { $set: { rating: average, reviewCount: reviewDocs.length } },
  );

  return reviewDocs.length;
}

const sc = (quality, professionalism, value, flexibility) => ({
  quality,
  professionalism,
  value,
  flexibility,
});

let reviewCount = 0;

reviewCount += await seedReviews(venue, 'VENUE', [
  {
    author: 'Sridevi Narayan',
    monthsAgo: 3,
    paid: 400_000_00,
    scores: sc(5, 5, 4, 5),
    title: 'The hall did all the work for us',
    body:
      'We had 640 guests and never once felt crowded. The bridal suite meant my sister could get ready on site instead of driving over in traffic, and the parking staff kept the porch clear the whole evening. Only note is that the full-day rate is at the top of the Banjara Hills range.',
    reply:
      'Thank you Sridevi. We have added two more attendants to the porch since your wedding, on exactly this feedback.',
  },
  {
    author: 'Kiran Kumar Reddy',
    monthsAgo: 7,
    paid: 250_000_00,
    scores: sc(5, 4, 5, 4),
    title: 'Evening slot was the right call',
    body:
      'We took the evening-only hire for the reception and it was plenty. Handover from the afternoon event ran about forty minutes late, which ate into our decor setup, but the team stayed past midnight to make up for it and did not charge us extra.',
  },
  {
    author: 'Meghana Rao',
    monthsAgo: 11,
    paid: 400_000_00,
    scores: sc(4, 5, 4, 5),
    title: 'Straightforward people to deal with',
    body:
      'Everything they quoted is what we paid, which after three other venues quoting one number and invoicing another was a relief. Generator kicked in twice during the muhurtham and nobody in the hall noticed.',
  },
  {
    author: 'Anil Prasad',
    monthsAgo: 14,
    paid: 400_000_00,
    scores: sc(3, 3, 3, 2),
    title: 'Fine hall, hard to get hold of',
    body:
      'No complaints about the venue itself on the day. Getting answers in the six weeks before it was another matter - calls unreturned for days at a time, and we found out about the in-house decor rule a fortnight before the wedding.',
    reply:
      'This is fair and we are sorry. We hired a dedicated coordinator in March and now answer enquiries within a day.',
  },
]);

reviewCount += await seedReviews(venue2, 'VENUE', [
  {
    author: 'Lavanya Iyer',
    monthsAgo: 4,
    paid: 320_000_00,
    scores: sc(5, 4, 5, 5),
    title: 'The lawn at dusk is worth the booking on its own',
    body:
      'Our photographer said it was the best light he had worked in all season. It rained for twenty minutes during the sangeet and the backup hall was ready before we had finished worrying about it.',
  },
  {
    author: 'Rohit Malhotra',
    monthsAgo: 9,
    paid: 320_000_00,
    scores: sc(4, 3, 4, 4),
    title: 'Beautiful, but plan around the sound rules',
    body:
      'It is an open venue in a residential pocket, so music has to come down at ten. Nobody hid that from us, but we did not think through what it meant until the baraat was still going at 9:45. Venue itself was spotless.',
  },
  {
    author: 'Deepika Chandran',
    monthsAgo: 13,
    paid: 320_000_00,
    scores: sc(4, 4, 3, 4),
    title: 'Good day, slightly steep for the size',
    body:
      'Five hundred was genuinely comfortable and the stage lighting is better than the photographs suggest. For the same money we could have had a larger indoor hall, so it comes down to how much the garden matters to you. For us it did.',
  },
]);

reviewCount += await seedReviews(caterer, 'CATERING', [
  {
    author: 'Padmaja Sastry',
    monthsAgo: 2,
    paid: 425_000_00,
    scores: sc(5, 5, 5, 5),
    title: 'Three days of food and not one dish repeated',
    body:
      'They cooked for the pellikuthuru, the muhurtham and the reception, and my father-in-law - who has an opinion about every pulihora he has ever eaten - asked for the cook by name. Counted the plates honestly too; we were billed for 480 against an estimate of 500.',
    reply: 'It was a pleasure. Please pass our regards to your father-in-law.',
  },
  {
    author: 'Vikram Shetty',
    monthsAgo: 6,
    paid: 290_000_00,
    scores: sc(5, 5, 4, 5),
    title: 'Live counters were the hit of the evening',
    body:
      'We went with the classic thali and added two counters. Queues at the chaat counter never got long because they opened a second one when they saw it building, without being asked. Service staff were in position from the first guest to the last.',
  },
  {
    author: 'Haritha Vemula',
    monthsAgo: 10,
    paid: 170_000_00,
    scores: sc(5, 4, 5, 4),
    title: 'Handled a Jain menu without a fuss',
    body:
      'A third of our guests eat no onion or garlic and they cooked that side of the menu separately rather than telling us it was fine. The two kitchens were kept genuinely apart, which mattered a great deal to my grandmother.',
  },
  {
    author: 'Sanjay Bhatt',
    monthsAgo: 15,
    paid: 250_000_00,
    scores: sc(4, 5, 4, 5),
    title: 'Excellent food, sweets ran short',
    body:
      'The main courses were faultless and there was still hot food coming out at eleven. Both sweets were gone by 9:30 though, and we had ordered for the full count. They knocked off the difference when we raised it.',
  },
  {
    author: 'Nirmala Devi',
    monthsAgo: 18,
    paid: 620_000_00,
    scores: sc(5, 5, 4, 5),
    title: 'Fed 700 people on a lawn with no kitchen',
    body:
      'The venue had no kitchen at all and they brought everything, set up behind a screen, and you would not have known. Premium menu is expensive but the nineteen items are real items, not eleven items and eight garnishes.',
  },
]);

reviewCount += await seedReviews(photographer, 'PHOTOGRAPHY', [
  {
    author: 'Ananya Krishnan',
    monthsAgo: 3,
    paid: 125_000_00,
    scores: sc(5, 5, 5, 5),
    title: 'Photographs I actually want on the wall',
    body:
      'They spent the morning with us before anyone else arrived, which is why the getting-ready set looks like people rather than poses. Full gallery came back in eighteen days and the film in five weeks, both earlier than promised.',
  },
  {
    author: 'Suresh Babu',
    monthsAgo: 8,
    paid: 125_000_00,
    scores: sc(5, 5, 4, 5),
    title: 'Invisible all day, and then the gallery arrives',
    body:
      'Two photographers and a cinematographer and I could not tell you where any of them stood during the muhurtham. Not the cheapest quote we had by a distance, but the difference is obvious next to what our cousins got.',
    reply: 'Thank you Suresh. Staying out of the way is most of the job.',
  },
  {
    author: 'Pooja Agarwal',
    monthsAgo: 12,
    paid: 125_000_00,
    scores: sc(5, 4, 5, 5),
    title: 'Drone footage made the film',
    body:
      'We added the drone almost as an afterthought and the opening shot over the mandap is the bit everyone replays. Communication in the last week was a little thin, but they turned up at six in the morning as agreed and stayed past the vidaai.',
  },
  {
    author: 'Ramesh Chandra Gupta',
    monthsAgo: 16,
    paid: 125_000_00,
    scores: sc(5, 5, 5, 4),
    title: 'Worth every rupee, book them early',
    body:
      'We were told in November that our February date was already taken and only got it because of a cancellation. Now that I have seen the photographs I understand why. Three hundred edited images and I could not bring myself to delete any of them.',
  },
]);

// -------------------------------------------------------- matrimony profiles

async function profile({
  owner,
  mobile,
  displayName,
  gender,
  age,
  city,
  community,
  gotra,
  occupation,
  qualification,
  nakshatra,
  rashi,
  marsHouse,
  photoColour,
  /** 'APPROVED' by default; some are left PENDING so the queue has work. */
  photoModeration = 'APPROVED',
  managedBy = 'SELF',
  about,
  religion = 'Hindu',
  motherTongue = 'Telugu',
  diet = 'VEGETARIAN',
  maritalStatus = 'NEVER_MARRIED',
}) {
  const userId = await user(owner, mobile, ['SEEKER']);
  const _id = id();

  await db.collection('matrimony_profiles').insertOne({
    _id,
    userId,
    displayName,
    managedBy,
    gender,
    dateOfBirth: yearsAgo(age),
    heightCm: gender === 'FEMALE' ? 160 + (age % 7) : 172 + (age % 8),
    maritalStatus,
    religion,
    community,
    gotra,
    motherTongue,
    city,
    diet,
    about,
    education: { highestQualification: qualification, fieldOfStudy: 'Engineering' },
    career: { occupation, annualIncome: 1_800_000_00 },
    family: {
      fatherOccupation: 'Retired bank manager',
      motherOccupation: 'Homemaker',
      brothers: 1,
      sisters: 1,
      familyStatus: 'UPPER_MIDDLE_CLASS',
      familyType: 'NUCLEAR',
      nativePlace: 'Warangal',
    },
    horoscope: {
      birthTime: '04:35',
      birthPlace: 'Warangal',
      nakshatra,
      rashi,
      marsHouse,
    },
    photos: photoColour
      ? [
          (() => {
            // A generated portrait when the faces folder has one, and the
            // drawn silhouette when it does not - so removing those files
            // degrades the demo rather than breaking the seed.
            const stored =
              storeFace(gender) ??
              storeImage('profile-photos', photoColour, {
                width: 480,
                height: 600,
                render: (w, h, c) => portraitPng(w, h, c, gender === 'FEMALE'),
              });
            return {
              id: randomUUID(),
              storageKey: stored.key,
              url: stored.url,
              isPrimary: true,
              moderation: photoModeration,
            };
          })(),
        ]
      : [],
    privacy: { photos: 'MEMBERS_ONLY', showContact: 'ON_MUTUAL_INTEREST' },
    status: 'ACTIVE',
    completeness: 90,
    verified: true,
    createdAt: now,
    updatedAt: now,
  });

  return { profileId: _id, userId, mobile };
}

// The customer also has a matrimony profile, so one login shows both sides.
const selfProfile = id();
await db.collection('matrimony_profiles').insertOne({
  _id: selfProfile,
  userId: customerId,
  displayName: 'Rahul',
  managedBy: 'SELF',
  gender: 'MALE',
  dateOfBirth: yearsAgo(31),
  heightCm: 178,
  maritalStatus: 'NEVER_MARRIED',
  religion: 'Hindu',
  community: 'Brahmin',
  gotra: 'Kashyap',
  motherTongue: 'Telugu',
  city: 'Hyderabad',
  diet: 'VEGETARIAN',
  about:
    'Software engineer in Hyderabad, family originally from Warangal. Looking for someone who values family and independence equally.',
  education: { highestQualification: 'B.Tech', fieldOfStudy: 'Computer Science' },
  career: { occupation: 'Software Engineer', annualIncome: 2_400_000_00 },
  family: {
    fatherOccupation: 'Retired teacher',
    motherOccupation: 'Homemaker',
    brothers: 1,
    sisters: 1,
    familyStatus: 'UPPER_MIDDLE_CLASS',
    familyType: 'NUCLEAR',
    nativePlace: 'Warangal',
  },
  // Hasta / Kanya - scores well against Rohini / Vrishabha below.
  horoscope: { birthTime: '06:10', birthPlace: 'Warangal', nakshatra: 13, rashi: 6 },
  photos: [
    (() => {
      const stored =
        storeNamedFace('rahul') ??
        storeFace('MALE') ??
        storeImage('profile-photos', PALETTE.indigo, {
          width: 480,
          height: 600,
          render: (w, h, c) => portraitPng(w, h, c, false),
        });
      return {
        id: randomUUID(),
        storageKey: stored.key,
        url: stored.url,
        isPrimary: true,
        moderation: 'APPROVED',
      };
    })(),
  ],
  privacy: { photos: 'MEMBERS_ONLY', showContact: 'ON_MUTUAL_INTEREST' },
  status: 'ACTIVE',
  completeness: 90,
  verified: true,
  createdAt: now,
  updatedAt: now,
});

const anita = await profile({
  owner: 'Lakshmi Rao',
  mobile: '9876543214',
  photoColour: PALETTE.rose,
  displayName: 'Anita',
  gender: 'FEMALE',
  age: 28,
  city: 'Hyderabad',
  community: 'Brahmin',
  gotra: 'Bharadwaj',
  occupation: 'Dentist',
  qualification: 'BDS',
  nakshatra: 4, // Rohini
  rashi: 2, // Vrishabha
  managedBy: 'PARENT',
  about:
    'Practising dentist in Hyderabad. Profile managed by her mother. The family is looking for someone settled, ideally in the city.',
});

const priya = await profile({
  owner: 'Priya Menon',
  mobile: '9876543215',
  photoColour: PALETTE.teal,
  displayName: 'Priya',
  gender: 'FEMALE',
  age: 26,
  city: 'Hyderabad',
  community: 'Brahmin',
  gotra: 'Kashyap', // the same gotra as the demo login - excluded by that filter
  occupation: 'Architect',
  qualification: 'B.Arch',
  nakshatra: 1,
  rashi: 1,
  about:
    'Architect working on public housing projects. Same gotra as the demo account, so gotra exclusion hides this profile.',
});

const sneha = await profile({
  owner: 'Sneha Reddy',
  mobile: '9876543216',
  photoColour: PALETTE.plum,
  photoModeration: 'PENDING',
  displayName: 'Sneha',
  gender: 'FEMALE',
  age: 30,
  city: 'Bengaluru',
  community: 'Reddy',
  gotra: 'Vasishta',
  occupation: 'Product Manager',
  qualification: 'MBA',
  nakshatra: 20,
  rashi: 9,
  marsHouse: 7, // manglik, and the demo account is not - the panel says so
  about:
    'Product manager in Bengaluru, open to relocating for the right match. Manglik, so the compatibility panel flags it.',
});

const divya = await profile({
  owner: 'Divya Sharma',
  mobile: '9876543217',
  photoColour: PALETTE.saffron,
  displayName: 'Divya',
  gender: 'FEMALE',
  age: 27,
  city: 'Hyderabad',
  community: 'Brahmin',
  gotra: 'Atri',
  occupation: 'Chartered Accountant',
  qualification: 'CA',
  nakshatra: 13, // same nakshatra as the demo account: shares a nadi, scores 0/8
  rashi: 6,
  about:
    'Chartered accountant. Shares a nadi with the demo account, which is why that koota scores nothing.',
});

// One interest already waiting, so the received tab is not empty on first look.
await db.collection('interests').insertOne({
  _id: id(),
  fromProfileId: anita.profileId,
  toProfileId: selfProfile,
  status: 'SENT',
  message: 'We saw your profile and would like to know more about your family.',
  createdAt: now,
  updatedAt: now,
});

// --------------------------------------------------- one per community

/**
 * A profile for every community on the list.
 *
 * Four hand-written brides are enough to read the screen but not to exercise
 * it: with everyone Hindu and in Hyderabad, the community filter has nothing to
 * choose between and the tiles never show what a mixed page looks like. This
 * fills every community so the filters, the gender split and the photo states
 * all have something behind them.
 *
 * Every community gets both a bride and a groom. The server shows a viewer the
 * opposite gender to their own, so one profile per community would leave half
 * of them invisible to any given account - searching Nair as a groom would come
 * back empty, which reads as a broken filter rather than a seeding choice.
 */

/**
 * Where each language's communities are concentrated. Approximate, and only
 * here so city and mother tongue vary in a way that looks plausible rather
 * than random - a Nair listed as speaking Punjabi reads as a bug.
 */
const REGIONS = [
  ['Telugu', 'Hyderabad', ['Reddy', 'Kamma', 'Kapu', 'Velama', 'Raju', 'Padmashali', 'Mala', 'Madiga', 'Devanga', 'Kummari']],
  ['Tamil', 'Chennai', ['Iyer', 'Iyengar', 'Mudaliar', 'Nadar', 'Thevar', 'Vanniyar', 'Chettiar', 'Pillai', 'Gounder', 'Rowther']],
  ['Malayalam', 'Kochi', ['Nair', 'Ezhava', 'Namboodiri', 'Knanaya', 'Syro-Malabar', 'Syrian Catholic', 'Marthoma', 'Jacobite', 'Latin Catholic', 'Orthodox']],
  ['Kannada', 'Bengaluru', ['Lingayat', 'Vokkaliga', 'Gowda', 'Bhandari', 'Vishwakarma']],
  ['Marathi', 'Pune', ['Maratha', 'Nagar', 'Teli', 'Kunbi']],
  ['Gujarati', 'Ahmedabad', ['Patel', 'Lohana', 'Bhatia', 'Oswal', 'Porwal', 'Vania', 'Bohra', 'Dawoodi Bohra', 'Memon', 'Digambar', 'Shwetambar']],
  ['Punjabi', 'Chandigarh', ['Jat Sikh', 'Ramgarhia', 'Ravidasia', 'Ahluwalia', 'Arora', 'Khatri', 'Saini', 'Kamboj', 'Majhabi', 'Ramdasia', 'Lubana', 'Jat']],
  ['Bengali', 'Kolkata', ['Kayastha', 'Baidya', 'Bene Israel', 'Baghdadi']],
  ['Odia', 'Bhubaneswar', ['Karan', 'Khandayat']],
  ['Urdu', 'Lucknow', ['Ansari', 'Qureshi', 'Sayyid', 'Sheikh', 'Siddiqui', 'Pathan', 'Mughal', 'Shia', 'Sunni', 'Awan', 'Khoja']],
];

const REGION_OF = new Map();
for (const [tongue, city, communities] of REGIONS) {
  for (const c of communities) REGION_OF.set(c, { tongue, city });
}

const BRIDE_NAMES = [
  'Aarthi', 'Ananya', 'Bhavana', 'Chitra', 'Deepa', 'Gayatri', 'Harini', 'Indu',
  'Jyothi', 'Kavya', 'Lavanya', 'Meenakshi', 'Nandini', 'Pallavi', 'Rachana',
  'Shruti', 'Swathi', 'Tanvi', 'Vaishnavi', 'Yamini', 'Aishwarya', 'Bhargavi',
  'Charita', 'Devika', 'Ishita', 'Keerthi', 'Madhuri', 'Namratha', 'Poojitha', 'Ramya',
];
const GROOM_NAMES = [
  'Aditya', 'Bharath', 'Chaitanya', 'Dinesh', 'Ganesh', 'Harsha', 'Karthik',
  'Lokesh', 'Mahesh', 'Naveen', 'Pranav', 'Rakesh', 'Sandeep', 'Tarun', 'Varun',
  'Yashwanth', 'Abhinav', 'Bhaskar', 'Girish', 'Hemanth', 'Jagan', 'Kiran',
  'Manoj', 'Nikhil', 'Praveen', 'Rohit', 'Sudheer', 'Teja', 'Vikram', 'Sricharan',
];

const JOBS = [
  ['Software Engineer', 'B.Tech'], ['Doctor', 'MBBS'], ['Chartered Accountant', 'CA'],
  ['Teacher', 'M.A.'], ['Civil Engineer', 'B.E.'], ['Bank Officer', 'B.Com'],
  ['Architect', 'B.Arch'], ['Pharmacist', 'B.Pharm'], ['Lawyer', 'LLB'],
  ['Product Manager', 'MBA'], ['Data Analyst', 'M.Sc'], ['Dentist', 'BDS'],
];
const DIETS = ['VEGETARIAN', 'VEGETARIAN', 'NON_VEGETARIAN', 'EGGETARIAN'];
const SWATCHES = Object.values(PALETTE);

let n = 0;
for (const [religion, communities] of Object.entries(COMMUNITIES_BY_RELIGION)) {
  for (const community of communities) {
    for (const female of [true, false]) {
      const names = female ? BRIDE_NAMES : GROOM_NAMES;
      const region = REGION_OF.get(community) ?? { tongue: 'Hindi', city: 'Delhi' };
      const [occupation, qualification] = JOBS[n % JOBS.length];

      // Most photos approved, a few pending so the moderation queue has a queue,
      // and a few with none at all so the empty tile state is visible too.
      const photoState = n % 7;

      await profile({
        owner: `${names[n % names.length]} ${community}`,
        mobile: String(9800000001 + n),
        displayName: names[n % names.length],
        gender: female ? 'FEMALE' : 'MALE',
        age: 23 + (n % 12),
        city: region.city,
        community,
        religion,
        motherTongue: region.tongue,
        diet: DIETS[n % DIETS.length],
        gotra: religion === 'Hindu' ? 'Kashyap' : undefined,
        occupation,
        qualification,
        nakshatra: 1 + (n % 27),
        rashi: 1 + (n % 12),
        marsHouse: null,
        photoColour: photoState === 6 ? null : SWATCHES[n % SWATCHES.length],
        photoModeration: photoState === 5 ? 'PENDING' : 'APPROVED',
        about: `${occupation} from ${region.city}. Family is originally from the same district, and looking for someone settled nearby.`,
      });
      n++;
    }
  }
}

console.log(`  ${n} community profiles seeded.`);

// ----------------------------------------------------------------- wedding

const weddingId = id();
await db.collection('weddings').insertOne({
  _id: weddingId,
  customerId,
  coupleNames: { bride: 'Anita', groom: 'Rahul' },
  primaryDate: new Date(Date.UTC(now.getUTCFullYear() + 1, 1, 14)),
  city: 'Hyderabad',
  guestEstimate: 500,
  budgetTotal: 2_000_000_00,
  createdAt: now,
  updatedAt: now,
});

/**
 * One finished booking for the demo customer, with no review on it.
 *
 * Everything downstream of a business rule is normally left for the app to
 * create, and the funnel below stops at the quote for exactly that reason. This
 * is the deliberate exception: a review can only be written against a completed
 * booking, so without one the review form is a screen nobody signing in can
 * reach. The wedding it belongs to is a past one - last February, not the
 * upcoming date - because a booking cannot be complete before it has happened.
 */
const pastWeddingId = id();
const lastFebruary = new Date(Date.UTC(now.getUTCFullYear(), 1, 14));
await db.collection('weddings').insertOne({
  _id: pastWeddingId,
  customerId,
  coupleNames: { bride: 'Anita', groom: 'Rahul' },
  primaryDate: lastFebruary,
  city: 'Hyderabad',
  guestEstimate: 300,
  budgetTotal: 600_000_00,
  createdAt: lastFebruary,
  updatedAt: lastFebruary,
});

const pastBookingId = id();
await db.collection('bookings').insertOne({
  _id: pastBookingId,
  weddingId: pastWeddingId,
  customerId,
  vendorId: photographer.vendorId,
  quoteId: id(),
  category: 'PHOTOGRAPHY',
  status: 'COMPLETED',
  eventDate: lastFebruary,
  totalAmount: 125_000_00,
  paidAmount: 125_000_00,
  advanceAmount: 31_250_00,
  commissionBps: 1000,
  cancellationTiers: [],
  statusHistory: [],
  advanceDueAt: new Date(lastFebruary.getTime() - 45 * 24 * 60 * 60 * 1000),
  createdAt: lastFebruary,
  updatedAt: lastFebruary,
});

/**
 * And the two payments that made it complete.
 *
 * The schedule is built from the payment rows, not from paidAmount, so a
 * booking marked fully paid with no payments behind it renders as ₹0
 * outstanding and both milestones still "not due yet" - a contradiction on
 * screen, and the sort of seeded half-truth that sends someone hunting for a
 * bug in the schedule code.
 */
for (const [milestone, amount, daysBefore] of [
  ['ADVANCE', 31_250_00, 45],
  ['BALANCE', 93_750_00, 7],
]) {
  const paidAt = new Date(lastFebruary.getTime() - daysBefore * 24 * 60 * 60 * 1000);
  await db.collection('payments').insertOne({
    _id: id(),
    purpose: 'BOOKING',
    bookingId: pastBookingId,
    customerId,
    vendorId: photographer.vendorId,
    commissionBps: 1000,
    milestone,
    amount,
    status: 'CAPTURED',
    gatewayOrderId: `order_seed_${milestone.toLowerCase()}`,
    gatewayPaymentId: `pay_seed_${milestone.toLowerCase()}`,
    method: 'upi',
    paidAt,
    refundedAmount: 0,
    refunds: [],
    idempotencyKey: randomUUID(),
    expiresAt: paidAt,
    createdAt: paidAt,
    updatedAt: paidAt,
  });
}

// ------------------------------------------------------------------- funnel

/**
 * Enquiries and quotes, so the screens that only make sense with traffic have
 * some. Stops deliberately at the quote: accepting one is what creates a
 * booking, and doing that here by hand would write a record the slot lock never
 * agreed to. Press Accept in the app and the real path produces it.
 */
if (WITH_FUNNEL) {
  const GST_BPS = 1800;
  const day = 24 * 60 * 60 * 1000;
  const functionDate = new Date(Date.UTC(now.getUTCFullYear() + 1, 1, 14));

  /** Totals are computed the way the server computes them, not typed in. */
  const priced = (items) => {
    const lineItems = items.map(([description, quantity, unitPrice]) => ({
      description,
      quantity,
      unitPrice,
      lineTotal: quantity * unitPrice,
    }));
    const subtotal = lineItems.reduce((sum, l) => sum + l.lineTotal, 0);
    const gstAmount = Math.round((subtotal * GST_BPS) / 10_000);
    return { lineItems, subtotal, gstAmount, total: subtotal + gstAmount };
  };

  // One enquiry, both venues, both answered - which is the state the quote
  // comparison screen exists for.
  const venueEnquiryId = id();
  const quoteFor = {};
  for (const v of [venue, venue2]) quoteFor[v.vendorId.toString()] = id();

  await db.collection('quotes').insertMany([
    {
      _id: quoteFor[venue.vendorId.toString()],
      enquiryId: venueEnquiryId,
      vendorId: venue.vendorId,
      weddingId,
      customerId,
      category: 'VENUE',
      functionDate,
      ...priced([
        ['Full day hall hire, 14 Feb', 1, 400_000_00],
        ['Additional decor package', 1, 85_000_00],
      ]),
      advancePercent: 30,
      validUntil: new Date(now.getTime() + 14 * day),
      notes: 'Includes the bridal suite from 8am and parking for 200 cars.',
      status: 'SENT',
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: quoteFor[venue2.vendorId.toString()],
      enquiryId: venueEnquiryId,
      vendorId: venue2.vendorId,
      weddingId,
      customerId,
      category: 'VENUE',
      functionDate,
      ...priced([
        ['Garden lawn, full day', 1, 320_000_00],
        ['Monsoon backup hall on standby', 1, 40_000_00],
      ]),
      advancePercent: 25,
      validUntil: new Date(now.getTime() + 10 * day),
      notes: 'Lawn plus the covered hall held in reserve at no extra charge.',
      status: 'SENT',
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.collection('enquiries').insertMany([
    {
      _id: venueEnquiryId,
      weddingId,
      customerId,
      category: 'VENUE',
      functionType: 'WEDDING',
      functionDate,
      city: 'Hyderabad',
      guestCount: 500,
      budget: 500_000_00,
      notes: 'Looking for somewhere that can seat 500 with covered parking.',
      vendors: [venue, venue2].map((v) => ({
        vendorId: v.vendorId,
        businessName: v.businessName,
        status: 'QUOTED',
        quoteId: quoteFor[v.vendorId.toString()],
        respondedAt: now,
      })),
      expiresAt: new Date(now.getTime() + day),
      createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      updatedAt: now,
    },
    // A second enquiry nobody has answered yet, so the list is not uniform and
    // the vendor inbox has something waiting on it.
    {
      _id: id(),
      weddingId,
      customerId,
      category: 'CATERING',
      functionType: 'WEDDING',
      functionDate,
      city: 'Hyderabad',
      guestCount: 500,
      notes: 'Pure vegetarian, with a live chaat counter if possible.',
      vendors: [
        {
          vendorId: caterer.vendorId,
          businessName: caterer.businessName,
          status: 'SENT',
        },
      ],
      expiresAt: new Date(now.getTime() + day),
      createdAt: now,
      updatedAt: now,
    },
  ]);
}

// ------------------------------------------------------------------ report

const line = (label, value) => console.log(`  ${label.padEnd(26)} ${value}`);

console.log('  Seeded.\n');
console.log('  Sign in with any of these — password is the same for all:\n');
line('Password', PASSWORD);
console.log('');
line('Customer + matrimony', '9876543210   → /customer and /matrimony');
line('Vendor (venue)', `${venue.mobile}   → /vendor`);
line('Vendor (garden venue)', `${venue2.mobile}   → /vendor`);
line('Vendor (catering)', `${caterer.mobile}   → /vendor`);
line('Vendor (photography)', `${photographer.mobile}   → /vendor`);
line('Admin', '8008052727   → KYC queue, ledger');
console.log('');
// Counted, not described: this line said '4 verified, 6 packages' long
// after it stopped being true.
const vendorCount = await db.collection('vendors').countDocuments({});
const packageCount = await db.collection('vendor_services').countDocuments({});
const catCount = (await db.collection('vendors').distinct('category')).length;
line('Vendors', `${vendorCount} verified across ${catCount} categories, ${packageCount} packages`);
// Read back rather than counted in a variable, so a vendor seeded without
// reviews shows up here as the gap it is.
const rated = await db.collection('vendors').find({ reviewCount: { $gt: 0 } }).toArray();
line(
  'Reviews',
  `${reviewCount} across ${rated.length} vendors - ` +
    rated.map((v) => v.rating.toFixed(1)).join(', '),
);
line('Wedding', '14 Feb next year, Hyderabad, 500 guests');
line('Completed booking', '1 photography booking, awaiting your review');
// Counted rather than described: these numbers moved every time a profile was
// added, and a report that quietly goes stale is worse than no report.
const profileDocs = await db.collection('matrimony_profiles').find({}).toArray();
const photoCount = profileDocs.reduce((sum, d) => sum + (d.photos?.length ?? 0), 0);
const pendingCount = profileDocs.reduce(
  (sum, d) => sum + (d.photos ?? []).filter((ph) => ph.moderation === 'PENDING').length,
  0,
);
const brides = profileDocs.filter((d) => d.gender === 'FEMALE').length;

line('Matrimony profiles', `${profileDocs.length} - ${brides} brides, ${profileDocs.length - brides} grooms`);
line('Communities covered', String(new Set(profileDocs.map((d) => d.community)).size));
const vendorPhotos = (await db.collection('vendors').find({}).toArray())
  .reduce((sum, v) => sum + (v.portfolio?.length ?? 0), 0);
line('Galleries', `${vendorPhotos} vendor photos, ${photoCount} profile photos`);
line('Portraits', `${FACES.FEMALE.length} female, ${FACES.MALE.length} male (generated)`);
line('Awaiting moderation', `${pendingCount} profile photos`);
if (WITH_FUNNEL) {
  line('Enquiries', '2 - one with both venues quoting, one unanswered');
} else {
  console.log('');
  console.log('  Re-run with --funnel for enquiries and quotes to compare.');
}
console.log('');

await mongoose.disconnect();
