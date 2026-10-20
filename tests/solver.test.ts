import { describe, it, expect } from "vitest";
import { buyers, producer, scenario } from "../src/domain/seed";
import { defaultConfig as c } from "../src/domain/config";
import {
  accepts,
  intersection,
  solveGroup,
  solvePartition,
  tierPrice,
  reviseAfterRejection,
  majority,
} from "../src/solver";
import { attributes } from "../src/domain/model";
describe("IRISPEK invariants", () => {
  it("irisan rentang", () =>
    expect(intersection(buyers.slice(0, 4), producer).values.panjang).toEqual([
      16, 18, 20,
    ]));
  it("irisan pilihan", () =>
    expect(intersection(buyers.slice(0, 4), producer).values.bahan).toEqual([
      "kraft",
    ]));
  it("konflik dan pembeli penyebab", () => {
    const s = scenario("S2"),
      r = solveGroup(s.buyers, producer, c);
    expect(r.plan).toBeUndefined();
    expect(r.issues[0].attribute).toBe("bahan");
    expect(r.issues[0].buyers).toContain("b4");
  });
  it("tingkat harga", () => {
    expect(tierPrice(999, producer)).toBe(1800);
    expect(tierPrice(1000, producer)).toBe(1450);
    expect(tierPrice(4000, producer)).toBe(1050);
  });
  it("MOQ dan konservasi stok", () => {
    const p = solveGroup([buyers[0]], producer, c).plan!;
    expect(p.quantity).toBe(1000);
    expect(p.allocations[0].excess).toBe(750);
    expect(p.effective).toBeGreaterThan(p.procurement);
  });
  it("S1 hemat untuk setiap anggota", () => {
    const p = solveGroup(scenario("S1").buyers, producer, c).plan!;
    expect(p.allocations.every((a) => a.saving > 0)).toBe(true);
    expect(p.allocations.reduce((s, a) => s + a.units, 0)).toBe(p.quantity);
  });
  it("S3 koordinasi ditolak", () => {
    const s = scenario("S3");
    expect(solveGroup(s.buyers, producer, s.config).issues[0].attribute).toBe(
      "biaya",
    );
    expect(
      solvePartition(s.buyers, producer, s.config).groups.every(
        (g) => g.ids.length === 1,
      ),
    ).toBe(true);
  });
  it("S5 rasionalitas individual", () => {
    const s = scenario("S5");
    expect(
      solveGroup(s.buyers, producer, s.config).issues.some((i) =>
        i.buyers.includes("b1"),
      ),
    ).toBe(true);
    expect(
      solvePartition(s.buyers, producer, s.config).groups.find((g) =>
        g.ids.includes("b1"),
      )?.ids,
    ).toEqual(["b1"]);
  });
  it("S4 revisi membutuhkan persetujuan dan menghitung ulang", () => {
    const b = { ...buyers[3].bounds.bahan, choices: ["ivory"], ideal: "ivory" };
    expect(() =>
      reviseAfterRejection(buyers, "b4", "bahan", b, false),
    ).toThrow();
    const revised = reviseAfterRejection(
      buyers.slice(0, 4),
      "b4",
      "bahan",
      b,
      true,
    );
    expect(solveGroup(revised, producer, c).plan).toBeUndefined();
    expect(solvePartition(revised, producer, c).groups.length).toBe(2);
  });
  it("tanpa kelompok layak", () => {
    const b = structuredClone(buyers[0]);
    b.bounds.bahan.choices = ["plastik"];
    expect(solvePartition([b], producer, c).unserved).toHaveLength(1);
  });
  it("baseline sendiri dan mayoritas memakai populasi sama", () => {
    const r = solvePartition(buyers, producer, c),
      solo = buyers.reduce(
        (s, b) => s + solveGroup([b], producer, c).plan!.effective,
        0,
      );
    expect(r.cost).toBeLessThan(solo);
    expect(majority(buyers, producer, c).excluded.length).toBeGreaterThan(0);
    expect(r.cost).toBeLessThan(majority(buyers, producer, c).total);
  });
  it("S6 dua kelompok lebih murah daripada satu spesifikasi premium bersama", () => {
    const s = scenario("S6"),
      r = solvePartition(s.buyers, producer, s.config);
    expect(r.groups).toHaveLength(2);
    expect(intersection(s.buyers, producer).values.bahan).toEqual(["premium"]);
    expect(r.cost).toBeLessThan(majority(s.buyers, producer, s.config).total);
  });
  it("tenggat ditolak", () =>
    expect(
      solveGroup([{ ...buyers[0], deadline: "2026-10-19" }], producer, c)
        .issues[0].attribute,
    ).toBe("tenggat"));
  it("properti acak deterministik: semua keluaran memenuhi setiap batas", () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let t = 0; t < 100; t++) {
      const bs = structuredClone(buyers.slice(0, 4));
      bs.forEach((b) => {
        b.bounds.panjang.min = 16 + Math.floor(rand() * 5) * 2;
        b.quantity = 50 + Math.floor(rand() * 900);
      });
      const r = solvePartition(bs, producer, c);
      for (const p of r.groups)
        for (const id of p.ids) {
          const b = bs.find((b) => b.id === id)!;
          expect(attributes.every((a) => accepts(b.bounds[a], p.spec[a]))).toBe(
            true,
          );
          expect(
            p.allocations.find((a) => a.buyerId === id)!.saving,
          ).toBeGreaterThanOrEqual(-0.00001);
        }
    }
  });
  it("tujuan ideal tetap memakai baseline sendiri termurah", () => {
    const s = scenario("S6");
    s.buyers.forEach((b) => (b.bounds.bahan.ideal = "premium"));
    const c = { ...s.config, objective: "ideal" as const };
    const r = solvePartition(s.buyers, producer, c);
    for (const p of r.groups)
      for (const a of p.allocations) {
        expect(a.solo).toBe(
          solveGroup([s.buyers.find((b) => b.id === a.buyerId)!], producer, {
            ...c,
            objective: "cost",
          }).plan!.effective,
        );
        expect(a.effective).toBeLessThanOrEqual(a.solo + 1e-7);
      }
  });
});
