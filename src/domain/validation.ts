import { attributes, Attribute, Bound, Buyer, Config, Producer } from "./model";

export function isDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function accepts(bound: Bound, value: unknown): boolean {
  if (bound.type === "wajib_tepat")
    return (
      Array.isArray(bound.choices) &&
      bound.choices.length === 1 &&
      bound.choices[0] === value
    );
  if (bound.type === "fleksibel_pilihan")
    return (
      Array.isArray(bound.choices) &&
      bound.choices.includes(value as string | number)
    );
  return (
    ["wajib_rentang", "fleksibel_rentang"].includes(bound.type) &&
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isFinite(bound.min) &&
    Number.isFinite(bound.max) &&
    value >= bound.min! &&
    value <= bound.max!
  );
}
export function boundError(r: Bound, a: Attribute): string | undefined {
  if (!r || !Number.isFinite(r.weight) || r.weight < 0 || r.weight > 100)
    return `Bobot ${a} harus antara 0–100.`;
  const validValue = (v: unknown) =>
    a === "bahan"
      ? typeof v === "string" && v.trim().length > 0 && v.length <= 80
      : typeof v === "number" &&
        Number.isFinite(v) &&
        v >= (a === "warna" ? 0 : 0.01) &&
        v <= 10000 &&
        (a !== "warna" || Number.isInteger(v));
  if (!validValue(r.ideal)) return `Preferensi ideal ${a} tidak valid.`;
  if (r.type === "wajib_tepat" || r.type === "fleksibel_pilihan") {
    if (
      !Array.isArray(r.choices) ||
      !r.choices.length ||
      r.choices.length > 30 ||
      !r.choices.every(validValue) ||
      new Set(r.choices).size !== r.choices.length ||
      (r.type === "wajib_tepat" && r.choices.length !== 1) ||
      r.min !== undefined ||
      r.max !== undefined
    )
      return `Pilihan ${a} tidak valid; wajib tepat harus memiliki satu nilai.`;
  } else if (
    !["wajib_rentang", "fleksibel_rentang"].includes(r.type) ||
    a === "bahan" ||
    !validValue(r.min) ||
    !validValue(r.max) ||
    r.min! > r.max! ||
    r.choices !== undefined
  )
    return `Rentang ${a} tidak valid.`;
  if (!accepts(r, r.ideal))
    return `Preferensi ideal ${a} harus berada di dalam batas yang diterima.`;
}
export function buyerError(b: Buyer, p: Producer): string | undefined {
  if (
    !b ||
    typeof b.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(b.id) ||
    typeof b.name !== "string" ||
    !b.name.trim() ||
    b.name.length > 120
  )
    return "Identitas pembeli tidak valid.";
  if (
    !Number.isSafeInteger(b.quantity) ||
    b.quantity < 1 ||
    b.quantity > 1000000
  )
    return "Kebutuhan harus 1–1.000.000 unit bulat.";
  if (!Object.hasOwn(p.shipping, b.zone))
    return "Zona pengiriman tidak tersedia.";
  if (!isDate(b.deadline)) return "Tanggal tenggat tidak valid.";
  for (const a of attributes) {
    const error = boundError(b.bounds?.[a], a);
    if (error) return error;
  }
}
export function configError(c: Config): string | undefined {
  if (!c || !isDate(c.date) || !["cost", "ideal"].includes(c.objective))
    return "Tanggal simulasi atau tujuan solver tidak valid.";
  for (const key of [
    "platform",
    "coordination",
    "communication",
    "stockRate",
    "deviationWeight",
    "minimumSaving",
  ] as const)
    if (
      !Number.isFinite(c[key]) ||
      c[key] < 0 ||
      c[key] > (key === "stockRate" ? 100 : 1e9)
    )
      return `Parameter ${key} tidak valid.`;
}
