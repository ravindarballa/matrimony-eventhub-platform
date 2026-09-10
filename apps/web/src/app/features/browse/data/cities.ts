/**
 * The cities the marketplace covers.
 *
 * A free-text city box looks flexible and is not: "bangalore", "Bangalore" and
 * "Bengaluru" are three different searches over the same vendors, and a family
 * who types the third one concludes the site is empty. A fixed list is also an
 * honest statement of where there is actually supply.
 *
 * Hyderabad leads because that is where the seeded vendors are.
 */
export const CITIES = [
  'Hyderabad',
  'Bengaluru',
  'Chennai',
  'Mumbai',
  'Delhi NCR',
  'Pune',
  'Kolkata',
  'Ahmedabad',
  'Jaipur',
  'Kochi',
  'Vijayawada',
  'Visakhapatnam',
] as const;

export type City = (typeof CITIES)[number];
