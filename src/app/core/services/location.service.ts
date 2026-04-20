import { Injectable } from '@angular/core';
import { from, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

export interface CitySuggestion {
  city: string;
  state: string;
  zip?: string;
  label: string;
}

const STATE_ABBREVS: Record<string, string> = {
  'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
  'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
  'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS',
  'Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA',
  'Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT',
  'Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM',
  'New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK',
  'Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
  'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
  'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY',
};

@Injectable({ providedIn: 'root' })
export class LocationService {

  suggestCities(term: string): Observable<CitySuggestion[]> {
    const t = term.trim();
    if (t.length < 2) return of([]);

    const isZip = /^\d+$/.test(t);
    const params = new URLSearchParams({
      q: t,
      format: 'json',
      limit: '10',
      addressdetails: '1',
      countrycodes: 'us',
      ...(isZip ? {} : { featuretype: 'city' }),
    });

    const req = fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'User-Agent': 'FindAPillar/1.0', 'Accept-Language': 'en' },
    }).then(r => r.json());

    return from(req).pipe(
      map((data: any[]) => {
        const seen = new Set<string>();
        const results: CitySuggestion[] = [];

        for (const item of data ?? []) {
          const addr = item.address ?? {};
          const city = addr.city ?? addr.town ?? addr.village ?? addr.county ?? '';
          const stateRaw = addr.state ?? '';
          const stateAbbr = STATE_ABBREVS[stateRaw] ?? stateRaw;
          const zip = addr.postcode ?? '';

          if (isZip && zip) {
            const key = zip;
            if (seen.has(key)) continue;
            seen.add(key);
            const cityPart = city && stateAbbr ? ` — ${city}, ${stateAbbr}` : '';
            results.push({ city, state: stateAbbr, zip, label: `${zip}${cityPart}` });
          } else if (city && stateAbbr) {
            const key = `${city},${stateAbbr}`;
            if (seen.has(key)) continue;
            seen.add(key);
            results.push({ city, state: stateAbbr, label: `${city}, ${stateAbbr}` });
          }

          if (results.length >= 8) break;
        }
        return results;
      }),
      catchError(() => of([])),
    );
  }
}
