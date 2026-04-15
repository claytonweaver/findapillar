export interface ChurchFilters {
  searchQuery: string;
  denominationIds: string[];   // denomination IDs (walks tree)
  serviceStyles: string[];
  tags: string[];
  state: string;
}

export const DEFAULT_FILTERS: ChurchFilters = {
  searchQuery: '',
  denominationIds: [],
  serviceStyles: [],
  tags: [],
  state: '',
};

export function isDefaultFilters(f: ChurchFilters): boolean {
  return (
    !f.searchQuery &&
    f.denominationIds.length === 0 &&
    f.serviceStyles.length === 0 &&
    f.tags.length === 0 &&
    !f.state
  );
}

export function activeFilterCount(f: ChurchFilters): number {
  return (
    f.denominationIds.length +
    f.serviceStyles.length +
    f.tags.length +
    (f.state ? 1 : 0)
  );
}

export const SERVICE_STYLE_OPTIONS = [
  { label: 'Traditional', value: 'traditional' },
  { label: 'Contemporary', value: 'contemporary' },
  { label: 'Blended', value: 'blended' },
  { label: 'Liturgical', value: 'liturgical' },
];

export const TAG_OPTIONS = [
  'LGBT-affirming', 'Women pastors', 'Women deaconesses',
  'Expository preaching', 'Reformed theology', 'Liturgical worship',
  'Traditional worship', 'Contemporary worship', 'Charismatic gifts',
  'Healing ministry', 'Missions focused', 'Social justice focused',
  'Multi-ethnic', 'Young adults', 'College ministry', 'Family-focused',
  'Small groups', 'Recovery ministry', 'Seeker-friendly', 'Urban ministry',
  'Historic church', 'Deaf ministry',
];
