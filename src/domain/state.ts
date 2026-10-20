import { attributes, Buyer, Config, Quote, Sample } from "./model";
import { buyerError, configError, isDate } from "./validation";
import { producer, scenarios } from "./seed";
import { solveGroup } from "../solver";
import { quoteStatus } from "./workflow";
export type AppState = {
  buyers: Buyer[];
  config: Config;
  quotes: Quote[];
  sampleHistory: Sample[];
  active: string;
};
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
function requireThat(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
function samples(value: unknown, ids: Set<string>): Sample[] {
  requireThat(
    Array.isArray(value) && value.length <= 2000,
    "Riwayat sampel tidak valid atau melebihi 2.000 respons.",
  );
  return value.map((s) => {
    requireThat(
      object(s) &&
        typeof s.buyerId === "string" &&
        ids.has(s.buyerId) &&
        ["diterima", "ditolak"].includes(s.result as string) &&
        typeof s.note === "string" &&
        s.note.length <= 2000,
      "Respons sampel tidak valid.",
    );
    if (s.attribute !== undefined)
      requireThat(
        attributes.includes(s.attribute as (typeof attributes)[number]),
        "Atribut sampel tidak valid.",
      );
    if (s.result === "ditolak")
      requireThat(
        s.attribute && s.note.trim(),
        "Penolakan wajib menyebut atribut dan alasan.",
      );
    return {
      buyerId: s.buyerId,
      result: s.result as Sample["result"],
      note: s.note,
      ...(s.attribute ? { attribute: s.attribute as Sample["attribute"] } : {}),
    };
  });
}
// Canonical comparison rejects altered prices without relying on JSON key order.
function canonical(x: unknown): string {
  if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
  if (object(x))
    return (
      "{" +
      Object.keys(x)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(x);
}
export function parseState(input: unknown): AppState {
  requireThat(object(input), "Format data tidak valid.");
  requireThat(
    Array.isArray(input.buyers) &&
      input.buyers.length >= 1 &&
      input.buyers.length <= 10,
    "Jumlah pembeli harus 1–10.",
  );
  const buyers = input.buyers as Buyer[];
  for (const b of buyers) {
    const error = buyerError(b, producer);
    requireThat(!error, error ?? "Data pembeli tidak valid.");
  }
  const ids = new Set(buyers.map((b) => b.id));
  requireThat(ids.size === buyers.length, "ID pembeli harus unik.");
  const config = input.config as Config,
    error = configError(config);
  requireThat(!error, error ?? "Parameter tidak valid.");
  requireThat(
    typeof input.active === "string" &&
      scenarios.some((s) => s[0] === input.active),
    "Skenario tidak dikenal.",
  );
  requireThat(
    Array.isArray(input.quotes) && input.quotes.length <= 10,
    "Penawaran tidak valid.",
  );
  const occupied = new Set<string>();
  const quotes = input.quotes.map((q): Quote => {
    requireThat(
      object(q) &&
        object(q.plan) &&
        Array.isArray(q.plan.ids) &&
        q.plan.ids.length > 0,
      "Rencana penawaran tidak valid.",
    );
    const members = q.plan.ids as string[];
    requireThat(
      members.every((id) => ids.has(id) && !occupied.has(id)) &&
        new Set(members).size === members.length,
      "Anggota penawaran ganda atau tidak ditemukan.",
    );
    members.forEach((id) => occupied.add(id));
    requireThat(
      q.groupKey === members.join("-") &&
        isDate(q.expires) &&
        q.expires >= config.date,
      "Identitas atau masa berlaku penawaran tidak valid.",
    );
    const expected = solveGroup(
      members.map((id) => buyers.find((b) => b.id === id)!),
      producer,
      config,
    ).plan;
    requireThat(
      expected && canonical(q.plan) === canonical(expected),
      "Snapshot penawaran berbeda dari hasil solver. Buat penawaran baru.",
    );
    const responses = samples(q.samples, new Set(members));
    requireThat(
      new Set(responses.map((s) => s.buyerId)).size === responses.length,
      "Respons sampel ganda.",
    );
    const status = quoteStatus(responses, members);
    requireThat(
      q.status === status,
      "Status penawaran tidak sesuai respons sampel.",
    );
    return {
      groupKey: q.groupKey as string,
      plan: expected,
      expires: q.expires,
      status,
      samples: responses,
    };
  });
  return {
    buyers: structuredClone(buyers),
    config: { ...config },
    quotes,
    sampleHistory: samples(input.sampleHistory ?? [], ids),
    active: input.active,
  };
}
