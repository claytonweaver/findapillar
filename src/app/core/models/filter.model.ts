export interface ChurchFilters {
  searchQuery: string;
  denominationIds: string[];   // denomination IDs (walks tree)
  serviceStyles: string[];
  tags: string[];
  state: string;
  city: string;
  zip: string;
}

export const DEFAULT_FILTERS: ChurchFilters = {
  searchQuery: '',
  denominationIds: [],
  serviceStyles: [],
  tags: [],
  state: '',
  city: '',
  zip: '',
};

export function isDefaultFilters(f: ChurchFilters): boolean {
  return (
    !f.searchQuery &&
    f.denominationIds.length === 0 &&
    f.serviceStyles.length === 0 &&
    f.tags.length === 0 &&
    !f.state &&
    !f.city
  );
}

export function activeFilterCount(f: ChurchFilters): number {
  return (
    f.denominationIds.length +
    f.serviceStyles.length +
    f.tags.length +
    (f.state ? 1 : 0) +
    (f.city ? 1 : 0)
  );
}

export const SERVICE_STYLE_OPTIONS = [
  { label: 'Traditional', value: 'traditional' },
  { label: 'Contemporary', value: 'contemporary' },
  { label: 'Blended', value: 'blended' },
  { label: 'Liturgical', value: 'liturgical' },
];

export const TAG_OPTIONS: { label: string; value: string }[] = [
  { label: 'Reformed theology',  value: 'reformed'          },
  { label: 'Evangelical',        value: 'evangelical'        },
  { label: 'Charismatic',        value: 'charismatic'        },
  { label: 'Progressive',        value: 'progressive'        },
  { label: 'LGBT-affirming',     value: 'lgbt-affirming'     },
  { label: 'Women pastors',      value: 'women-pastors'      },
  { label: 'Missions focused',   value: 'missions-focused'   },
  { label: 'Social justice',     value: 'social-justice'     },
  { label: 'Multi-ethnic',       value: 'multi-ethnic'       },
  { label: 'Young adults',       value: 'young-adults'       },
  { label: 'Family-focused',     value: 'families'           },
  { label: 'Recovery ministry',  value: 'recovery-ministry'  },
  { label: 'Food pantry',        value: 'food-pantry'        },
  { label: 'Counseling',         value: 'counseling'         },
  { label: 'Prison ministry',    value: 'prison-ministry'    },
  { label: 'Deaf ministry',      value: 'deaf-ministry'      },
];
