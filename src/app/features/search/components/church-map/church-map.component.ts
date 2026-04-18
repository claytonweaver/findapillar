import {
  Component, Input, Output, EventEmitter, OnDestroy,
  OnChanges, SimpleChanges, ElementRef, ViewChild, AfterViewInit,
  ChangeDetectionStrategy, NgZone, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Church, formatAttendance, getSizeLabel } from '../../../../core/models/church.model';

// ── Zoom strategy thresholds ──────────────────────────────────────────────────
const ZOOM_STATE   = 5;   // ≤ this → show per-state count bubbles
const ZOOM_CLUSTER = 11;  // ≤ this → show grid-clustered markers
                          // > ZOOM_CLUSTER → individual church pill markers

// Grid cell sizes (degrees) by zoom level
function gridSize(zoom: number): number {
  if (zoom <= 6) return 2.0;
  if (zoom <= 7) return 1.0;
  if (zoom <= 8) return 0.5;
  return 0.25;
}

// Approximate US state centroids
const STATE_CENTERS: Record<string, [number, number]> = {
  AL: [32.81, -86.79], AK: [61.37, -152.40], AZ: [33.73, -111.43], AR: [34.97, -92.37],
  CA: [36.12, -119.68], CO: [39.06, -105.31], CT: [41.60, -72.76], DE: [39.32, -75.51],
  FL: [27.77, -81.69], GA: [33.04, -83.64], HI: [21.09, -157.50], ID: [44.24, -114.48],
  IL: [40.35, -88.99], IN: [39.85, -86.26], IA: [42.01, -93.21], KS: [38.53, -96.73],
  KY: [37.67, -84.67], LA: [31.17, -91.87], ME: [44.69, -69.38], MD: [39.06, -76.80],
  MA: [42.23, -71.53], MI: [43.33, -84.54], MN: [45.69, -93.90], MS: [32.74, -89.68],
  MO: [38.46, -92.29], MT: [46.92, -110.45], NE: [41.13, -98.27], NV: [38.31, -117.06],
  NH: [43.45, -71.56], NJ: [40.30, -74.52], NM: [34.84, -106.25], NY: [42.17, -74.95],
  NC: [35.63, -79.81], ND: [47.53, -99.78], OH: [40.39, -82.76], OK: [35.57, -96.93],
  OR: [44.57, -122.07], PA: [40.59, -77.21], RI: [41.68, -71.51], SC: [33.86, -80.95],
  SD: [44.30, -99.44], TN: [35.75, -86.69], TX: [31.05, -97.56], UT: [40.15, -111.86],
  VT: [44.05, -72.71], VA: [37.77, -78.17], WA: [47.40, -121.49], WV: [38.49, -80.95],
  WI: [44.27, -89.62], WY: [42.76, -107.30], DC: [38.90, -77.03],
};

interface ClusterGroup {
  lat: number;
  lng: number;
  count: number;
  churches: Church[];
}

interface StateGroup {
  state: string;
  count: number;
  lat: number;
  lng: number;
}

@Component({
  selector: 'app-church-map',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="map-wrap">
      <!-- Toolbar -->
      <div class="map-toolbar">
        @if (!drawMode && !drawnPolygon) {
          <button class="map-tool-btn" (click)="startDraw()" title="Draw area to filter">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 17c2-2 4-4 7-4s5 2 7 4"/><path d="M3 7c2 2 4 4 7 4s5-2 7-4"/>
            </svg>
            Draw area
          </button>
        }
        @if (drawMode) {
          <button class="map-tool-btn map-tool-btn--active" (click)="cancelDraw()">Cancel</button>
          <span class="map-tool-hint">{{ isDrawing ? 'Release to apply' : 'Hold and drag to draw' }}</span>
        }
        @if (drawnPolygon) {
          <button class="map-tool-btn map-tool-btn--clear" (click)="clearDraw()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
            Clear area
          </button>
        }
      </div>

      <div #mapEl class="map-container" [class.map-container--draw]="drawMode"></div>

      <!-- Floating selected card -->
      @if (selectedChurch) {
        <div class="map-preview">
          <div class="map-preview__inner">
            <div class="map-preview__content">
              @if (selectedChurch.cover_photo) {
                <div class="map-preview__thumb">
                  <img [src]="selectedChurch.cover_photo" [alt]="selectedChurch.name" />
                </div>
              }
              <div class="map-preview__info">
                @if (denomLabel) {
                  <p class="map-preview__denom">{{ denomLabel }}</p>
                }
                <p class="map-preview__name">{{ selectedChurch.name }}</p>
                <p class="map-preview__city">{{ selectedChurch.city }}, {{ selectedChurch.state }}</p>
                @if (selectedChurch.google_rating) {
                  <p class="map-preview__rating">
                    <span class="stars">{{ starStr(selectedChurch.google_rating) }}</span>
                    <span class="rating-num">{{ selectedChurch.google_rating }}</span>
                    @if (selectedChurch.google_review_count) {
                      <span class="review-count">({{ selectedChurch.google_review_count | number }})</span>
                    }
                  </p>
                } @else if (selectedChurch.average_attendance) {
                  <p class="map-preview__att">{{ formatAtt(selectedChurch.average_attendance) }} avg. attendance</p>
                }
              </div>
            </div>
            <div class="map-preview__actions">
              <button class="map-preview__dismiss" (click)="selectChurch.emit(null)">Dismiss</button>
              <a class="map-preview__view" [routerLink]="['/church', selectedChurch.slug || selectedChurch.id]">
                View church →
              </a>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: flex; flex: 1; width: 100%; height: 100%; flex-direction: column; }
    .map-wrap { width: 100%; height: 100%; position: relative; display: flex; flex-direction: column; }
    .map-container { flex: 1; width: 100%; }
    .map-container--draw { cursor: crosshair !important; }
    .map-container--draw .leaflet-grab { cursor: crosshair !important; }

    .map-toolbar {
      position: absolute; top: 0.75rem; right: 0.75rem; z-index: 1000;
      display: flex; align-items: center; gap: 0.5rem;
    }
    .map-tool-btn {
      display: flex; align-items: center; gap: 0.375rem;
      padding: 0.4rem 0.75rem; border-radius: 999px;
      background: white; border: 1.5px solid var(--sanctuary-border);
      font-size: 0.75rem; font-weight: 600; color: var(--sanctuary-text);
      cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,0.12); transition: all 0.12s;
    }
    .map-tool-btn:hover { background: var(--sanctuary-bg); border-color: #a8a29e; }
    .map-tool-btn--active { background: #fee2e2; border-color: #fca5a5; color: #dc2626; }
    .map-tool-btn--clear  { background: #fee2e2; border-color: #fca5a5; color: #dc2626; }
    .map-tool-btn--clear:hover { background: #fecaca; }
    .map-tool-hint {
      background: rgba(255,255,255,0.9); padding: 0.35rem 0.75rem;
      border-radius: 999px; font-size: 0.75rem; color: var(--sanctuary-muted);
      box-shadow: 0 1px 4px rgba(0,0,0,0.1);
    }

    .map-preview {
      position: absolute; bottom: 1.5rem; left: 50%; transform: translateX(-50%);
      z-index: 1000; width: 340px; max-width: 90%;
    }
    .map-preview__inner {
      background: white; border-radius: 1rem;
      box-shadow: 0 8px 32px rgba(0,0,0,0.14);
      border: 1px solid var(--sanctuary-border); overflow: hidden;
    }
    .map-preview__content { display: flex; gap: 0.75rem; padding: 0.875rem; }
    .map-preview__thumb {
      width: 76px; height: 76px; border-radius: 0.6rem; overflow: hidden;
      flex-shrink: 0; background: #ede9e3;
    }
    .map-preview__thumb img { width: 100%; height: 100%; object-fit: cover; }
    .map-preview__info { flex: 1; min-width: 0; }
    .map-preview__denom {
      font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--sanctuary-accent); margin: 0 0 0.2rem;
    }
    .map-preview__name {
      font-size: 0.9rem; font-weight: 600; color: var(--sanctuary-text);
      margin: 0 0 0.2rem; line-height: 1.3;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .map-preview__city, .map-preview__att { font-size: 0.75rem; color: var(--sanctuary-muted); margin: 0; }
    .map-preview__rating { display: flex; align-items: center; gap: 0.25rem; margin: 0; }
    .stars { color: #F59E0B; font-size: 0.7rem; letter-spacing: -0.05em; }
    .rating-num { font-size: 0.75rem; font-weight: 600; color: var(--sanctuary-text); }
    .review-count { font-size: 0.7rem; color: var(--sanctuary-muted); }
    .map-preview__actions { display: flex; border-top: 1px solid var(--sanctuary-border); }
    .map-preview__dismiss, .map-preview__view {
      flex: 1; padding: 0.65rem; font-size: 0.75rem; font-weight: 600;
      text-align: center; cursor: pointer; border: none; background: none; transition: background 0.12s;
    }
    .map-preview__dismiss { color: var(--sanctuary-muted); }
    .map-preview__dismiss:hover { background: var(--sanctuary-bg); color: var(--sanctuary-text); }
    .map-preview__view {
      color: var(--sanctuary-accent); text-decoration: none;
      border-left: 1px solid var(--sanctuary-border);
    }
    .map-preview__view:hover { background: #fef3e2; }
  `]
})
export class ChurchMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('mapEl') mapElRef!: ElementRef<HTMLDivElement>;
  @Input() churches: Church[] = [];
  @Input() hoveredChurchId: string | null = null;
  @Input() selectedChurchId: string | null = null;
  @Output() selectChurch  = new EventEmitter<Church | null>();
  @Output() polygonFilter = new EventEmitter<[number, number][] | null>();

  selectedChurch: Church | null = null;
  formatAtt = formatAttendance;

  drawMode = false;
  isDrawing = false;
  drawPoints: [number, number][] = [];
  drawnPolygon: any = null;

  private map: any;
  private currentZoom = 4;
  private leafletLoaded = false;
  private previewPolyline: any = null;
  private drawMousedownHandler: any = null;
  private drawMousemoveHandler: any = null;
  private drawMouseupHandler: any = null;

  // Active markers keyed by a render-layer-specific id
  private activeMarkers: any[] = [];

  constructor(private zone: NgZone, private cdr: ChangeDetectorRef) {}

  get denomLabel(): string {
    const path = this.selectedChurch?.denomination_path;
    return path && path.length > 1 ? path[path.length - 1] : (path?.[0] ?? '');
  }

  starStr(rating: number): string {
    const full  = Math.round(rating);
    return '★'.repeat(full) + '☆'.repeat(5 - full);
  }

  async ngAfterViewInit(): Promise<void> {
    await this.loadLeaflet();
    this.initMap();
    this.syncMarkers();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.map) return;
    if (changes['churches']) this.syncMarkers();
    if (changes['selectedChurchId']) {
      this.selectedChurch = this.churches.find(c => c.id === this.selectedChurchId) ?? null;
      this.updateIndividualMarkerStyles();
      this.cdr.markForCheck();
    }
    if (changes['hoveredChurchId']) this.updateIndividualMarkerStyles();
  }

  ngOnDestroy(): void { this.map?.remove(); }

  // ── Drawing ──────────────────────────────────────────────────────────────────

  startDraw(): void {
    this.drawMode = true;
    this.isDrawing = false;
    this.drawPoints = [];
    this.cdr.markForCheck();

    const L = (window as any).L;

    this.drawMousedownHandler = (e: any) => {
      if (e.originalEvent?.button !== 0) return;
      e.originalEvent?.preventDefault();
      this.isDrawing = true;
      this.map.dragging.disable();
      this.drawPoints = [[e.latlng.lat, e.latlng.lng]];
      this.zone.run(() => this.cdr.markForCheck());
    };

    this.drawMousemoveHandler = (e: any) => {
      if (!this.isDrawing) return;
      const last = this.drawPoints[this.drawPoints.length - 1];
      if (last) {
        const lastPt = this.map.latLngToContainerPoint(L.latLng(last[0], last[1]));
        const currPt = this.map.latLngToContainerPoint(e.latlng);
        const dx = currPt.x - lastPt.x;
        const dy = currPt.y - lastPt.y;
        if (dx * dx + dy * dy < 36) return;
      }
      this.drawPoints.push([e.latlng.lat, e.latlng.lng]);
      this.updatePreviewLine();
    };

    this.drawMouseupHandler = () => {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      this.map.dragging.enable();
      this.zone.run(() => {
        if (this.drawPoints.length >= 3) this.finishDraw();
        else this.cancelDraw();
      });
    };

    this.map.on('mousedown', this.drawMousedownHandler);
    this.map.on('mousemove', this.drawMousemoveHandler);
    this.map.on('mouseup', this.drawMouseupHandler);
  }

  finishDraw(): void {
    const L = (window as any).L;
    this.drawMode = false;
    this.isDrawing = false;
    this.removePreviews();
    if (this.drawPoints.length >= 3) {
      this.drawnPolygon = L.polygon(this.drawPoints, {
        color: '#9A3412', weight: 2, fillColor: '#9A3412', fillOpacity: 0.08, dashArray: '4 4',
      }).addTo(this.map);
      this.map.fitBounds(this.drawnPolygon.getBounds(), { padding: [40, 40] });
      this.polygonFilter.emit([...this.drawPoints]);
    }
    this.cleanupDrawListeners();
    this.cdr.markForCheck();
  }

  cancelDraw(): void {
    this.drawMode = false;
    this.isDrawing = false;
    this.drawPoints = [];
    this.removePreviews();
    this.map.dragging.enable();
    this.cleanupDrawListeners();
    this.cdr.markForCheck();
  }

  clearDraw(): void {
    if (this.drawnPolygon) { this.drawnPolygon.remove(); this.drawnPolygon = null; }
    this.drawPoints = [];
    this.polygonFilter.emit(null);
    this.cdr.markForCheck();
  }

  private updatePreviewLine(): void {
    const L = (window as any).L;
    if (this.drawPoints.length < 2) return;
    if (this.previewPolyline) this.previewPolyline.setLatLngs(this.drawPoints);
    else this.previewPolyline = L.polyline(this.drawPoints, { color: '#9A3412', weight: 2, dashArray: '6 4', opacity: 0.7 }).addTo(this.map);
  }

  private removePreviews(): void {
    if (this.previewPolyline) { this.previewPolyline.remove(); this.previewPolyline = null; }
  }

  private cleanupDrawListeners(): void {
    if (this.drawMousedownHandler) { this.map.off('mousedown', this.drawMousedownHandler); this.drawMousedownHandler = null; }
    if (this.drawMousemoveHandler) { this.map.off('mousemove', this.drawMousemoveHandler); this.drawMousemoveHandler = null; }
    if (this.drawMouseupHandler)   { this.map.off('mouseup',   this.drawMouseupHandler);   this.drawMouseupHandler   = null; }
  }

  // ── Map init ─────────────────────────────────────────────────────────────────

  private async loadLeaflet(): Promise<void> {
    if (this.leafletLoaded) return;
    const L = await import('leaflet');
    (window as any).L = (L as any).default ?? L;
    this.leafletLoaded = true;
  }

  private initMap(): void {
    const L = (window as any).L;
    this.map = L.map(this.mapElRef.nativeElement, {
      center: [39.5, -98.35], zoom: 4,
      zoomControl: true, scrollWheelZoom: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19,
    }).addTo(this.map);

    this.currentZoom = this.map.getZoom();
    this.map.on('zoomend', () => {
      this.zone.run(() => {
        this.currentZoom = this.map.getZoom();
        this.syncMarkers();
        this.cdr.markForCheck();
      });
    });
  }

  // ── Marker sync (zoom-aware) ──────────────────────────────────────────────────

  private clearAllMarkers(): void {
    for (const m of this.activeMarkers) m.remove();
    this.activeMarkers = [];
  }

  private syncMarkers(): void {
    const L = (window as any).L;
    if (!L || !this.map) return;

    this.clearAllMarkers();

    if (this.currentZoom <= ZOOM_STATE) {
      this.renderStateMarkers(L);
    } else if (this.currentZoom <= ZOOM_CLUSTER) {
      this.renderClusterMarkers(L);
    } else {
      this.renderIndividualMarkers(L);
    }
  }

  // ── State-level view ──────────────────────────────────────────────────────────

  private renderStateMarkers(L: any): void {
    const groups = this.computeStateGroups();
    for (const group of groups) {
      const sizeClass = group.count > 500 ? 'xl' : group.count > 100 ? 'lg' : group.count > 30 ? 'md' : 'sm';
      const icon = L.divIcon({
        className: '',
        html: `<div class="cmap-state cmap-state--${sizeClass}">
                 <span class="cmap-state__abbr">${group.state}</span>
                 <span class="cmap-state__count">${group.count.toLocaleString()}</span>
               </div>`,
        iconSize: [80, 52],
        iconAnchor: [40, 26],
      });
      const marker = L.marker([group.lat, group.lng], { icon })
        .addTo(this.map)
        .on('click', () => {
          this.zone.run(() => {
            this.map.setView([group.lat, group.lng], ZOOM_STATE + 2);
          });
        });
      this.activeMarkers.push(marker);
    }
  }

  private computeStateGroups(): StateGroup[] {
    const counts = new Map<string, number>();
    for (const c of this.churches) {
      if (c.state) counts.set(c.state, (counts.get(c.state) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .filter(([s]) => STATE_CENTERS[s])
      .map(([state, count]) => ({ state, count, lat: STATE_CENTERS[state][0], lng: STATE_CENTERS[state][1] }));
  }

  // ── Cluster view ──────────────────────────────────────────────────────────────

  private renderClusterMarkers(L: any): void {
    const clusters = this.computeClusters(this.currentZoom);
    for (const cluster of clusters) {
      if (cluster.count === 1) {
        // Single church in cell — render as compact individual pin
        this.addIndividualMarker(L, cluster.churches[0], true);
      } else {
        const sizeClass = cluster.count > 50 ? 'xl' : cluster.count > 20 ? 'lg' : cluster.count > 8 ? 'md' : 'sm';
        const icon = L.divIcon({
          className: '',
          html: `<div class="cmap-cluster cmap-cluster--${sizeClass}">
                   <span class="cmap-cluster__count">${cluster.count}</span>
                 </div>`,
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        });
        const marker = L.marker([cluster.lat, cluster.lng], { icon })
          .addTo(this.map)
          .on('click', () => {
            this.zone.run(() => {
              const bounds = L.latLngBounds(cluster.churches.map((c: Church) => [c.lat!, c.lng!]));
              this.map.fitBounds(bounds, { padding: [60, 60], maxZoom: ZOOM_CLUSTER + 1 });
            });
          });
        this.activeMarkers.push(marker);
      }
    }
  }

  private computeClusters(zoom: number): ClusterGroup[] {
    const size = gridSize(zoom);
    const cells = new Map<string, Church[]>();
    for (const c of this.churches) {
      if (c.lat == null || c.lng == null) continue;
      const key = `${Math.floor(c.lat / size)},${Math.floor(c.lng / size)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key)!.push(c);
    }
    return Array.from(cells.values()).map(churches => ({
      lat: churches.reduce((s, c) => s + c.lat!, 0) / churches.length,
      lng: churches.reduce((s, c) => s + c.lng!, 0) / churches.length,
      count: churches.length,
      churches,
    }));
  }

  // ── Individual marker view ────────────────────────────────────────────────────

  private renderIndividualMarkers(L: any): void {
    for (const church of this.churches) {
      if (church.lat == null || church.lng == null) continue;
      this.addIndividualMarker(L, church, false);
    }
    this.updateIndividualMarkerStyles();
  }

  private addIndividualMarker(L: any, church: Church, compact: boolean): void {
    const label = this.getPillLabel(church);
    const w = Math.max(30, label.length * 8 + 22);

    const html = `<div class="cmap-pill" data-id="${church.id}">${label}</div>`;

    const icon = L.divIcon({
      className: '',
      html,
      iconSize: [w, 24] as [number, number],
      iconAnchor: [w / 2, 12] as [number, number],
    });

    const marker = L.marker([church.lat!, church.lng!], { icon })
      .addTo(this.map)
      .on('click', () => { this.zone.run(() => this.selectChurch.emit(church)); });

    // Tag it with the church id for style updates
    (marker as any)._churchId = church.id;
    this.activeMarkers.push(marker);
  }

  private updateIndividualMarkerStyles(): void {
    if (this.currentZoom <= ZOOM_CLUSTER) return;
    for (const marker of this.activeMarkers) {
      const id = (marker as any)._churchId;
      if (!id) continue;
      const el = (marker as any)._icon?.querySelector('.cmap-pill') as HTMLElement | null;
      if (!el) continue;
      el.classList.remove('cmap-pill--hovered', 'cmap-pill--selected');
      if (id === this.selectedChurchId) el.classList.add('cmap-pill--selected');
      else if (id === this.hoveredChurchId) el.classList.add('cmap-pill--hovered');
    }
  }

  private getPillLabel(church: Church): string {
    const denom = church.denomination_path?.[church.denomination_path.length - 1] ?? '';
    if (denom) {
      if (/baptist/i.test(denom))            return 'Bapt';
      if (/catholic/i.test(denom))           return 'Cath';
      if (/methodist/i.test(denom))          return 'Meth';
      if (/presbyterian/i.test(denom))       return 'Pres';
      if (/lutheran/i.test(denom))           return 'Luth';
      if (/episcopal/i.test(denom))          return 'Epis';
      if (/pentecostal/i.test(denom))        return 'Pent';
      if (/non.?denom/i.test(denom))         return 'N/D';
      if (/orthodox/i.test(denom))           return 'Orth';
      if (/assembly|assemblies/i.test(denom))return 'A/G';
      if (/church of christ/i.test(denom))   return 'CoC';
      if (/adventist/i.test(denom))          return 'Adv';
      if (/reformed/i.test(denom))           return 'Ref';
      if (/evangelical/i.test(denom))        return 'Evan';
    }
    const size = getSizeLabel(church);
    return size === '•' ? '✝' : size;
  }
}
