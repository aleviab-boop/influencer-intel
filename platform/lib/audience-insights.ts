// ============================================================
// Audience insights — turns the raw IG demographics blob (gender×age, cities,
// countries) into a readable profile a creator can put in a media kit and a
// brand can act on. Where audience-fit scores ONE brand, this paints the whole
// picture: who your audience is, where they are, how concentrated, and which
// kinds of brands that profile suits.
//
// Pure and deterministic — every number is a share of the demographic totals
// the analytics route already fetched. No ML, no network.
// ============================================================

export interface DemographicsInput {
  gender_age: Record<string, number>;
  cities: Record<string, number>;
  countries: Record<string, number>;
}

export interface AudienceInsights {
  available: boolean;
  headline: string | null;
  dominant: { label: string; share_pct: number } | null;   // "Women 25–34"
  gender: { female_pct: number; male_pct: number; skew: 'female' | 'male' | 'balanced' } | null;
  top_age: { band: string; share_pct: number } | null;
  geo: {
    top_cities: { name: string; share_pct: number }[];
    metro_pct: number | null;
    domestic: { country: string; share_pct: number } | null;
    concentration: 'concentrated' | 'spread' | null;
  } | null;
  insights: string[];
  brand_fit_note: string | null;
}

// Metro/urban markers (India-first).
const METRO_HINTS = ['mumbai', 'delhi', 'bengaluru', 'bangalore', 'hyderabad', 'chennai',
  'kolkata', 'pune', 'ahmedabad', 'gurgaon', 'gurugram', 'noida'];

const sum = (o: Record<string, number>): number =>
  Object.values(o).reduce((s, v) => s + (Number(v) || 0), 0);

const pctOf = (part: number, total: number): number => (total > 0 ? Math.round((part / total) * 100) : 0);

function genderWord(k: string): 'female' | 'male' | 'unknown' {
  const c = k.trim().toLowerCase();
  return c.startsWith('f') ? 'female' : c.startsWith('m') ? 'male' : 'unknown';
}

function bandOf(k: string): string | null {
  const m = k.toLowerCase().match(/\d{1,2}\s*-\s*\d{1,2}|\d{2}\s*\+/);
  return m ? m[0].replace(/\s+/g, '') : null;
}

const nice = (b: string): string => b.replace('-', '–');

/** Cross-tab gender × age into a readable audience profile. */
export function analyzeAudience(demo: DemographicsInput | null | undefined): AudienceInsights {
  const empty: AudienceInsights = {
    available: false, headline: null, dominant: null, gender: null, top_age: null,
    geo: null, insights: [], brand_fit_note: null,
  };
  if (!demo?.gender_age) return empty;

  const gaTotal = sum(demo.gender_age);
  if (gaTotal <= 0) return empty;

  // ---- Gender × age ------------------------------------------------------
  let female = 0, male = 0;
  const byAge: Record<string, number> = {};
  let dominant: { label: string; share_pct: number } | null = null;
  let domMax = 0;

  for (const [key, raw] of Object.entries(demo.gender_age)) {
    const v = Number(raw) || 0;
    if (v <= 0) continue;
    const g = genderWord(key);
    const band = bandOf(key);
    if (g === 'female') female += v;
    else if (g === 'male') male += v;
    if (band) byAge[band] = (byAge[band] ?? 0) + v;

    if (v > domMax && band) {
      domMax = v;
      const gLabel = g === 'female' ? 'Women' : g === 'male' ? 'Men' : 'Followers';
      dominant = { label: `${gLabel} ${nice(band)}`, share_pct: pctOf(v, gaTotal) };
    }
  }

  const femalePct = pctOf(female, gaTotal);
  const malePct = pctOf(male, gaTotal);
  const skew: 'female' | 'male' | 'balanced' =
    femalePct - malePct >= 15 ? 'female' : malePct - femalePct >= 15 ? 'male' : 'balanced';
  const gender = { female_pct: femalePct, male_pct: malePct, skew };

  const topAgeEntry = Object.entries(byAge).sort((a, b) => b[1] - a[1])[0];
  const top_age = topAgeEntry ? { band: nice(topAgeEntry[0]), share_pct: pctOf(topAgeEntry[1], gaTotal) } : null;

  // ---- Geography ---------------------------------------------------------
  let geo: AudienceInsights['geo'] = null;
  const cityTotal = sum(demo.cities ?? {});
  if (cityTotal > 0) {
    const cityEntries = Object.entries(demo.cities).sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0));
    const top_cities = cityEntries.slice(0, 3).map(([name, v]) => ({ name, share_pct: pctOf(Number(v) || 0, cityTotal) }));

    let metro = 0;
    for (const [city, raw] of Object.entries(demo.cities)) {
      const cl = city.toLowerCase();
      if (METRO_HINTS.some((h) => cl.includes(h))) metro += Number(raw) || 0;
    }
    const metro_pct = pctOf(metro, cityTotal);

    // Concentration via a simple Herfindahl index over city shares.
    const hhi = Object.values(demo.cities).reduce((s, v) => {
      const share = (Number(v) || 0) / cityTotal;
      return s + share * share;
    }, 0);
    const concentration: 'concentrated' | 'spread' = hhi >= 0.15 ? 'concentrated' : 'spread';

    // Domestic = top country.
    let domestic: { country: string; share_pct: number } | null = null;
    const ctTotal = sum(demo.countries ?? {});
    if (ctTotal > 0) {
      const top = Object.entries(demo.countries).sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))[0];
      if (top) domestic = { country: top[0], share_pct: pctOf(Number(top[1]) || 0, ctTotal) };
    }

    geo = { top_cities, metro_pct, domestic, concentration };
  }

  // ---- Narrative insights ------------------------------------------------
  const insights: string[] = [];
  if (dominant) insights.push(`Your core audience is ${dominant.label} (${dominant.share_pct}% of followers).`);
  if (skew !== 'balanced') insights.push(`${skew === 'female' ? femalePct : malePct}% ${skew} — a clear ${skew} skew brands can target.`);
  else insights.push(`A balanced ${femalePct}% / ${malePct}% women-to-men split — broad appeal across gendered campaigns.`);
  if (geo?.top_cities.length) {
    insights.push(`Top city: ${geo.top_cities[0]!.name} (${geo.top_cities[0]!.share_pct}%)${geo.metro_pct != null ? `, with ${geo.metro_pct}% in metro cities` : ''}.`);
    insights.push(geo.concentration === 'concentrated'
      ? 'Geographically concentrated — strong for city-specific activations and store visits.'
      : 'Geographically spread — good for national campaigns and wide reach.');
  }

  // ---- Brand-fit note (profile → category suggestions) -------------------
  const bandStart = top_age ? parseInt(top_age.band, 10) : NaN;
  const cats: string[] = [];
  if (skew === 'female') {
    cats.push(bandStart <= 24 ? 'beauty & fashion' : 'beauty, fashion & lifestyle');
    if (bandStart >= 25) cats.push('home & wellness');
  } else if (skew === 'male') {
    cats.push(bandStart <= 24 ? 'tech, gaming & fitness' : 'tech, finance & automotive');
  } else {
    cats.push('food, travel & lifestyle');
  }
  if ((geo?.metro_pct ?? 0) >= 40 && bandStart >= 25) cats.push('premium & finance');
  const brand_fit_note = cats.length
    ? `This profile suits ${cats.slice(0, 2).join(' and ')} brands.`
    : null;

  const headline = dominant
    ? `Mostly ${dominant.label.toLowerCase()}${geo?.top_cities[0] ? `, concentrated in ${geo.top_cities[0].name}` : ''} — ${brand_fit_note ? brand_fit_note.replace(/^This profile suits /, 'ideal for ').replace(/\.$/, '.') : 'a defined audience brands can target.'}`
    : null;

  return {
    available: true,
    headline,
    dominant,
    gender,
    top_age,
    geo,
    insights,
    brand_fit_note,
  };
}
