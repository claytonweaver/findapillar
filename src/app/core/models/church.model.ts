export interface Pastor {
  id: string;
  name: string;
  title: string | null;
  bio: string | null;
  photo_url: string | null;
  is_primary: boolean;
  seminary: string | null;
}

export interface MeetingTime {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string | null;
  service_name: string | null;
  location_note: string | null;
}

export interface ChurchTag {
  id: string;
  tag: string;
}

export interface ChurchReview {
  id: string;
  author_name: string | null;
  rating: number | null;
  text: string | null;
  review_date: string | null;
  source: string;
}

export interface CoreBeliefs {
  statement: string;
  beliefs: string[];
}

export interface SocialLinks {
  facebook?: string;
  instagram?: string;
  youtube?: string;
  twitter?: string;
  tiktok?: string;
}

/** Hours keyed by day number (0=Sun…6=Sat), each an array of open/close windows */
export type ChurchHours = Record<string, { open: string; close: string }[]>;

export interface Church {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  founded_year: number | null;
  average_attendance: number | null;
  denomination_id: string | null;
  denomination_path: string[] | null;
  service_style: string | null;
  cover_photo: string | null;
  photos: string[] | null;
  core_beliefs: CoreBeliefs | null;
  social_links: SocialLinks | null;
  hours: ChurchHours | null;
  size: 'small' | 'medium' | 'large' | null;
  google_place_id: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  google_maps_url: string | null;
  enriched: boolean;
  is_verified: boolean;
  is_active: boolean;
  pastors?: Pastor[];
  meeting_times?: MeetingTime[];
  church_tags?: ChurchTag[];
  church_reviews?: ChurchReview[];
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_ABBR  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${ampm}`;
}

export function formatAttendance(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return n.toLocaleString();
}

export function getSizeLabel(church: Church): string {
  if (church.size === 'large') return 'L';
  if (church.size === 'medium') return 'M';
  if (church.size === 'small') return 'S';
  if (church.average_attendance) {
    if (church.average_attendance >= 1000) return 'L';
    if (church.average_attendance >= 200) return 'M';
    return 'S';
  }
  return '•';
}

export function getSizeFull(church: Church): string | null {
  const s = church.size ?? (church.average_attendance
    ? church.average_attendance >= 1000 ? 'large' : church.average_attendance >= 200 ? 'medium' : 'small'
    : null);
  if (s === 'large') return 'Large congregation';
  if (s === 'medium') return 'Mid-size congregation';
  if (s === 'small') return 'Small congregation';
  return null;
}
