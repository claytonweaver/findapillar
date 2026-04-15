export interface Denomination {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  level: number;
  description: string | null;
  children?: Denomination[];
}
