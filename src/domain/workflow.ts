import { Quote, Sample } from "./model";
import { isDate } from "./validation";
export function quoteStatus(samples: Sample[], ids: string[]): Quote["status"] {
  if (samples.some((s) => s.result === "ditolak")) return "ditolak";
  return ids.length > 0 &&
    ids.every((id) =>
      samples.some((s) => s.buyerId === id && s.result === "diterima"),
    )
    ? "disetujui"
    : "ditawarkan";
}
export function recordSample(
  quote: Quote,
  sample: Sample,
  date: string,
): Quote {
  if (!isDate(date) || date > quote.expires)
    throw Error("Penawaran kedaluwarsa. Buat penawaran baru.");
  if (!quote.plan.ids.includes(sample.buyerId))
    throw Error("Pembeli bukan anggota penawaran.");
  if (sample.result === "ditolak" && (!sample.attribute || !sample.note.trim()))
    throw Error("Atribut dan alasan penolakan wajib diisi.");
  if (
    sample.result === "diterima" &&
    quote.samples.some(
      (s) => s.buyerId === sample.buyerId && s.result === "ditolak",
    )
  )
    throw Error(
      "Sampel ditolak tidak dapat langsung disetujui. Buat putaran penawaran baru atau revisi batas dengan persetujuan.",
    );
  const samples = [
    ...quote.samples.filter((s) => s.buyerId !== sample.buyerId),
    sample,
  ];
  return { ...quote, samples, status: quoteStatus(samples, quote.plan.ids) };
}
export function replaceQuote(quotes: Quote[], next: Quote) {
  const replaced = quotes.filter((q) =>
    q.plan.ids.some((id) => next.plan.ids.includes(id)),
  );
  return {
    quotes: [...quotes.filter((q) => !replaced.includes(q)), next],
    archived: replaced.flatMap((q) => q.samples),
    replaced: replaced.length,
  };
}
