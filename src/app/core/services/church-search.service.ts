import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, from, of, switchMap, map, catchError, debounceTime, distinctUntilChanged, shareReplay } from 'rxjs';
import { SupabaseService } from './supabase.service';
import { DenominationService } from './denomination.service';
import { FilterService } from './filter.service';
import { Church } from '../models/church.model';
import { Denomination } from '../models/denomination.model';
import { ChurchFilters } from '../models/filter.model';

@Injectable({ providedIn: 'root' })
export class ChurchSearchService {
  private readonly loadingSubject = new BehaviorSubject<boolean>(true);
  readonly loading$: Observable<boolean> = this.loadingSubject.asObservable();

  private readonly supabase = inject(SupabaseService);
  private readonly denominationService = inject(DenominationService);
  private readonly filterService = inject(FilterService);

  /** The primary church results stream, derived from filter + denomination state. */
  readonly churches$: Observable<Church[]> = combineLatest([
    this.filterService.filters$.pipe(debounceTime(250), distinctUntilChanged()),
    this.denominationService.denominations$,
  ]).pipe(
    switchMap(([filters, denominations]) => {
      this.loadingSubject.next(true);
      return this.fetchAndFilter(filters, denominations);
    }),
    shareReplay(1)
  );

  getChurchBySlug(slug: string): Observable<Church | null> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
    const query = isUuid
      ? this.supabase.db.from('churches').select(CHURCH_SELECT).eq('id', slug).maybeSingle()
      : this.supabase.db.from('churches').select(CHURCH_SELECT).eq('slug', slug).maybeSingle();
    return from(query).pipe(
      map(({ data, error }) => {
        if (error) throw error;
        return data as Church | null;
      }),
      catchError(() => of(null))
    );
  }

  private fetchAndFilter(filters: ChurchFilters, denominations: Denomination[]): Observable<Church[]> {
    return from(this.buildQuery(filters, denominations)).pipe(
      map(results => this.applyClientFilters(results, filters)),
      catchError(err => { console.error(err); return of([]); }),
      switchMap(results => { this.loadingSubject.next(false); return of(results); })
    );
  }

  private async buildQuery(filters: ChurchFilters, denominations: Denomination[]): Promise<Church[]> {
    let query = this.supabase.db
      .from('churches')
      .select(CHURCH_SELECT)
      .eq('is_active', true)
      .order('name')
      .limit(100);

    // Server-side: state filter (precise equality)
    if (filters.state.trim()) {
      query = query.eq('state', filters.state.trim().toUpperCase());
    }

    // Server-side: service style
    if (filters.serviceStyles.length > 0) {
      query = query.in('service_style', filters.serviceStyles);
    }

    // Server-side: denomination (expand selected IDs to include descendants)
    if (filters.denominationIds.length > 0) {
      const expanded = this.denominationService.expandToDescendants(denominations, filters.denominationIds);
      query = query.in('denomination_id', expanded);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as Church[];
  }

  /** Client-side: text search (name, city, denomination path) and tag filtering. */
  private applyClientFilters(churches: Church[], filters: ChurchFilters): Church[] {
    let results = churches;

    if (filters.searchQuery.trim()) {
      const term = filters.searchQuery.trim().toLowerCase();
      results = results.filter(c =>
        c.name.toLowerCase().includes(term) ||
        c.city?.toLowerCase().includes(term) ||
        c.denomination_path?.some(d => d.toLowerCase().includes(term))
      );
    }

    if (filters.tags.length > 0) {
      results = results.filter(c =>
        filters.tags.every(tag => c.church_tags?.some(t => t.tag === tag))
      );
    }

    return results;
  }
}

const CHURCH_SELECT = `
  id, name, slug, description, street_address, city, state, zip,
  lat, lng, website, phone, email, founded_year, average_attendance,
  denomination_id, denomination_path, service_style, cover_photo,
  core_beliefs, size, enriched, is_verified, is_active,
  pastors(*), meeting_times(*), church_tags(*)
`;
