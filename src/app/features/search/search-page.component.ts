import {
  Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef,
  ViewChild, ElementRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subject, takeUntil, debounceTime, distinctUntilChanged, take, switchMap } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SkeletonModule } from 'primeng/skeleton';
import { ChipModule } from 'primeng/chip';
import { BadgeModule } from 'primeng/badge';
import { TooltipModule } from 'primeng/tooltip';

import { ChurchSearchService } from '../../core/services/church-search.service';
import { FilterService } from '../../core/services/filter.service';
import { DenominationService } from '../../core/services/denomination.service';
import { LocationService, CitySuggestion } from '../../core/services/location.service';
import { Church } from '../../core/models/church.model';
import { ChurchFilters, activeFilterCount, DEFAULT_FILTERS } from '../../core/models/filter.model';
import { ChurchCardComponent } from './components/church-card/church-card.component';
import { FilterSidebarComponent } from './components/filter-sidebar/filter-sidebar.component';
import { ChurchMapComponent } from './components/church-map/church-map.component';

@Component({
  selector: 'app-search-page',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule,
    ButtonModule, InputTextModule, SkeletonModule, ChipModule, BadgeModule, TooltipModule,
    ChurchCardComponent, FilterSidebarComponent, ChurchMapComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './search-page.component.html',
  styleUrl: './search-page.component.scss',
})
export class SearchPageComponent implements OnInit, OnDestroy {
  @ViewChild(FilterSidebarComponent) filterSidebar!: FilterSidebarComponent;
  @ViewChild('listPanel') listPanelRef!: ElementRef<HTMLDivElement>;

  churches: Church[] = [];
  loading = true;
  showMap = true;
  searchQuery = '';
  filters!: ChurchFilters;
  hoveredId: string | null = null;
  selectedId: string | null = null;
  denomNames = new Map<string, string>();
  drawPolygon: [number, number][] | null = null;

  suggestions: CitySuggestion[] = [];
  showSuggestions = false;

  private destroy$ = new Subject<void>();
  private searchInput$ = new Subject<string>();
  private cityInput$ = new Subject<string>();
  private cardRefs = new Map<string, HTMLElement>();

  constructor(
    private readonly searchService: ChurchSearchService,
    private readonly filterService: FilterService,
    private readonly denominationService: DenominationService,
    private readonly locationService: LocationService,
    private readonly cdr: ChangeDetectorRef,
    private readonly route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    // Apply location from query params (e.g. navigated from home page)
    this.route.queryParams.pipe(take(1)).subscribe(params => {
      if (params['zip']) {
        this.filterService.setFilters({ ...DEFAULT_FILTERS, zip: params['zip'] });
      } else if (params['city'] || params['state']) {
        this.filterService.setFilters({
          ...DEFAULT_FILTERS,
          city: params['city'] ?? '',
          state: params['state'] ?? '',
        });
      } else if (params['location']) {
        this.filterService.setFilters({
          ...DEFAULT_FILTERS,
          ...parseLocation(params['location']),
        });
      }
    });

    // Loading indicator
    this.searchService.loading$
      .pipe(takeUntil(this.destroy$))
      .subscribe(loading => { this.loading = loading; this.cdr.markForCheck(); });

    // Church results
    this.searchService.churches$
      .pipe(takeUntil(this.destroy$))
      .subscribe(churches => { this.churches = churches; this.cdr.markForCheck(); });

    // Active filters (for pill display); show city label in search box when city filter is active
    this.filterService.filters$
      .pipe(takeUntil(this.destroy$))
      .subscribe(f => {
        this.filters = f;
        this.searchQuery = f.zip
          ? f.zip
          : f.city
            ? (f.state ? `${f.city}, ${f.state}` : f.city)
            : f.searchQuery;
        this.cdr.markForCheck();
      });

    // City suggestions
    this.cityInput$.pipe(
      debounceTime(200),
      distinctUntilChanged(),
      switchMap(term => this.locationService.suggestCities(term)),
      takeUntil(this.destroy$),
    ).subscribe(s => { this.suggestions = s; this.showSuggestions = s.length > 0; this.cdr.markForCheck(); });

    // Denomination name map for filter pills
    this.denominationService.denominations$
      .pipe(takeUntil(this.destroy$))
      .subscribe(denoms => {
        this.denomNames = new Map(denoms.map(d => [d.id, d.name]));
        this.cdr.markForCheck();
      });

    // Debounced search input → FilterService
    this.searchInput$.pipe(
      debounceTime(200),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(q => this.filterService.patchFilter('searchQuery', q));
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  onSearchChange(value: string): void {
    // Full 5-digit zip
    if (/^\d{5}$/.test(value.trim())) {
      this.showSuggestions = false;
      this.filterService.setFilters({ ...DEFAULT_FILTERS, zip: value.trim() });
      return;
    }
    const cityState = parseCityState(value);
    if (cityState) {
      this.showSuggestions = false;
      this.filterService.setFilters({
        ...this.filterService.current,
        city: cityState.city,
        state: cityState.state,
        searchQuery: '',
      });
      return;
    }
    this.cityInput$.next(value);
    this.searchInput$.next(value);
  }

  selectSuggestion(s: CitySuggestion): void {
    this.showSuggestions = false;
    this.filterService.setFilters({
      ...DEFAULT_FILTERS,
      ...(s.zip ? { zip: s.zip } : { city: s.city, state: s.state }),
    });
  }

  hideSuggestions(): void {
    setTimeout(() => { this.showSuggestions = false; this.cdr.markForCheck(); }, 150);
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.suggestions = [];
    this.showSuggestions = false;
    this.filterService.setFilters({ ...DEFAULT_FILTERS });
  }

  clearCity(): void { this.filterService.patchFilter('city', ''); }

  openFilters(): void {
    this.filterSidebar.open();
  }

  removeFilterDenom(id: string): void {
    const ids = this.filters.denominationIds.filter(x => x !== id);
    this.filterService.patchFilter('denominationIds', ids);
  }

  removeServiceStyle(s: string): void {
    this.filterService.patchFilter('serviceStyles', this.filters.serviceStyles.filter(x => x !== s));
  }

  removeTag(tag: string): void {
    this.filterService.patchFilter('tags', this.filters.tags.filter(x => x !== tag));
  }

  clearState(): void { this.filterService.patchFilter('state', ''); }

  clearAll(): void { this.filterService.reset(); this.searchQuery = ''; }

  get locationLabel(): string {
    if (this.filters?.zip) return this.filters.zip;
    if (this.filters?.city && this.filters?.state) return `${this.filters.city}, ${this.filters.state}`;
    return this.filters?.city ?? '';
  }

  clearLocation(): void {
    this.filterService.setFilters({ ...this.filterService.current, city: '', state: '', zip: '' });
  }

  get activeFilterCount(): number { return activeFilterCount(this.filters ?? {}  as ChurchFilters); }

  get hasActiveFilters(): boolean { return this.activeFilterCount > 0; }

  onPolygonFilter(polygon: [number, number][] | null): void {
    this.drawPolygon = polygon;
    this.cdr.markForCheck();
  }

  get filteredChurches(): Church[] {
    if (!this.drawPolygon) return this.churches;
    return this.churches.filter(c =>
      c.lat && c.lng && pointInPolygon([c.lat, c.lng], this.drawPolygon!)
    );
  }

  get mappableChurches(): Church[] {
    return this.filteredChurches.filter(c => c.lat && c.lng);
  }

  registerCardRef(id: string, el: HTMLElement | null): void {
    if (el) this.cardRefs.set(id, el);
    else this.cardRefs.delete(id);
  }

  onMapSelect(church: Church | null): void {
    this.selectedId = church?.id ?? null;
    if (church) {
      const el = this.cardRefs.get(church.id);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    this.cdr.markForCheck();
  }

  onCardSelect(id: string): void {
    this.selectedId = this.selectedId === id ? null : id;
    this.cdr.markForCheck();
  }

  onCardHover(id: string | null): void {
    this.hoveredId = id;
    this.cdr.markForCheck();
  }

  clearSelection(): void { this.selectedId = null; this.cdr.markForCheck(); }

  getDenomName(id: string): string {
    return this.denomNames.get(id) ?? id;
  }

  skeletons = Array(5);
  trackById = (_: number, c: Church) => c.id;
  get displayChurches(): Church[] { return this.drawPolygon ? this.filteredChurches : this.churches; }
}

const STATE_NAMES: Record<string, string> = {
  alabama:'AL',alaska:'AK',arizona:'AZ',arkansas:'AR',california:'CA',
  colorado:'CO',connecticut:'CT',delaware:'DE',florida:'FL',georgia:'GA',
  hawaii:'HI',idaho:'ID',illinois:'IL',indiana:'IN',iowa:'IA',kansas:'KS',
  kentucky:'KY',louisiana:'LA',maine:'ME',maryland:'MD',massachusetts:'MA',
  michigan:'MI',minnesota:'MN',mississippi:'MS',missouri:'MO',montana:'MT',
  nebraska:'NE',nevada:'NV','new hampshire':'NH','new jersey':'NJ',
  'new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND',
  ohio:'OH',oklahoma:'OK',oregon:'OR',pennsylvania:'PA','rhode island':'RI',
  'south carolina':'SC','south dakota':'SD',tennessee:'TN',texas:'TX',
  utah:'UT',vermont:'VT',virginia:'VA',washington:'WA','west virginia':'WV',
  wisconsin:'WI',wyoming:'WY',
};

function parseCityState(input: string): { city: string; state: string } | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^([a-zA-Z\s]+?),?\s+([a-zA-Z]{2})$/);
  if (!match) return null;
  const stateAbbr = match[2].toUpperCase();
  const validStates = new Set(Object.values(STATE_NAMES));
  if (!validStates.has(stateAbbr)) return null;
  return { city: match[1].trim(), state: stateAbbr };
}

function parseLocation(raw: string): Partial<{ state: string; searchQuery: string }> {
  const trimmed = raw.trim();
  // "Detroit, MI" or "Wayne County, MI" or "Detroit, Michigan"
  const commaMatch = trimmed.match(/^(.+),\s*([A-Za-z\s]+)$/);
  if (commaMatch) {
    const regionRaw = commaMatch[1].trim();
    const stateRaw = commaMatch[2].trim();
    const stateAbbr = stateRaw.length === 2
      ? stateRaw.toUpperCase()
      : STATE_NAMES[stateRaw.toLowerCase()];
    if (stateAbbr) {
      // County-level input — don't put "Wayne County" in the search box
      const isCounty = /county/i.test(regionRaw);
      return { state: stateAbbr, ...(isCounty ? {} : { searchQuery: regionRaw }) };
    }
  }
  // Just a 2-letter state code
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const abbr = trimmed.toUpperCase();
    if (Object.values(STATE_NAMES).includes(abbr)) return { state: abbr };
  }
  // State name only
  const byName = STATE_NAMES[trimmed.toLowerCase()];
  if (byName) return { state: byName };
  // Fallback: use as text search
  return { searchQuery: trimmed };
}

function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  const [lat, lng] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [lati, lngi] = polygon[i];
    const [latj, lngj] = polygon[j];
    if ((lngi > lng) !== (lngj > lng) && lat < (latj - lati) * (lng - lngi) / (lngj - lngi) + lati) {
      inside = !inside;
    }
  }
  return inside;
}
