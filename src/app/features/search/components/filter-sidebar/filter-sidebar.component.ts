import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, combineLatest } from 'rxjs';
import { DrawerModule } from 'primeng/drawer';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ChipModule } from 'primeng/chip';
import { DividerModule } from 'primeng/divider';
import { BadgeModule } from 'primeng/badge';
import { FilterService } from '../../../../core/services/filter.service';
import { DenominationService } from '../../../../core/services/denomination.service';
import { ChurchSearchService } from '../../../../core/services/church-search.service';
import { ChurchFilters, DEFAULT_FILTERS, SERVICE_STYLE_OPTIONS, TAG_OPTIONS, activeFilterCount } from '../../../../core/models/filter.model';
import { Denomination } from '../../../../core/models/denomination.model';

// Walk up the tree to find the level-2 ancestor (the "family") of a denomination
function getFamily(flat: Denomination[], id: string): string | null {
  let node = flat.find(d => d.id === id);
  while (node) {
    if (node.level === 2) return node.id;
    node = flat.find(d => d.id === node!.parent_id);
  }
  return null;
}

@Component({
  selector: 'app-filter-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule, DrawerModule, ButtonModule, InputTextModule,
            SelectButtonModule, ChipModule, DividerModule, BadgeModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-drawer [(visible)]="visible" position="right" [style]="{width:'420px'}" styleClass="filter-drawer">
      <ng-template pTemplate="header">
        <div class="filter-header">
          <span class="filter-header__title">Filters</span>
          <button *ngIf="totalActive > 0" class="filter-header__clear" (click)="reset()">
            Clear all
          </button>
        </div>
      </ng-template>

      <div class="filter-body">

        <!-- Tradition (Denomination tree) -->
        <section class="filter-section">
          <h3 class="filter-section__title">Tradition</h3>
          <div class="filter-chips">
            <ng-container *ngFor="let denom of visibleDenomOptions">
              <button
                class="filter-chip"
                [class.filter-chip--active]="isDenomSelected(denom.id)"
                (click)="toggleDenom(denom.id)"
              >{{ denom.name }}</button>
            </ng-container>
          </div>
        </section>

        <p-divider />

        <!-- Worship Style -->
        <section class="filter-section">
          <h3 class="filter-section__title">Worship Style</h3>
          <div class="filter-chips">
            <button
              *ngFor="let s of serviceStyleOptions"
              class="filter-chip"
              [class.filter-chip--active]="draft.serviceStyles.includes(s.value)"
              (click)="toggleServiceStyle(s.value)"
            >{{ s.label }}</button>
          </div>
        </section>

        <p-divider />

        <!-- Church Features / Tags -->
        <section class="filter-section">
          <h3 class="filter-section__title">Church Features</h3>
          <div class="filter-chips filter-chips--wrap">
            <button
              *ngFor="let tag of tagOptions"
              class="filter-chip"
              [class.filter-chip--active]="draft.tags.includes(tag.value)"
              (click)="toggleTag(tag.value)"
            >{{ tag.label }}</button>
          </div>
        </section>

        <p-divider />

        <!-- State -->
        <section class="filter-section">
          <h3 class="filter-section__title">State</h3>
          <input
            pInputText
            placeholder="TX, CA, NY…"
            [(ngModel)]="draft.state"
            maxlength="2"
            class="state-input"
            (input)="draft.state = draft.state.toUpperCase()"
          />
        </section>

      </div>

      <!-- Footer -->
      <ng-template pTemplate="footer">
        <div class="filter-footer">
          <button class="filter-footer__reset" (click)="reset()">Clear all</button>
          <button class="filter-footer__apply" (click)="apply()">
            Apply filters
            <span *ngIf="totalActive > 0" class="filter-footer__badge">{{ totalActive }}</span>
          </button>
        </div>
      </ng-template>
    </p-drawer>
  `,
  styles: [`
    .filter-header {
      display: flex; align-items: center; justify-content: space-between; width: 100%;
    }
    .filter-header__title { font-size: 1rem; font-weight: 600; color: var(--sanctuary-text); }
    .filter-header__clear {
      font-size: 0.75rem; color: var(--sanctuary-muted); background: none; border: none;
      cursor: pointer; text-decoration: underline; padding: 0;
    }
    .filter-header__clear:hover { color: var(--sanctuary-text); }

    .filter-body { padding: 1.25rem 1.5rem; }

    .filter-section { margin-bottom: 0.5rem; }
    .filter-section__title {
      font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.1em;
      text-transform: uppercase; color: #a8a29e; margin: 0 0 0.75rem;
    }

    .filter-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }

    .filter-chip {
      padding: 0.35rem 0.75rem; border-radius: 999px;
      font-size: 0.8rem; font-weight: 500; cursor: pointer;
      border: 1px solid var(--sanctuary-border);
      background: white; color: var(--sanctuary-text);
      transition: all 0.12s;
    }
    .filter-chip:hover { border-color: #a8a29e; background: var(--sanctuary-bg); }
    .filter-chip--active {
      background: var(--sanctuary-text) !important;
      border-color: var(--sanctuary-text) !important;
      color: white !important;
    }

    .state-input {
      width: 6rem !important;
      border-radius: 0.5rem !important;
      font-size: 0.875rem;
    }

    .filter-footer {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1rem 1.5rem; border-top: 1px solid var(--sanctuary-border);
      background: white;
    }
    .filter-footer__reset {
      font-size: 0.8125rem; color: var(--sanctuary-muted); background: none; border: none;
      cursor: pointer; text-decoration: underline; padding: 0;
    }
    .filter-footer__apply {
      flex: 1; max-width: 220px; margin-left: 1rem;
      padding: 0.65rem 1.25rem; border-radius: 999px;
      background: var(--sanctuary-text); color: white;
      font-size: 0.875rem; font-weight: 600; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center; gap: 0.5rem;
      transition: background 0.15s;
    }
    .filter-footer__apply:hover { background: #44403c; }
    .filter-footer__badge {
      background: #F59E0B; color: #1c1917;
      border-radius: 999px; width: 20px; height: 20px;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.6875rem; font-weight: 700;
    }

    ::ng-deep .filter-drawer .p-drawer-footer { padding: 0 !important; }
  `]
})
export class FilterSidebarComponent implements OnInit, OnDestroy {
  visible = false;
  draft: ChurchFilters = { ...DEFAULT_FILTERS };
  allDenominations: Denomination[] = [];
  denominationOptions: Denomination[] = [];
  serviceStyleOptions = SERVICE_STYLE_OPTIONS;
  tagOptions = TAG_OPTIONS;
  resultCount = 0;
  totalActive = 0;

  private destroy$ = new Subject<void>();

  /** Only show denominations from the same level-2 family as current selections */
  get visibleDenomOptions(): Denomination[] {
    if (this.draft.denominationIds.length === 0) return this.denominationOptions;
    const families = new Set(
      this.draft.denominationIds.map(id => getFamily(this.allDenominations, id)).filter(Boolean)
    );
    if (families.size === 0) return this.denominationOptions;
    return this.denominationOptions.filter(d => {
      const family = getFamily(this.allDenominations, d.id);
      return family ? families.has(family) : true;
    });
  }

  constructor(
    private readonly filterService: FilterService,
    private readonly denominationService: DenominationService,
    private readonly searchService: ChurchSearchService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    // Load denominations (level 2 and 3 for the filter UI — skip root "Christian")
    this.denominationService.denominations$
      .pipe(takeUntil(this.destroy$))
      .subscribe(denoms => {
        this.allDenominations = denoms;
        this.denominationOptions = denoms.filter(d => d.level === 2 || d.level === 3);
      });

    // Keep draft in sync with applied filters when drawer opens
    this.filterService.filters$
      .pipe(takeUntil(this.destroy$))
      .subscribe(f => { this.draft = { ...f }; this.totalActive = activeFilterCount(f); });

    // Live result count
    this.searchService.churches$
      .pipe(takeUntil(this.destroy$))
      .subscribe(churches => { this.resultCount = churches.length; });
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  open(): void { this.visible = true; this.cdr.markForCheck(); }

  isDenomSelected(id: string): boolean {
    return this.draft.denominationIds.includes(id);
  }

  toggleDenom(id: string): void {
    const ids = this.draft.denominationIds;
    this.draft = {
      ...this.draft,
      denominationIds: ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id],
    };
  }

  toggleServiceStyle(value: string): void {
    const styles = this.draft.serviceStyles;
    this.draft = {
      ...this.draft,
      serviceStyles: styles.includes(value) ? styles.filter(x => x !== value) : [...styles, value],
    };
  }

  toggleTag(tag: string): void {
    const tags = this.draft.tags;
    this.draft = {
      ...this.draft,
      tags: tags.includes(tag) ? tags.filter(x => x !== tag) : [...tags, tag],
    };
  }

  apply(): void {
    this.filterService.setFilters({ ...this.draft });
    this.visible = false;
  }

  reset(): void {
    this.draft = { ...DEFAULT_FILTERS };
    this.filterService.reset();
    this.visible = false;
  }
}
