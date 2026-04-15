import {
  Component, Input, Output, EventEmitter, OnDestroy,
  OnChanges, SimpleChanges, ElementRef, ViewChild, AfterViewInit,
  ChangeDetectionStrategy, NgZone, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Church, formatAttendance } from '../../../../core/models/church.model';

@Component({
  selector: 'app-church-map',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="map-wrap">
      <!-- Map toolbar -->
      <div class="map-toolbar">
        <button *ngIf="!drawMode && !drawnPolygon" class="map-tool-btn" (click)="startDraw()" title="Draw area to filter">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 17c2-2 4-4 7-4s5 2 7 4"/><path d="M3 7c2 2 4 4 7 4s5-2 7-4"/>
          </svg>
          Draw area
        </button>
        <button *ngIf="drawMode" class="map-tool-btn map-tool-btn--active" (click)="cancelDraw()">
          Cancel
        </button>
        <span *ngIf="drawMode" class="map-tool-hint">
          {{ isDrawing ? 'Release to apply' : 'Hold and drag to draw' }}
        </span>
        <button *ngIf="drawnPolygon" class="map-tool-btn map-tool-btn--clear" (click)="clearDraw()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
          Clear area
        </button>
      </div>

      <div #mapEl class="map-container" [class.map-container--draw]="drawMode"></div>

      <!-- Floating selected card -->
      <div *ngIf="selectedChurch" class="map-preview">
        <div class="map-preview__inner">
          <div class="map-preview__content">
            <div *ngIf="selectedChurch.cover_photo" class="map-preview__thumb">
              <img [src]="selectedChurch.cover_photo" [alt]="selectedChurch.name" />
            </div>
            <div class="map-preview__info">
              <p *ngIf="denomLabel" class="map-preview__denom">{{ denomLabel }}</p>
              <p class="map-preview__name">{{ selectedChurch.name }}</p>
              <p class="map-preview__city">{{ selectedChurch.city }}, {{ selectedChurch.state }}</p>
              <p *ngIf="selectedChurch.average_attendance" class="map-preview__att">
                {{ formatAtt(selectedChurch.average_attendance) }} avg. attendance
              </p>
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
    </div>
  `,
  styles: [`
    :host { display: flex; flex: 1; width: 100%; height: 100%; flex-direction: column; }
    .map-wrap { width: 100%; height: 100%; position: relative; display: flex; flex-direction: column; }
    .map-container { flex: 1; width: 100%; }
    .map-container--draw { cursor: crosshair !important; }
    .map-container--draw .leaflet-grab { cursor: crosshair !important; }
    .map-container--draw .leaflet-dragging { cursor: crosshair !important; }

    .map-toolbar {
      position: absolute; top: 0.75rem; right: 0.75rem; z-index: 1000;
      display: flex; align-items: center; gap: 0.5rem;
    }
    .map-tool-btn {
      display: flex; align-items: center; gap: 0.375rem;
      padding: 0.4rem 0.75rem; border-radius: 999px;
      background: white; border: 1.5px solid var(--sanctuary-border);
      font-size: 0.75rem; font-weight: 600; color: var(--sanctuary-text);
      cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,0.12);
      transition: all 0.12s;
    }
    .map-tool-btn:hover { background: var(--sanctuary-bg); border-color: #a8a29e; }
    .map-tool-btn--active { background: #fee2e2; border-color: #fca5a5; color: #dc2626; }
    .map-tool-btn--finish { background: var(--sanctuary-text); color: white; border-color: var(--sanctuary-text); }
    .map-tool-btn--finish:hover { background: #44403c; }
    .map-tool-btn--clear { background: #fee2e2; border-color: #fca5a5; color: #dc2626; }
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
    }
    .map-preview__city, .map-preview__att {
      font-size: 0.75rem; color: var(--sanctuary-muted); margin: 0;
    }
    .map-preview__actions {
      display: flex; border-top: 1px solid var(--sanctuary-border);
    }
    .map-preview__dismiss, .map-preview__view {
      flex: 1; padding: 0.65rem; font-size: 0.75rem; font-weight: 600;
      text-align: center; cursor: pointer; border: none; background: none;
      transition: background 0.12s;
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
  @Output() selectChurch = new EventEmitter<Church | null>();
  @Output() polygonFilter = new EventEmitter<[number, number][] | null>();

  selectedChurch: Church | null = null;
  formatAtt = formatAttendance;

  drawMode = false;
  isDrawing = false;
  drawPoints: [number, number][] = [];
  drawnPolygon: any = null;

  private map: any;
  private markers = new Map<string, { marker: any; el: HTMLElement }>();
  private leafletLoaded = false;
  private previewPolyline: any = null;
  private drawMousedownHandler: any = null;
  private drawMousemoveHandler: any = null;
  private drawMouseupHandler: any = null;

  constructor(private zone: NgZone, private cdr: ChangeDetectorRef) {}

  get denomLabel(): string {
    const path = this.selectedChurch?.denomination_path;
    return path && path.length > 1 ? path[path.length - 1] : (path?.[0] ?? '');
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
      this.updateMarkerStyles();
    }
    if (changes['hoveredChurchId']) this.updateMarkerStyles();
  }

  ngOnDestroy(): void { this.map?.remove(); }

  // ── Drawing ──────────────────────────────────────────────────────────

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
      // Throttle: skip points less than 6px away from the last to reduce polygon complexity
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
        if (this.drawPoints.length >= 3) {
          this.finishDraw();
        } else {
          this.cancelDraw();
        }
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
        color: '#9A3412',
        weight: 2,
        fillColor: '#9A3412',
        fillOpacity: 0.08,
        dashArray: '4 4',
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
    if (this.drawnPolygon) {
      this.drawnPolygon.remove();
      this.drawnPolygon = null;
    }
    this.drawPoints = [];
    this.polygonFilter.emit(null);
    this.cdr.markForCheck();
  }

  private updatePreviewLine(): void {
    const L = (window as any).L;
    if (this.drawPoints.length < 2) return;
    if (this.previewPolyline) {
      this.previewPolyline.setLatLngs(this.drawPoints);
    } else {
      this.previewPolyline = L.polyline(this.drawPoints, {
        color: '#9A3412', weight: 2, dashArray: '6 4', opacity: 0.7,
      }).addTo(this.map);
    }
  }

  private removePreviews(): void {
    if (this.previewPolyline) { this.previewPolyline.remove(); this.previewPolyline = null; }
  }

  private cleanupDrawListeners(): void {
    if (this.drawMousedownHandler) { this.map.off('mousedown', this.drawMousedownHandler); this.drawMousedownHandler = null; }
    if (this.drawMousemoveHandler) { this.map.off('mousemove', this.drawMousemoveHandler); this.drawMousemoveHandler = null; }
    if (this.drawMouseupHandler) { this.map.off('mouseup', this.drawMouseupHandler); this.drawMouseupHandler = null; }
  }

  // ── Map init ─────────────────────────────────────────────────────────

  private async loadLeaflet(): Promise<void> {
    if (this.leafletLoaded) return;
    const L = await import('leaflet');
    (window as any).L = (L as any).default ?? L;
    this.leafletLoaded = true;
  }

  private initMap(): void {
    const L = (window as any).L;
    this.map = L.map(this.mapElRef.nativeElement, {
      center: [39.5, -98.35],
      zoom: 4,
      zoomControl: true,
      scrollWheelZoom: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(this.map);
  }

  private syncMarkers(): void {
    const L = (window as any).L;
    if (!L || !this.map) return;

    const currentIds = new Set(this.churches.map(c => c.id));
    this.markers.forEach((val, id) => {
      if (!currentIds.has(id)) { val.marker.remove(); this.markers.delete(id); }
    });

    this.churches.forEach(church => {
      if (!church.lat || !church.lng || this.markers.has(church.id)) return;
      const label = church.average_attendance ? formatAttendance(church.average_attendance) : '•';
      const icon = L.divIcon({
        className: '',
        html: `<div class="cmap-pin">${label}</div>`,
        iconSize: [70, 28],
        iconAnchor: [35, 14],
      });
      const marker = L.marker([church.lat, church.lng], { icon })
        .addTo(this.map)
        .on('click', () => { this.zone.run(() => this.selectChurch.emit(church)); });
      this.markers.set(church.id, { marker, el: null! });
    });

    this.updateMarkerStyles();
  }

  private updateMarkerStyles(): void {
    this.markers.forEach(({ marker }, id) => {
      const el = (marker as any)._icon?.querySelector('.cmap-pin') as HTMLElement;
      if (!el) return;
      el.className = 'cmap-pin';
      if (id === this.selectedChurchId) el.classList.add('cmap-pin--selected');
      else if (id === this.hoveredChurchId) el.classList.add('cmap-pin--hovered');
    });
  }
}
