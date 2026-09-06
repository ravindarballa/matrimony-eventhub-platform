/**
 * Religions and communities, for the pickers on the matrimony side.
 *
 * Community is scoped by religion rather than offered as one flat list. India
 * has thousands of communities and almost none of them are shared across
 * religions, so a single dropdown would be unusable and mostly wrong for
 * whoever is reading it. Choosing a religion first cuts the list to something a
 * person can actually scan.
 *
 * These lists are a convenience, not a rulebook. They are nowhere near
 * exhaustive - no such list is - so every picker keeps a free-text escape and
 * the server validates community as an ordinary string. A form that refuses to
 * accept who someone is would be worse than no list at all.
 */

export const RELIGIONS = [
  'Hindu',
  'Muslim',
  'Christian',
  'Sikh',
  'Jain',
  'Buddhist',
  'Parsi',
  'Jewish',
  'Other',
] as const;
export type Religion = (typeof RELIGIONS)[number];

/** The value a picker uses when nothing on the list fits. */
export const OTHER_COMMUNITY = 'Other';

const HINDU = [
  'Agarwal', 'Arora', 'Baniya', 'Bhandari', 'Bhatia', 'Brahmin', 'Chettiar',
  'Devanga', 'Ezhava', 'Gounder', 'Gowda', 'Gupta', 'Iyengar', 'Iyer', 'Jat',
  'Kamma', 'Kapu', 'Kayastha', 'Khatri', 'Kshatriya', 'Kummari', 'Kurmi',
  'Lingayat', 'Lohana', 'Madiga', 'Maheshwari', 'Mala', 'Maratha', 'Marwari',
  'Mudaliar', 'Nadar', 'Nagar', 'Naidu', 'Nair', 'Namboodiri', 'Padmashali',
  'Patel', 'Pillai', 'Raju', 'Rajput', 'Reddy', 'Saini', 'Sindhi', 'Teli',
  'Thevar', 'Vaishnav', 'Vaishya', 'Vanniyar', 'Velama', 'Vishwakarma',
  'Vokkaliga', 'Yadav',
];

const MUSLIM = [
  'Ansari', 'Awan', 'Bohra', 'Dawoodi Bohra', 'Khoja', 'Memon', 'Mughal',
  'Pathan', 'Qureshi', 'Rajput', 'Rowther', 'Sayyid', 'Sheikh', 'Shia',
  'Siddiqui', 'Sunni',
];

const CHRISTIAN = [
  'Anglo-Indian', 'Baptist', 'Born Again', 'CSI', 'Jacobite', 'Knanaya',
  'Latin Catholic', 'Marthoma', 'Methodist', 'Orthodox', 'Pentecostal',
  'Presbyterian', 'Protestant', 'Roman Catholic', 'Seventh-day Adventist',
  'Syrian Catholic', 'Syro-Malabar',
];

const SIKH = [
  'Ahluwalia', 'Arora', 'Bhatia', 'Jat Sikh', 'Kamboj', 'Khatri', 'Lubana',
  'Majhabi', 'Ramdasia', 'Ramgarhia', 'Ravidasia', 'Saini',
];

const JAIN = [
  'Agarwal', 'Bora', 'Digambar', 'Khandelwal', 'Oswal', 'Porwal', 'Shwetambar',
  'Vania',
];

const BUDDHIST = ['Mahayana', 'Navayana', 'Theravada', 'Vajrayana'];

const PARSI = ['Irani', 'Zoroastrian'];

const JEWISH = ['Bene Israel', 'Baghdadi', 'Cochin'];

/**
 * Communities by religion, each already sorted so a picker can render them as
 * they are. 'Other' is appended by `communitiesFor` rather than stored here, so
 * it is always last however a list is edited.
 */
export const COMMUNITIES_BY_RELIGION: Readonly<Record<string, readonly string[]>> = {
  Hindu: HINDU,
  Muslim: MUSLIM,
  Christian: CHRISTIAN,
  Sikh: SIKH,
  Jain: JAIN,
  Buddhist: BUDDHIST,
  Parsi: PARSI,
  Jewish: JEWISH,
  Other: [],
};

/**
 * The options to show once a religion is chosen, with 'Other' last.
 *
 * An unknown religion returns just 'Other', so a picker still renders something
 * usable rather than an empty dropdown.
 */
export function communitiesFor(religion: string): readonly string[] {
  return [...(COMMUNITIES_BY_RELIGION[religion] ?? []), OTHER_COMMUNITY];
}

/** Every community across every religion, de-duplicated and sorted. */
export const ALL_COMMUNITIES: readonly string[] = [
  ...new Set(Object.values(COMMUNITIES_BY_RELIGION).flat()),
].sort((a, b) => a.localeCompare(b));
