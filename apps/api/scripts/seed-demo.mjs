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
 *   npm run seed
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mongoose from 'mongoose';
import * as argon2 from 'argon2';

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

const customerId = await user('Ravindar Balla', '9876500001', [
  'CUSTOMER',
  'SEEKER',
]);
const adminId = await user('Platform Admin', '9876500002', ['ADMIN']);

// ----------------------------------------------------------------- vendors

/** A verified vendor with a catalogue, ready to be found and enquired with. */
async function vendor({ owner, mobile, businessName, category, city, description, services, rating, reviews, responseMins }) {
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
  mobile: '9876500010',
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
  mobile: '9876500011',
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
  mobile: '9876500012',
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
  mobile: '9876500013',
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
  photos,
  managedBy = 'SELF',
  about,
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
    maritalStatus: 'NEVER_MARRIED',
    religion: 'Hindu',
    community,
    gotra,
    motherTongue: 'Telugu',
    city,
    diet: 'VEGETARIAN',
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
    photos: photos ?? [],
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
  photos: [],
  privacy: { photos: 'MEMBERS_ONLY', showContact: 'ON_MUTUAL_INTEREST' },
  status: 'ACTIVE',
  completeness: 90,
  verified: true,
  createdAt: now,
  updatedAt: now,
});

const anita = await profile({
  owner: 'Lakshmi Rao',
  mobile: '9876500020',
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
  mobile: '9876500021',
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
  mobile: '9876500022',
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
  mobile: '9876500023',
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

// ----------------------------------------------------------------- wedding

await db.collection('weddings').insertOne({
  _id: id(),
  customerId,
  coupleNames: { bride: 'Anita', groom: 'Rahul' },
  primaryDate: new Date(Date.UTC(now.getUTCFullYear() + 1, 1, 14)),
  city: 'Hyderabad',
  guestEstimate: 500,
  budgetTotal: 2_000_000_00,
  createdAt: now,
  updatedAt: now,
});

// ------------------------------------------------------------------ report

const line = (label, value) => console.log(`  ${label.padEnd(26)} ${value}`);

console.log('  Seeded.\n');
console.log('  Sign in with any of these — password is the same for all:\n');
line('Password', PASSWORD);
console.log('');
line('Customer + matrimony', '9876500001   → /customer and /matrimony');
line('Vendor (venue)', `${venue.mobile}   → /vendor`);
line('Vendor (garden venue)', `${venue2.mobile}   → /vendor`);
line('Vendor (catering)', `${caterer.mobile}   → /vendor`);
line('Vendor (photography)', `${photographer.mobile}   → /vendor`);
line('Admin', '9876500002   → KYC queue, ledger');
console.log('');
line('Matrimony profiles', `${[anita, priya, sneha, divya].length} published brides`);
line('Vendors', '4 verified, 6 packages');
line('Wedding', '14 Feb next year, Hyderabad, 500 guests');
console.log('');

await mongoose.disconnect();
