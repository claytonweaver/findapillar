import {
  Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef,
  ViewChild, ElementRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SkeletonModule } from 'primeng/skeleton';
import { ChipModule } from 'primeng/chip';
import { BadgeModule } from 'primeng/badge';
import { TooltipModule } from 'primeng/tooltip';

import { ChurchSearchService } from '../../core/services/church-search.service';
import { FilterService } from '../../core/services/filter.service';
import { DenominationService } from '../../core/services/denomination.service';
import { Church } from '../../core/models/church.model';
import { ChurchFilters, activeFilterCount } from '../../core/models/filter.model';
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

  private destroy$ = new Subject<void>();
  private searchInput$ = new Subject<string>();
  private cardRefs = new Map<string, HTMLElement>();

  constructor(
    private readonly searchService: ChurchSearchService,
    private readonly filterService: FilterService,
    private readonly denominationService: DenominationService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    // Loading indicator
    this.searchService.loading$
      .pipe(takeUntil(this.destroy$))
      .subscribe(loading => { this.loading = loading; this.cdr.markForCheck(); });

    // Church results
    this.searchService.churches$
      .pipe(takeUntil(this.destroy$))
      .subscribe(churches => { this.churches = churches; this.cdr.markForCheck(); });

    // Active filters (for pill display)
    this.filterService.filters$
      .pipe(takeUntil(this.destroy$))
      .subscribe(f => { this.filters = f; this.searchQuery = f.searchQuery; this.cdr.markForCheck(); });

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
    this.searchInput$.next(value);
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.filterService.patchFilter('searchQuery', '');
  }

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
