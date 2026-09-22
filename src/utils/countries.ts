/**
 * Country normalization. The geo providers (and legacy data) are inconsistent,
 * some rows stored ISO-3166 alpha-2 codes ("US", "NG"), others full names
 * ("United States of America", "Nigeria"). Everything funnels through `toIso2`
 * so `User.countryCode` is always a clean 2-letter code and the admin dashboard
 * stops double-counting the same country.
 */

// ISO-3166-1 alpha-2 → English display name. Source of truth for both
// directions (name lookup is derived below).
export const ISO2_TO_NAME: Record<string, string> = {
  AF: 'Afghanistan', AX: 'Åland Islands', AL: 'Albania', DZ: 'Algeria', AS: 'American Samoa',
  AD: 'Andorra', AO: 'Angola', AI: 'Anguilla', AQ: 'Antarctica', AG: 'Antigua and Barbuda',
  AR: 'Argentina', AM: 'Armenia', AW: 'Aruba', AU: 'Australia', AT: 'Austria', AZ: 'Azerbaijan',
  BS: 'Bahamas', BH: 'Bahrain', BD: 'Bangladesh', BB: 'Barbados', BY: 'Belarus', BE: 'Belgium',
  BZ: 'Belize', BJ: 'Benin', BM: 'Bermuda', BT: 'Bhutan', BO: 'Bolivia', BA: 'Bosnia and Herzegovina',
  BW: 'Botswana', BR: 'Brazil', IO: 'British Indian Ocean Territory', BN: 'Brunei', BG: 'Bulgaria',
  BF: 'Burkina Faso', BI: 'Burundi', CV: 'Cabo Verde', KH: 'Cambodia', CM: 'Cameroon', CA: 'Canada',
  KY: 'Cayman Islands', CF: 'Central African Republic', TD: 'Chad', CL: 'Chile', CN: 'China',
  CO: 'Colombia', KM: 'Comoros', CG: 'Congo', CD: 'DR Congo', CR: 'Costa Rica', CI: "Côte d'Ivoire",
  HR: 'Croatia', CU: 'Cuba', CW: 'Curaçao', CY: 'Cyprus', CZ: 'Czechia', DK: 'Denmark', DJ: 'Djibouti',
  DM: 'Dominica', DO: 'Dominican Republic', EC: 'Ecuador', EG: 'Egypt', SV: 'El Salvador',
  GQ: 'Equatorial Guinea', ER: 'Eritrea', EE: 'Estonia', SZ: 'Eswatini', ET: 'Ethiopia', FJ: 'Fiji',
  FI: 'Finland', FR: 'France', GF: 'French Guiana', PF: 'French Polynesia', GA: 'Gabon', GM: 'Gambia',
  GE: 'Georgia', DE: 'Germany', GH: 'Ghana', GI: 'Gibraltar', GR: 'Greece', GL: 'Greenland',
  GD: 'Grenada', GP: 'Guadeloupe', GU: 'Guam', GT: 'Guatemala', GG: 'Guernsey', GN: 'Guinea',
  GW: 'Guinea-Bissau', GY: 'Guyana', HT: 'Haiti', HN: 'Honduras', HK: 'Hong Kong', HU: 'Hungary',
  IS: 'Iceland', IN: 'India', ID: 'Indonesia', IR: 'Iran', IQ: 'Iraq', IE: 'Ireland', IM: 'Isle of Man',
  IL: 'Israel', IT: 'Italy', JM: 'Jamaica', JP: 'Japan', JE: 'Jersey', JO: 'Jordan', KZ: 'Kazakhstan',
  KE: 'Kenya', KI: 'Kiribati', KW: 'Kuwait', KG: 'Kyrgyzstan', LA: 'Laos', LV: 'Latvia', LB: 'Lebanon',
  LS: 'Lesotho', LR: 'Liberia', LY: 'Libya', LI: 'Liechtenstein', LT: 'Lithuania', LU: 'Luxembourg',
  MO: 'Macao', MG: 'Madagascar', MW: 'Malawi', MY: 'Malaysia', MV: 'Maldives', ML: 'Mali', MT: 'Malta',
  MH: 'Marshall Islands', MQ: 'Martinique', MR: 'Mauritania', MU: 'Mauritius', MX: 'Mexico',
  FM: 'Micronesia', MD: 'Moldova', MC: 'Monaco', MN: 'Mongolia', ME: 'Montenegro', MS: 'Montserrat',
  MA: 'Morocco', MZ: 'Mozambique', MM: 'Myanmar', NA: 'Namibia', NR: 'Nauru', NP: 'Nepal',
  NL: 'Netherlands', NC: 'New Caledonia', NZ: 'New Zealand', NI: 'Nicaragua', NE: 'Niger', NG: 'Nigeria',
  NU: 'Niue', MK: 'North Macedonia', KP: 'North Korea', NO: 'Norway', OM: 'Oman', PK: 'Pakistan',
  PW: 'Palau', PS: 'Palestine', PA: 'Panama', PG: 'Papua New Guinea', PY: 'Paraguay', PE: 'Peru',
  PH: 'Philippines', PL: 'Poland', PT: 'Portugal', PR: 'Puerto Rico', QA: 'Qatar', RE: 'Réunion',
  RO: 'Romania', RU: 'Russia', RW: 'Rwanda', WS: 'Samoa', SM: 'San Marino', SA: 'Saudi Arabia',
  SN: 'Senegal', RS: 'Serbia', SC: 'Seychelles', SL: 'Sierra Leone', SG: 'Singapore', SX: 'Sint Maarten',
  SK: 'Slovakia', SI: 'Slovenia', SB: 'Solomon Islands', SO: 'Somalia', ZA: 'South Africa',
  KR: 'South Korea', SS: 'South Sudan', ES: 'Spain', LK: 'Sri Lanka', SD: 'Sudan', SR: 'Suriname',
  SE: 'Sweden', CH: 'Switzerland', SY: 'Syria', TW: 'Taiwan', TJ: 'Tajikistan', TZ: 'Tanzania',
  TH: 'Thailand', TL: 'Timor-Leste', TG: 'Togo', TO: 'Tonga', TT: 'Trinidad and Tobago', TN: 'Tunisia',
  TR: 'Türkiye', TM: 'Turkmenistan', TC: 'Turks and Caicos Islands', TV: 'Tuvalu', UG: 'Uganda',
  UA: 'Ukraine', AE: 'United Arab Emirates', GB: 'United Kingdom', US: 'United States', UY: 'Uruguay',
  UZ: 'Uzbekistan', VU: 'Vanuatu', VE: 'Venezuela', VN: 'Vietnam', VG: 'British Virgin Islands',
  VI: 'U.S. Virgin Islands', YE: 'Yemen', ZM: 'Zambia', ZW: 'Zimbabwe',
};

// Common name variants / aliases the providers emit that don't exactly match
// the canonical name above.
const NAME_ALIASES: Record<string, string> = {
  'united states of america': 'US', 'united states': 'US', usa: 'US', 'u.s.a.': 'US', 'u.s.': 'US', america: 'US',
  'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB', britain: 'GB', england: 'GB', scotland: 'GB', wales: 'GB',
  'south korea': 'KR', 'republic of korea': 'KR', korea: 'KR',
  'north korea': 'KP', "democratic people's republic of korea": 'KP',
  russia: 'RU', 'russian federation': 'RU',
  'czech republic': 'CZ', czechia: 'CZ',
  'ivory coast': 'CI', "cote d'ivoire": 'CI', "côte d'ivoire": 'CI',
  'democratic republic of the congo': 'CD', 'dr congo': 'CD', 'congo-kinshasa': 'CD',
  'republic of the congo': 'CG', 'congo-brazzaville': 'CG', congo: 'CG',
  'united republic of tanzania': 'TZ', tanzania: 'TZ',
  vietnam: 'VN', 'viet nam': 'VN',
  iran: 'IR', 'islamic republic of iran': 'IR',
  syria: 'SY', 'syrian arab republic': 'SY',
  laos: 'LA', "lao people's democratic republic": 'LA',
  moldova: 'MD', 'republic of moldova': 'MD',
  tanzania_alt: 'TZ', turkey: 'TR', türkiye: 'TR', turkiye: 'TR',
  'cape verde': 'CV', 'cabo verde': 'CV',
  swaziland: 'SZ', eswatini: 'SZ',
  macedonia: 'MK', 'north macedonia': 'MK',
  burma: 'MM', myanmar: 'MM',
  'east timor': 'TL', 'timor-leste': 'TL',
  uae: 'AE', 'united arab emirates': 'AE',
  'hong kong': 'HK', 'hong kong sar': 'HK', macau: 'MO', macao: 'MO',
  bolivia: 'BO', venezuela: 'VE', 'south sudan': 'SS',
  'palestinian territory': 'PS', palestine: 'PS', 'state of palestine': 'PS',
};

// name (lowercased) → ISO2, built from canonical names + aliases.
const NAME_TO_ISO2: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [code, name] of Object.entries(ISO2_TO_NAME)) m[name.toLowerCase()] = code;
  for (const [alias, code] of Object.entries(NAME_ALIASES)) m[alias] = code;
  return m;
})();

/**
 * Normalize any country value (ISO2 code OR full name, any case) to a clean
 * ISO-3166 alpha-2 code. Returns null if it can't be confidently mapped.
 */
export function toIso2(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;

  // Already a 2-letter code we recognise.
  if (raw.length === 2) {
    const upper = raw.toUpperCase();
    return ISO2_TO_NAME[upper] ? upper : null;
  }
  return NAME_TO_ISO2[raw.toLowerCase()] ?? null;
}

/** ISO2 → display name (falls back to the code itself). */
export function iso2ToName(code: string | null | undefined): string {
  if (!code) return 'Unknown';
  return ISO2_TO_NAME[code.toUpperCase()] ?? code;
}
