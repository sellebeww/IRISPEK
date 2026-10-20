export const attributes = ["panjang", "lebar", "bahan", "warna"] as const;
export type Attribute = (typeof attributes)[number];
export type Value = number | string;
export type Bound = {
  type:
    "wajib_tepat" | "wajib_rentang" | "fleksibel_rentang" | "fleksibel_pilihan";
  min?: number;
  max?: number;
  choices?: Value[];
  ideal: Value;
  weight: number;
};
export type Buyer = {
  id: string;
  name: string;
  zone: string;
  quantity: number;
  deadline: string;
  bounds: Record<Attribute, Bound>;
};
export type Spec = Record<Attribute, Value>;
export type Producer = {
  id: string;
  name: string;
  catalog: Record<Attribute, Value[]>;
  tiers: { min: number; price: number }[];
  materialSurcharge: Record<string, number>;
  moq: number;
  setup: number;
  design: number;
  leadDays: number;
  shipping: Record<string, number>;
};
export type Config = {
  date: string;
  platform: number;
  coordination: number;
  communication: number;
  stockRate: number;
  deviationWeight: number;
  minimumSaving: number;
  objective: "cost" | "ideal";
};
export type Allocation = {
  buyerId: string;
  units: number;
  excess: number;
  stockCost: number;
  procurement: number;
  effective: number;
  solo: number;
  saving: number;
  deviation: number;
};
export type Plan = {
  ids: string[];
  spec: Spec;
  quantity: number;
  unitPrice: number;
  setup: number;
  coordination: number;
  platform: number;
  procurement: number;
  effective: number;
  allocations: Allocation[];
};
export type Issue = { attribute: string; buyers: string[]; message: string };
export type Result = { plan?: Plan; issues: Issue[] };
export type Sample = {
  buyerId: string;
  result: "diterima" | "ditolak";
  attribute?: Attribute;
  note: string;
};
export type Quote = {
  groupKey: string;
  plan: Plan;
  expires: string;
  status: "ditawarkan" | "disetujui" | "ditolak";
  samples: Sample[];
};
