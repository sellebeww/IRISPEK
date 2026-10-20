import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buyers, producer, scenario } from "../src/domain/seed";
import { defaultConfig } from "../src/domain/config";
import { parseState } from "../src/domain/state";
import { buyerError, isDate, accepts } from "../src/domain/validation";
import { recordSample, replaceQuote } from "../src/domain/workflow";
import {
  solveGroup,
  solvePartition,
  reviseAfterRejection,
} from "../src/solver";
import { createStateStore, ConflictError } from "../src/server/storage";
import type { Quote } from "../src/domain/model";
const state = () => ({
  ...scenario("S1"),
  quotes: [],
  sampleHistory: [],
  active: "S1",
});
const quote = (): Quote => {
  const p = solveGroup(buyers.slice(0, 4), producer, defaultConfig).plan!;
  return {
    groupKey: p.ids.join("-"),
    plan: p,
    expires: "2026-10-25",
    status: "ditawarkan",
    samples: [],
  };
};
describe("audit: domain validation", () => {
  it.each(["2026-02-30", "2026-13-01", "2026-10-18T10:00:00Z", "no-date"])(
    "reject invalid or non-calendar date %s",
    (value) => expect(isDate(value)).toBe(false),
  );
  it("accept valid leap day", () => expect(isDate("2028-02-29")).toBe(true));
  it("exact bound cannot contain several values", () => {
    const b = structuredClone(buyers[0]);
    b.bounds.bahan.choices = ["kraft", "ivory"];
    expect(buyerError(b, producer)).toMatch(/satu/);
    expect(accepts(b.bounds.bahan, "ivory")).toBe(false);
  });
  it("reject empty ranges and mixed representations", () => {
    const b = structuredClone(buyers[0]);
    delete b.bounds.panjang.min;
    expect(buyerError(b, producer)).toMatch(/Rentang/);
    b.bounds.panjang = {
      type: "wajib_rentang",
      min: 16,
      max: 20,
      choices: [18],
      ideal: 18,
      weight: 1,
    };
    expect(buyerError(b, producer)).toMatch(/Rentang/);
  });
  it("ideal must be accepted", () => {
    const b = structuredClone(buyers[0]);
    b.bounds.panjang.ideal = 24;
    expect(buyerError(b, producer)).toMatch(/ideal/);
  });
  it("duplicates, zone and unsafe quantity rejected", () => {
    const s = state();
    s.buyers[1].id = s.buyers[0].id;
    expect(() => parseState(s)).toThrow(/unik/);
    const b = structuredClone(buyers[0]);
    b.zone = "__proto__";
    expect(buyerError(b, producer)).toMatch(/Zona/);
    b.zone = "Bandung";
    b.quantity = Infinity;
    expect(buyerError(b, producer)).toMatch(/unit/);
  });
  it("bad config cannot bypass deadline or use negative costs", () => {
    expect(
      solveGroup([buyers[0]], producer, { ...defaultConfig, date: "invalid" })
        .plan,
    ).toBeUndefined();
    expect(
      solveGroup([buyers[0]], producer, { ...defaultConfig, stockRate: -1 })
        .plan,
    ).toBeUndefined();
  });
  it("revision rejects unknown buyers", () =>
    expect(() =>
      reviseAfterRejection(
        buyers,
        "unknown",
        "bahan",
        buyers[0].bounds.bahan,
        true,
      ),
    ).toThrow(/ditemukan/));
});
describe("audit: economic correctness", () => {
  it("standalone best price can require ordering to the next tier", () => {
    const b = { ...buyers[0], quantity: 1900 };
    const p = solveGroup([b], producer, defaultConfig).plan!;
    expect(p.quantity).toBe(2000);
    expect(p.allocations[0].excess).toBe(100);
    expect(p.effective).toBeLessThan(
      1900 * 1450 +
        producer.setup +
        producer.design +
        producer.shipping[b.zone],
    );
  });
  it("stock risk can outweigh the next tier discount", () => {
    const p = solveGroup([{ ...buyers[0], quantity: 1900 }], producer, {
      ...defaultConfig,
      stockRate: 10,
    }).plan!;
    expect(p.quantity).toBe(1900);
  });
  it("allocation reconciles procurement and effective cost", () => {
    const p = solveGroup(buyers.slice(0, 3), producer, defaultConfig).plan!;
    expect(p.allocations.reduce((n, a) => n + a.units, 0)).toBe(p.quantity);
    expect(p.allocations.reduce((n, a) => n + a.procurement, 0)).toBeCloseTo(
      p.procurement,
    );
    expect(
      p.allocations.reduce((n, a) => n + a.stockCost, 0) + p.procurement,
    ).toBeCloseTo(p.effective);
  });
  it("minimum saving applies to every grouped member", () => {
    const r = solvePartition(buyers.slice(0, 4), producer, {
      ...defaultConfig,
      minimumSaving: 1400000,
    });
    for (const p of r.groups.filter((p) => p.ids.length > 1))
      expect(p.allocations.every((a) => a.saving >= 1400000)).toBe(true);
  });
  it("does not mutate input data", () => {
    const s = state(),
      copy = structuredClone(s);
    solvePartition(s.buyers, producer, s.config);
    expect(s).toEqual(copy);
  });
});
describe("audit: quotes and persistence", () => {
  it("approval requires every member", () => {
    let q = quote();
    for (const id of q.plan.ids.slice(0, -1))
      q = recordSample(
        q,
        { buyerId: id, result: "diterima", note: "" },
        defaultConfig.date,
      );
    expect(q.status).toBe("ditawarkan");
    q = recordSample(
      q,
      { buyerId: q.plan.ids.at(-1)!, result: "diterima", note: "" },
      defaultConfig.date,
    );
    expect(q.status).toBe("disetujui");
  });
  it("rejected sample cannot silently turn into acceptance", () => {
    const q = recordSample(
      quote(),
      {
        buyerId: "b1",
        result: "ditolak",
        attribute: "bahan",
        note: "Terlalu kasar",
      },
      defaultConfig.date,
    );
    expect(() =>
      recordSample(
        q,
        { buyerId: "b1", result: "diterima", note: "" },
        defaultConfig.date,
      ),
    ).toThrow(/putaran/);
  });
  it("expired offer, unknown member and rejection without reason blocked", () => {
    expect(() =>
      recordSample(
        quote(),
        { buyerId: "b1", result: "diterima", note: "" },
        "2026-10-26",
      ),
    ).toThrow(/kedaluwarsa/);
    expect(() =>
      recordSample(
        quote(),
        { buyerId: "b9", result: "diterima", note: "" },
        defaultConfig.date,
      ),
    ).toThrow(/anggota/);
    expect(() =>
      recordSample(
        quote(),
        { buyerId: "b1", result: "ditolak", note: "" },
        defaultConfig.date,
      ),
    ).toThrow(/alasan/);
  });
  it("overlapping quotes are replaced and responses archived", () => {
    let q = quote();
    q = recordSample(
      q,
      { buyerId: "b1", result: "diterima", note: "" },
      defaultConfig.date,
    );
    const p = solveGroup(buyers.slice(0, 3), producer, defaultConfig).plan!;
    const r = replaceQuote([q], {
      ...q,
      groupKey: p.ids.join("-"),
      plan: p,
      samples: [],
    });
    expect(r.quotes).toHaveLength(1);
    expect(r.archived).toHaveLength(1);
  });
  it("valid state round-trips including quote", () => {
    const s = { ...state(), quotes: [quote()] };
    expect(parseState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it("tampered monetary snapshot rejected", () => {
    const q = quote();
    q.plan.effective = 1;
    expect(() => parseState({ ...state(), quotes: [q] })).toThrow(/Snapshot/);
  });
  it("forged approved status and duplicate samples rejected", () => {
    const q = quote();
    q.status = "disetujui";
    expect(() => parseState({ ...state(), quotes: [q] })).toThrow(/Status/);
    q.status = "ditawarkan";
    q.samples = [
      { buyerId: "b1", result: "diterima", note: "" },
      { buyerId: "b1", result: "diterima", note: "" },
    ];
    expect(() => parseState({ ...state(), quotes: [q] })).toThrow(/ganda/);
  });
  it("unknown sample buyer and duplicate quote rejected", () => {
    expect(() =>
      parseState({
        ...state(),
        sampleHistory: [{ buyerId: "x", result: "diterima", note: "" }],
      }),
    ).toThrow();
    expect(() =>
      parseState({ ...state(), quotes: [quote(), quote()] }),
    ).toThrow(/ganda/);
  });
  it("two simultaneous stale writes cannot overwrite each other", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "batasbeli-test-"));
    try {
      const store = createStateStore(path.join(dir, "state.json"));
      const { etag } = await store.read();
      const a = state(),
        b = state();
      b.buyers[0].name = "Changed";
      const results = await Promise.allSettled([
        store.write(a, etag),
        store.write(b, etag),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
          .reason,
      ).toBeInstanceOf(ConflictError);
      expect((await store.read()).state).toEqual(a);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("corrupt stored data is preserved on attempted save", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "batasbeli-test-"));
    try {
      const file = path.join(dir, "state.json");
      await writeFile(file, "broken-json");
      const store = createStateStore(file);
      await expect(store.write(state(), '"empty"')).rejects.toThrow();
      expect(await readFile(file, "utf8")).toBe("broken-json");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
