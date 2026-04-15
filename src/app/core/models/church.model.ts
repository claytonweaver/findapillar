export interface Pastor {
  id: string;
  name: string;
  title: string | null;
  bio: string | null;
  photo_url: string | null;
  is_primary: boolean;
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

export interface CoreBeliefs {
  statement: string;
  beliefs: string[];
}

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
  core_beliefs: CoreBeliefs | null;
  is_verified: boolean;
  is_active: boolean;
  pastors?: Pastor[];
  meeting_times?: MeetingTime[];
  church_tags?: ChurchTag[];
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
