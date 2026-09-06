/**
 * Seeds a demo dataset: accounts you can sign into, verified vendors with real
 * catalogues, and published matrimony profiles.
 *
 * It writes straight to Mongo rather than driving the API, for two reasons: the
 * OTP endpoints are rate limited to 5/min and a seed would trip them, and a
 * seed should be re-runnable without a running server.
 *
 * What it deliberately does NOT seed is anything downstream of a business rule
 * - no bookings, no payments, no ledger entries. Those are what you walk
 * through in the app, and inventing them here would produce records the real
 * code paths would never have created.
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
    rating,
    reviewCount: reviews,
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
      siblings: 1,
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
    siblings: 1,
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
line('Vendors', '4 verified, 6 packages');
line('Wedding', '14 Feb next year, Hyderabad, 500 guests');
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
line('Galleries', `10 vendor photos, ${photoCount} profile photos`);
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
