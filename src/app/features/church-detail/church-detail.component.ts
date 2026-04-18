import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';
import { SkeletonModule } from 'primeng/skeleton';
import { CardModule } from 'primeng/card';
import { ChurchSearchService } from '../../core/services/church-search.service';
import { Church, ChurchHours, DAY_NAMES, formatTime, getSizeFull } from '../../core/models/church.model';

@Component({
  selector: 'app-church-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, ButtonModule, TagModule, DividerModule, SkeletonModule, CardModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './church-detail.component.html',
  styleUrl: './church-detail.component.scss',
})
export class ChurchDetailComponent implements OnInit {
  church: Church | null = null;
  loading = true;

  readonly DAY_NAMES   = DAY_NAMES;
  readonly formatTime  = formatTime;
  readonly getSizeFull = getSizeFull;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly searchService: ChurchSearchService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.searchService.getChurchBySlug(slug).subscribe(church => {
      this.church = church;
      this.loading = false;
      this.cdr.markForCheck();
    });
  }

  // ── Service times ──────────────────────────────────────────────────────────

  get sortedDays(): number[] {
    const fromMeetingTimes = this.church?.meeting_times
      ? [...new Set(this.church.meeting_times.map(m => m.day_of_week))].sort()
      : [];
    if (fromMeetingTimes.length) return fromMeetingTimes;

    // Fall back to hours JSON
    const hours = this.church?.hours;
    if (!hours) return [];
    return Object.keys(hours).map(Number).sort();
  }

  meetingsForDay(day: number) {
    return (this.church?.meeting_times ?? [])
      .filter(m => m.day_of_week === day)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  hoursForDay(day: number): { open: string; close: string }[] {
    return this.church?.hours?.[String(day)] ?? [];
  }

  // ── Photos ─────────────────────────────────────────────────────────────────

  get allPhotos(): string[] {
    const arr: string[] = [];
    if (this.church?.cover_photo) arr.push(this.church.cover_photo);
    for (const p of this.church?.photos ?? []) {
      if (!arr.includes(p)) arr.push(p);
    }
    return arr.slice(0, 6);
  }

  // ── Pastors ────────────────────────────────────────────────────────────────

  get primaryPastor() { return this.church?.pastors?.find(p => p.is_primary); }
  get otherPastors()  { return this.church?.pastors?.filter(p => !p.is_primary) ?? []; }

  // ── Reviews ────────────────────────────────────────────────────────────────

  get sortedReviews() {
    return (this.church?.church_reviews ?? [])
      .filter(r => r.text)
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, 5);
  }

  starStr(rating: number | null): string {
    if (!rating) return '';
    const full = Math.round(rating);
    return '★'.repeat(full) + '☆'.repeat(5 - full);
  }

  // ── Misc helpers ───────────────────────────────────────────────────────────

  get denomLabel(): string {
    const path = this.church?.denomination_path;
    return path && path.length > 1 ? path[path.length - 1] : (path?.[0] ?? '');
  }

  get hasSocialLinks(): boolean {
    const s = this.church?.social_links;
    return !!(s && (s.facebook || s.instagram || s.youtube || s.twitter || s.tiktok));
  }

  stripProtocol(url: string): string {
    return url.replace(/^https?:\/\//, '');
  }

  get mapsUrl(): string {
    if (!this.church) return '';
    if (this.church.google_maps_url) return this.church.google_maps_url;
    if (this.church.lat && this.church.lng) {
      return `https://www.google.com/maps/search/?api=1&query=${this.church.lat},${this.church.lng}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${this.church.name} ${this.church.street_address} ${this.church.city} ${this.church.state}`
    )}`;
  }
}
