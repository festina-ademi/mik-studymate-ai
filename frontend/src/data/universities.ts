/** Student onboarding city options, in display order. "other" opens a free-text fallback. */
export const CITY_IDS = [
  'prishtina',
  'prizren',
  'peja',
  'gjakova',
  'gjilan',
  'mitrovica',
  'ferizaj',
  'tirana',
  'shkup',
  'tetova',
  'other',
] as const;
export type CityId = (typeof CITY_IDS)[number];

/** Universities offered per city, as proper institution names (kept as-is, not translated). */
export const UNIVERSITIES_BY_CITY: Record<Exclude<CityId, 'other'>, string[]> = {
  prishtina: [
    'Universiteti i Prishtinës "Hasan Prishtina"',
    'Universum International College',
    'UBT – University for Business and Technology',
    'AAB College',
    'Kolegji Riinvest',
    'Kolegji ISPE',
  ],
  prizren: ['Universiteti i Prizrenit "Ukshin Hoti"'],
  peja: ['Universiteti "Haxhi Zeka"'],
  gjakova: ['Universiteti "Fehmi Agani"'],
  gjilan: ['Universiteti "Kadri Zeka"'],
  mitrovica: ['Universiteti "Isa Boletini"'],
  ferizaj: ['Kolegji Universum (dega Ferizaj)'],
  tirana: [
    'Universiteti i Tiranës',
    'Universiteti Politeknik i Tiranës',
    'Universiteti Bujqësor i Tiranës',
    'Universiteti i Mjekësisë',
  ],
  shkup: ['Universiteti "Shën Kirili dhe Metodi"', 'Universiteti i Evropës Juglindore (SEEU)'],
  tetova: ['Universiteti i Tetovës', 'Universiteti i Evropës Juglindore (dega Tetovë)'],
};

/** Universities for a city, or an empty list for "other"/an unknown city. */
export function universitiesForCity(city: CityId | null): string[] {
  if (city === null || city === 'other') return [];
  return UNIVERSITIES_BY_CITY[city];
}
