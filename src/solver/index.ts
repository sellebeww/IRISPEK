import {
  attributes,
  Attribute,
  Buyer,
  Config,
  Issue,
  Plan,
  Producer,
  Result,
  Spec,
  Value,
  Bound,
} from "../domain/model";
import {
  accepts,
  buyerError,
  configError,
  boundError,
} from "../domain/validation";
export { accepts } from "../domain/validation";
export function intersection(buyers: Buyer[], producer: Producer) {
  const values = {} as Record<Attribute, Value[]>;
  const issues: Issue[] = [];
  for (const a of attributes) {
    values[a] = producer.catalog[a].filter((v) =>
      buyers.every((b) => accepts(b.bounds[a], v)),
    );
    if (!values[a].length) {
      const limiting = buyers
        .filter((b) =>
          producer.catalog[a].some((v) => !accepts(b.bounds[a], v)),
        )
        .map((b) => b.id);
      issues.push({
        attribute: a,
        buyers: limiting,
        message: `Tidak ada ${a} yang diterima semua anggota dan tersedia di katalog.`,
      });
    }
  }
  return { values, issues };
}
export function tierPrice(quantity: number, p: Producer) {
  return (
    [...p.tiers].sort((a, b) => b.min - a.min).find((t) => quantity >= t.min)
      ?.price ?? Infinity
  );
}
export function deviation(b: Buyer, spec: Spec) {
  return attributes.reduce((s, a) => {
    const r = b.bounds[a],
      v = spec[a];
    return (
      s +
      r.weight *
        (typeof v === "number" && typeof r.ideal === "number"
          ? Math.abs(v - r.ideal) /
            Math.max(1, (r.max ?? r.ideal) - (r.min ?? r.ideal))
          : Number(v !== r.ideal))
    );
  }, 0);
}
function cost(
  bs: Buyer[],
  spec: Spec,
  p: Producer,
  c: Config,
  orderQuantity?: number,
): Plan {
  const demand = bs.reduce((s, b) => s + b.quantity, 0),
    quantity = orderQuantity ?? Math.max(p.moq, demand),
    price =
      tierPrice(quantity, p) + (p.materialSurcharge[String(spec.bahan)] ?? 0),
    group = bs.length > 1;
  const coordination = group ? c.coordination + c.communication * bs.length : 0,
    platform = group ? c.platform : 0;
  // Largest remainders allocate MOQ units deterministically and conserve units.
  const units = bs.map((b) => Math.floor((quantity * b.quantity) / demand));
  const order = bs
    .map((b, i) => ({ i, rem: (quantity * b.quantity) / demand - units[i] }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  const remaining = quantity - units.reduce((s, n) => s + n, 0);
  for (let j = 0; j < remaining; j++) units[order[j].i]++;
  const allocations = bs.map((b, i) => {
    const share = b.quantity / demand,
      procurement =
        units[i] * price +
        (p.setup + coordination + platform) * share +
        p.design +
        p.shipping[b.zone],
      excess = units[i] - b.quantity,
      stockCost = excess * price * c.stockRate;
    return {
      buyerId: b.id,
      units: units[i],
      excess,
      stockCost,
      procurement,
      effective: procurement + stockCost,
      solo: 0,
      saving: 0,
      deviation: deviation(b, spec),
    };
  });
  return {
    ids: bs.map((b) => b.id),
    spec,
    quantity,
    unitPrice: price,
    setup: p.setup,
    coordination,
    platform,
    procurement: allocations.reduce((s, a) => s + a.procurement, 0),
    effective: allocations.reduce((s, a) => s + a.effective, 0),
    allocations,
  };
}
function raw(
  bs: Buyer[],
  p: Producer,
  c: Config,
  soloCache = new Map<string, Plan>(),
): Result {
  if (!bs.length)
    return {
      issues: [
        {
          attribute: "anggota",
          buyers: [],
          message: "Pilih setidaknya satu pembeli.",
        },
      ],
    };
  const configIssue = configError(c);
  if (configIssue)
    return {
      issues: [{ attribute: "parameter", buyers: [], message: configIssue }],
    };
  if (new Set(bs.map((b) => b.id)).size !== bs.length)
    return {
      issues: [
        {
          attribute: "data",
          buyers: bs.map((b) => b.id),
          message: "ID pembeli harus unik.",
        },
      ],
    };
  const invalid = bs.flatMap((b) => {
    const error = buyerError(b, p);
    return error ? [{ attribute: "data", buyers: [b.id], message: error }] : [];
  });
  if (invalid.length) return { issues: invalid };
  const ready = Date.parse(c.date + "T00:00:00Z") + p.leadDays * 86400000;
  const late = bs.filter((b) => Date.parse(b.deadline + "T00:00:00Z") < ready);
  if (late.length)
    return {
      issues: [
        {
          attribute: "tenggat",
          buyers: late.map((b) => b.id),
          message: "Lead time produsen melampaui tenggat.",
        },
      ],
    };
  const { values, issues } = intersection(bs, p);
  if (issues.length) return { issues };
  let specs: Partial<Spec>[] = [{}];
  for (const a of attributes)
    specs = specs.flatMap((s) => values[a].map((v) => ({ ...s, [a]: v })));
  const baselines = new Map(
    bs.map((b) => [
      b.id,
      bs.length > 1
        ? (
            soloCache.get(b.id) ??
            raw([b], p, { ...c, objective: "cost" }).plan!
          ).effective
        : 0,
    ]),
  );
  const economicIssues = new Map<string, Issue>();
  let best: Plan | undefined,
    score = Infinity;
  const minimumQuantity = Math.max(
    p.moq,
    bs.reduce((n, b) => n + b.quantity, 0),
  );
  const quantities = [
    ...new Set([
      minimumQuantity,
      ...p.tiers.map((t) => t.min).filter((n) => n > minimumQuantity),
    ]),
  ].sort((a, b) => a - b);
  for (const spec of specs)
    for (const quantity of quantities) {
      const plan = cost(bs, spec as Spec, p, c, quantity);
      const harmed =
        bs.length > 1
          ? plan.allocations.filter(
              (a) =>
                baselines.get(a.buyerId)! - a.effective + 1e-7 <
                c.minimumSaving,
            )
          : [];
      if (harmed.length) {
        for (const a of harmed)
          economicIssues.set(a.buyerId, {
            attribute: "biaya",
            buyers: [a.buyerId],
            message: `${bs.find((b) => b.id === a.buyerId)!.name} membayar lebih mahal atau tidak mencapai ambang penghematan individual.`,
          });
        continue;
      }
      const n =
        c.objective === "ideal"
          ? plan.allocations.reduce(
              (s, a) => s + a.deviation * c.deviationWeight,
              0,
            )
          : plan.effective;
      if (
        n < score ||
        (n === score && plan.effective < (best?.effective ?? Infinity))
      ) {
        score = n;
        best = plan;
      }
    }
  return best
    ? { plan: best, issues: [] }
    : { issues: [...economicIssues.values()] };
}
export function solveGroup(
  bs: Buyer[],
  p: Producer,
  c: Config,
  soloCache = new Map<string, Plan>(),
): Result {
  const result = raw(
    bs,
    p,
    bs.length === 1 ? { ...c, objective: "cost" } : c,
    soloCache,
  );
  if (!result.plan) return result;
  const plan = result.plan,
    issues: Issue[] = [];
  plan.allocations.forEach((a) => {
    const b = bs.find((b) => b.id === a.buyerId)!,
      solo =
        soloCache.get(b.id) ?? raw([b], p, { ...c, objective: "cost" }).plan!;
    a.solo = solo.effective;
    a.saving = a.solo - a.effective;
    if (bs.length > 1 && a.saving + 1e-7 < c.minimumSaving)
      issues.push({
        attribute: "biaya",
        buyers: [b.id],
        message: `${b.name} membayar lebih mahal atau tidak mencapai ambang penghematan individual.`,
      });
  });
  return issues.length ? { issues } : { plan, issues };
}
export function solvePartition(bs: Buyer[], p: Producer, c: Config) {
  if (bs.length > 10) throw new Error("Maksimal 10 pembeli didukung.");
  if (new Set(bs.map((b) => b.id)).size !== bs.length)
    throw new Error("ID pembeli harus unik.");
  const soloCache = new Map<string, Plan>();
  for (const b of bs) {
    const r = solveGroup([b], p, c);
    if (r.plan) soloCache.set(b.id, r.plan);
  }
  const size = 1 << bs.length,
    plans = new Map<number, Plan>(),
    failures = new Map<number, Issue[]>();
  for (let m = 1; m < size; m++) {
    const r = solveGroup(
      bs.filter((_, i) => m & (1 << i)),
      p,
      c,
      soloCache,
    );
    if (r.plan) plans.set(m, r.plan);
    else failures.set(m, r.issues);
  }
  const validMask = bs.reduce(
      (m, _, i) => (plans.has(1 << i) ? m | (1 << i) : m),
      0,
    ),
    dp = new Map<number, { cost: number; groups: Plan[] }>();
  dp.set(0, { cost: 0, groups: [] });
  function visit(mask: number): { cost: number; groups: Plan[] } {
    const cached = dp.get(mask);
    if (cached) return cached;
    let best = { cost: Infinity, groups: [] as Plan[] };
    const first = mask & -mask;
    for (let sub = mask; sub; sub = (sub - 1) & mask) {
      if (!(sub & first)) continue;
      const plan = plans.get(sub);
      if (!plan) continue;
      const rest = visit(mask ^ sub),
        total = rest.cost + plan.effective;
      if (total < best.cost)
        best = { cost: total, groups: [plan, ...rest.groups] };
    }
    dp.set(mask, best);
    return best;
  }
  const solution = visit(validMask);
  return {
    ...solution,
    unserved: bs
      .filter((_, i) => !(validMask & (1 << i)))
      .map((b) => ({ buyer: b, issues: failures.get(1 << bs.indexOf(b))! })),
    ungrouped: solution.groups
      .filter((g) => g.ids.length === 1)
      .map((g) => ({
        buyer: bs.find((b) => b.id === g.ids[0])!,
        reason: [...plans.values()].some(
          (p) => p.ids.length > 1 && p.ids.includes(g.ids[0]),
        )
          ? "Ada alternatif kelompok layak, tetapi pesan sendiri dipilih dalam partisi dengan biaya total terendah."
          : "Tidak ada kelompok layak. Hambatan kandidat: " +
            [
              ...new Set(
                [...failures.entries()]
                  .filter(
                    ([mask]) =>
                      mask & (1 << bs.findIndex((b) => b.id === g.ids[0])) &&
                      mask & (mask - 1),
                  )
                  .flatMap(([, issues]) => issues.map((i) => i.attribute)),
              ),
            ].join(", ") +
            ".",
      })),
  };
}
export function majority(bs: Buyer[], p: Producer, c: Config) {
  const spec = {} as Spec;
  for (const a of attributes)
    spec[a] = [...p.catalog[a]].sort(
      (x, y) =>
        bs.filter((b) => accepts(b.bounds[a], y)).length -
        bs.filter((b) => accepts(b.bounds[a], x)).length,
    )[0];
  const excluded = bs.filter(
      (b) =>
        attributes.some((a) => !accepts(b.bounds[a], spec[a])) ||
        !raw([b], p, c).plan,
    ),
    included = bs.filter((b) => !excluded.includes(b));
  const minimum = Math.max(
    p.moq,
    included.reduce((n, b) => n + b.quantity, 0),
  );
  const grouped = included.length
    ? [minimum, ...p.tiers.map((t) => t.min).filter((n) => n > minimum)]
        .map((n) => cost(included, spec, p, c, n))
        .sort((a, b) => a.effective - b.effective)[0]
    : undefined;
  const solos = excluded.map((b) => solveGroup([b], p, c));
  return {
    spec,
    excluded,
    grouped,
    total:
      (grouped?.effective ?? 0) +
      solos.reduce((s, r) => s + (r.plan?.effective ?? 0), 0),
    unserved: solos.filter((r) => !r.plan).length,
  };
}
export function reviseAfterRejection(
  bs: Buyer[],
  id: string,
  attribute: Attribute,
  bound: Bound,
  consent: boolean,
) {
  if (!consent) throw new Error("Persetujuan pembeli diperlukan.");
  if (!bs.some((b) => b.id === id)) throw new Error("Pembeli tidak ditemukan.");
  const error = boundError(bound, attribute);
  if (error) throw new Error(error);
  return bs.map((b) =>
    b.id === id ? { ...b, bounds: { ...b.bounds, [attribute]: bound } } : b,
  );
}
