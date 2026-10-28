"use client";
import { useEffect, useMemo, useState, useRef } from "react";
import {
  attributes,
  Attribute,
  Bound,
  Buyer,
  Config,
  Plan,
  Quote,
  Sample,
} from "@/domain/model";
import {
  buyers as initialBuyers,
  producer,
  scenario,
  scenarios,
} from "@/domain/seed";
import { defaultConfig } from "@/domain/config";
import {
  intersection,
  solveGroup,
  solvePartition,
  majority,
  reviseAfterRejection,
} from "@/solver";
import { buyerError, accepts as acceptsBound } from "@/domain/validation";
import { parseState } from "@/domain/state";
import { recordSample, replaceQuote } from "@/domain/workflow";
import { Modal } from "@/components/Modal";
import Image from "next/image";
const money = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
const num = (n: number) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(n);
const day = (iso: string) =>
  new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(iso));
const labels: Record<Attribute, string> = {
  panjang: "Panjang (cm)",
  lebar: "Lebar (cm)",
  bahan: "Bahan",
  warna: "Warna cetak",
};
const tabs = [
  "Ringkasan",
  "Pembeli & kebutuhan",
  "Pembentukan kelompok",
  "Penawaran & sampel",
  "Evaluasi",
];
export default function Home() {
  const [buyers, setBuyers] = useState<Buyer[]>(initialBuyers),
    [config, setConfig] = useState<Config>(defaultConfig),
    [tab, setTab] = useState(0),
    [active, setActive] = useState("S0"),
    [selected, setSelected] = useState<string[]>(
      initialBuyers.slice(0, 4).map((b) => b.id),
    ),
    [editing, setEditing] = useState<Buyer | null>(null),
    [quotes, setQuotes] = useState<Quote[]>([]),
    [message, setMessage] = useState(""),
    [loaded, setLoaded] = useState(false),
    [mode, setMode] = useState("auto"),
    [sampleHistory, setSampleHistory] = useState<Sample[]>([]);
  const [reject, setReject] = useState<{ key: string; id: string } | null>(
      null,
    ),
    [rejectAttr, setRejectAttr] = useState<Attribute>("bahan"),
    [rejectNote, setRejectNote] = useState(""),
    [revision, setRevision] = useState("ivory"),
    [consent, setConsent] = useState(false);
  const [etag, setEtag] = useState<string | null>(null),
    [saving, setSaving] = useState(false),
    [savedSnapshot, setSavedSnapshot] = useState<string | null>(null),
    [formError, setFormError] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  // braces matter: Chrome's scrollTo now returns a Promise, which React would treat as cleanup
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab]);
  function showSuggestions() {
    setMode("auto");
    setTab(2);
  }
  const currentState = useMemo(
    () => ({ buyers, config, quotes, sampleHistory, active }),
    [buyers, config, quotes, sampleHistory, active],
  );
  const snapshot = JSON.stringify(currentState),
    dirty = loaded && snapshot !== savedSnapshot;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/state", { signal: controller.signal, cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw Error();
        setEtag(r.headers.get("ETag"));
        return r.json();
      })
      .then((value) => {
        if (value) {
          const s = parseState(value);
          setSavedSnapshot(JSON.stringify(s));
          setBuyers(s.buyers);
          setConfig(s.config);
          setQuotes(s.quotes);
          setSampleHistory(s.sampleHistory ?? []);
          setActive(s.active ?? "S0");
          setSelected(s.buyers.slice(0, 4).map((b: Buyer) => b.id));
        } else
          // nothing saved yet: the untouched seed is the clean baseline, not "unsaved"
          setSavedSnapshot(
            JSON.stringify({
              buyers: initialBuyers,
              config: defaultConfig,
              quotes: [],
              sampleHistory: [],
              active: "S0",
            }),
          );
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setEtag(null);
          setMessage(
            "Data tersimpan gagal dimuat. Penyimpanan dikunci untuk melindungi file asli. Ekspor cadangan tersedia; periksa data/state.json lalu muat ulang.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoaded(true);
      });
    return () => controller.abort();
  }, []);
  const solution = useMemo(
    () => solvePartition(buyers, producer, config),
    [buyers, config],
  );
  const solo = useMemo(
    () =>
      buyers
        .map((b) => solveGroup([b], producer, config).plan)
        .filter((p): p is Plan => !!p),
    [buyers, config],
  );
  const baseline = solo.reduce((s, p) => s + p.effective, 0),
    totalStock = solution.groups
      .flatMap((p) => p.allocations)
      .reduce((s, a) => s + a.excess, 0),
    soloStock = solo
      .flatMap((p) => p.allocations)
      .reduce((s, a) => s + a.excess, 0);
  const chosen = buyers.filter((b) => selected.includes(b.id)),
    manual = useMemo(
      () => solveGroup(chosen, producer, config),
      [buyers, selected, config],
    ),
    overlap = chosen.length
      ? intersection(chosen, producer)
      : {
          values: { panjang: [], lebar: [], bahan: [], warna: [] },
          issues: [],
        },
    major = useMemo(() => majority(buyers, producer, config), [buyers, config]);
  const samples = [...sampleHistory, ...quotes.flatMap((q) => q.samples)],
    accepted = samples.filter((s) => s.result === "diterima").length;
  const serving = buyers.length - solution.unserved.length;
  function reset(id: string) {
    if (
      dirty &&
      !window.confirm(
        "Perubahan belum disimpan. Ganti skenario dan hapus perubahan aktif? Ekspor JSON tersedia untuk cadangan.",
      )
    )
      return;
    const s = scenario(id);
    setActive(id);
    setBuyers(s.buyers);
    setConfig(s.config);
    setSelected(s.buyers.map((b) => b.id));
    setQuotes([]);
    setSampleHistory([]);
    setMessage(
      "Skenario dimuat. Klik Simpan untuk menyimpannya ke JSON lokal.",
    );
    if (id === "S4") {
      const p = solveGroup(s.buyers, producer, s.config).plan!;
      setQuotes([
        {
          groupKey: p.ids.join("-"),
          plan: p,
          expires: "2026-10-25",
          status: "ditolak",
          samples: [
            {
              buyerId: "b4",
              result: "ditolak",
              attribute: "bahan",
              note: "Sampel kraft tidak cocok; pembeli meminta ivory.",
            },
          ],
        },
      ]);
      setTab(3);
    } else setTab(2);
  }
  function invalidateQuotes() {
    setSampleHistory((h) => [...h, ...quotes.flatMap((q) => q.samples)]);
    setQuotes([]);
  }
  function changeBuyers(next: Buyer[]) {
    setBuyers(next);
    invalidateQuotes();
    setMessage(
      "Kebutuhan diperbarui. Penawaran lama dibatalkan karena hasil solver berubah.",
    );
  }
  async function save() {
    if (!etag || saving) return;
    setSaving(true);
    const sent = snapshot;
    try {
      parseState(currentState);
      const r = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": etag },
        body: sent,
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setEtag(r.headers.get("ETag"));
      setSavedSnapshot(sent);
      setMessage("Semua perubahan tersimpan.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setSaving(false);
    }
  }
  function download(text: string, name: string, type = "application/json") {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(file: File) {
    try {
      if (file.size > 200000) throw Error("Cadangan melebihi 200 KB.");
      const s = parseState(JSON.parse(await file.text()));
      if (
        dirty &&
        !window.confirm("Ganti perubahan aktif dengan cadangan ini?")
      )
        return;
      setBuyers(s.buyers);
      setConfig(s.config);
      setQuotes(s.quotes);
      setSampleHistory(s.sampleHistory);
      setActive(s.active);
      setSelected(s.buyers.map((b) => b.id));
      setMessage(
        "Cadangan dimuat dan divalidasi. Klik Simpan perubahan untuk menyimpannya.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Cadangan gagal dimuat.");
    }
  }
  function exportCosts() {
    const rows = [
      [
        "Pembeli",
        "Kelompok",
        "Kebutuhan",
        "Alokasi unit",
        "Stok lebih",
        "Biaya efektif Rp",
        "Pesan sendiri Rp",
        "Hemat Rp",
        "Deviasi",
      ],
      ...solution.groups.flatMap((p, i) =>
        p.allocations.map((a) => [
          buyers.find((b) => b.id === a.buyerId)!.name,
          i + 1,
          buyers.find((b) => b.id === a.buyerId)!.quantity,
          a.units,
          a.excess,
          a.effective,
          a.solo,
          a.saving,
          a.deviation,
        ]),
      ),
    ];
    download(
      "\uFEFF" +
        rows
          .map((row) =>
            row
              .map(
                (v) =>
                  '"' +
                  String(v)
                    .replace(/^[=+@-]/, "'$&")
                    .replaceAll('"', '""') +
                  '"',
              )
              .join(";"),
          )
          .join("\r\n"),
      "irispek-biaya-" + active + ".csv",
      "text/csv;charset=utf-8",
    );
  }
  function offer(p: Plan) {
    const key = p.ids.join("-");
    const expires = new Date(Date.parse(config.date) + 7 * 86400000)
      .toISOString()
      .slice(0, 10);
    const result = replaceQuote(quotes, {
      groupKey: key,
      plan: p,
      expires,
      status: "ditawarkan",
      samples: [],
    });
    setSampleHistory((h) => [...h, ...result.archived]);
    setQuotes(result.quotes);
    setTab(3);
    setMessage(
      "Penawaran simulasi dibuat. Penawaran lama dengan anggota yang sama diarsipkan. Semua anggota harus menyetujui sampel baru.",
    );
  }
  function sample(
    key: string,
    id: string,
    result: "diterima" | "ditolak",
    attribute?: Attribute,
    note = "",
  ) {
    try {
      setQuotes(
        quotes.map((q) =>
          q.groupKey === key
            ? recordSample(
                q,
                { buyerId: id, result, attribute, note },
                config.date,
              )
            : q,
        ),
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Respons gagal dicatat.");
    }
  }
  function revise() {
    if (!reject || !consent) return;
    const b = buyers.find((b) => b.id === reject.id)!;
    const value = rejectAttr === "bahan" ? revision : Number(revision);
    if (!producer.catalog[rejectAttr].includes(value)) {
      setMessage("Pilih nilai yang tersedia dalam katalog.");
      return;
    }
    const bound: Bound = {
      type: "wajib_tepat",
      choices: [value],
      ideal: value,
      weight: b.bounds[rejectAttr].weight,
    };
    const archived = quotes.flatMap((q) =>
      q.groupKey === reject.key
        ? [
            ...q.samples.filter((s) => s.buyerId !== reject.id),
            {
              buyerId: reject.id,
              result: "ditolak" as const,
              attribute: rejectAttr,
              note: rejectNote,
            },
          ]
        : q.samples,
    );
    setSampleHistory((h) => [...h, ...archived]);
    setBuyers(reviseAfterRejection(buyers, reject.id, rejectAttr, bound, true));
    setQuotes([]);
    setMessage(
      "Batas diperbarui dengan persetujuan pembeli. Penolakan diarsipkan dan kelompok dihitung ulang.",
    );
    setReject(null);
    setTab(2);
  }
  function planCard(p: Plan, i: number) {
    return (
      <article className="card plan" key={p.ids.join("-")}>
        <div className="row">
          <div>
            <span className="eyebrow">
              {p.ids.length > 1 ? "KELOMPOK" : "PESAN SENDIRI"}{" "}
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3>
              {p.ids
                .map((id) => buyers.find((b) => b.id === id)?.name)
                .join(" · ")}
            </h3>
          </div>
          <span className="badge">Batas terpenuhi</span>
        </div>
        <div className="specs">
          {attributes.map((a) => (
            <span key={a}>
              {labels[a]} <b>{p.spec[a]}</b>
            </span>
          ))}
        </div>
        <div className="row metrics">
          <span>
            <small>Jumlah produksi</small>
            <b>{num(p.quantity)} unit</b>
          </span>
          <span>
            <small>Harga satuan</small>
            <b>{money(p.unitPrice)}</b>
          </span>
          <span>
            <small>Total efektif</small>
            <b>{money(p.effective)}</b>
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pembeli</th>
                <th>Alokasi / stok lebih</th>
                <th>Biaya efektif</th>
                <th>Efektif/unit kebutuhan</th>
                <th>Hemat vs sendiri</th>
                <th>Deviasi</th>
              </tr>
            </thead>
            <tbody>
              {p.allocations.map((a) => (
                <tr key={a.buyerId}>
                  <td>{buyers.find((b) => b.id === a.buyerId)?.name}</td>
                  <td>
                    {a.units} / +{a.excess}
                  </td>
                  <td>{money(a.effective)}</td>
                  <td>
                    {money(
                      a.effective /
                        buyers.find((b) => b.id === a.buyerId)!.quantity,
                    )}
                  </td>
                  <td className="green">{money(a.saving)}</td>
                  <td>{num(a.deviation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details>
          <summary>Rincian biaya pengadaan</summary>
          <p>
            Setup {money(p.setup)} · koordinasi {money(p.coordination)} ·
            platform {money(p.platform)} · cetak desain {money(producer.design)}{" "}
            per pembeli. Pengadaan {money(p.procurement)}, penalti stok{" "}
            {money(p.effective - p.procurement)}. Pengiriman sesuai zona per
            pembeli; setup dan biaya bersama dibagi proporsional kebutuhan.
          </p>
        </details>
        <button className="secondary" onClick={() => offer(p)}>
          Buat penawaran simulasi ↗
        </button>
      </article>
    );
  }
  if (!loaded)
    return (
      <main className="loading-screen" aria-busy="true">
        <Image
          className="loading-mark"
          src="/brand/irispek-mark.png"
          alt="IRISPEK"
          width={512}
          height={416}
          loading="eager"
        />
        <h1>Menyiapkan ruang pengadaan…</h1>
        <p>Memuat kebutuhan dan data tersimpan.</p>
      </main>
    );
  return (
    <div className="shell">
      <aside>
        <a
          className="brand"
          href="/app"
          aria-label="IRISPEK — beranda aplikasi"
        >
          <Image
            className="brand-mark"
            src="/brand/irispek-mark.png"
            alt=""
            width={512}
            height={416}
            loading="eager"
          />
          <Image
            className="brand-word"
            src="/brand/irispek-wordmark.png"
            alt=""
            width={600}
            height={98}
            loading="eager"
          />
        </a>
        <div className="workspace">
          <span className="avatar">UM</span>
          <div>
            <b>Pengadaan UMKM</b>
            <small>Ruang simulasi</small>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {tabs.map((t, i) => (
            <button
              aria-label={t}
              aria-current={tab === i ? "page" : undefined}
              title={t}
              className={tab === i ? "active" : ""}
              key={t}
              onClick={() => setTab(i)}
            >
              <span aria-hidden="true">{["◫", "♧", "⊞", "▤", "◷"][i]}</span>
              {t}
              <span className="mobile-nav-label">
                {["Ringkasan", "Pembeli", "Kelompok", "Sampel", "Evaluasi"][i]}
              </span>
              {i === 1 && <em aria-hidden="true">{buyers.length}</em>}
            </button>
          ))}
        </nav>
        <a className="about-link" href="/" title="Profil perusahaan">
          <span aria-hidden="true">◎</span>
          Tentang IRISPEK
        </a>
        <div className="sidebar-note">
          <span>◈</span>
          <b>Kebutuhan jadi batas.</b>
          <p>Hemat bersama, tanpa mengorbankan syarat siapa pun.</p>
        </div>
        <div className="producer">
          <span className="online" /> {producer.name}
          <small>1 produsen · kemasan kertas</small>
        </div>
      </aside>
      <main>
        <header>
          <div>
            Workspace <span>/</span> <b>{tabs[tab]}</b>
          </div>
          <div className="row">
            <span className="simulation">● Mode simulasi</span>
            <span className={"save-state " + (dirty ? "unsaved" : "")}>
              {saving
                ? "Menyimpan…"
                : dirty
                  ? "● Belum disimpan"
                  : "✓ Tersimpan"}
            </span>
            <button
              className="secondary"
              disabled={!etag || saving || !dirty}
              onClick={save}
            >
              {saving ? "Menyimpan…" : "Simpan perubahan"}
            </button>
          </div>
        </header>
        <div className="content">
          <div className="heading">
            <div className="eyebrow">PENGADAAN BERBASIS KEBUTUHAN</div>
            <div className="row">
              <h1>
                {tabs[tab] === "Ringkasan"
                  ? "Beli bersama. Tetap sesuai."
                  : tabs[tab]}
              </h1>
              <span className="date">
                Simulasi ·{" "}
                {new Intl.DateTimeFormat("id-ID", {
                  dateStyle: "long",
                  timeZone: "UTC",
                }).format(new Date(config.date))}
              </span>
            </div>
            <p>
              Temukan irisan kebutuhan, bentuk kelompok yang cocok, dan ukur
              penghematan yang nyata.
            </p>
          </div>
          {message && (
            <div role="status" className="notice">
              {message}
              <button aria-label="Tutup pesan" onClick={() => setMessage("")}>
                ×
              </button>
            </div>
          )}
          <div className="data-toolbar">
            <span>Data lokal · {buyers.length} pembeli</span>
            <div>
              <button
                className="text-button"
                onClick={() =>
                  download(
                    JSON.stringify(currentState, null, 2),
                    "irispek-" + active + ".json",
                  )
                }
              >
                Ekspor JSON ↓
              </button>
              <button
                className="text-button"
                onClick={() => importRef.current?.click()}
              >
                Impor JSON ↑
              </button>
              <input
                ref={importRef}
                type="file"
                accept=".json,application/json"
                hidden
                aria-label="Impor cadangan JSON"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importFile(f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
          <div className="scenario-bar">
            <div>
              <b>Laboratorium skenario</b>
              <small>Jalankan kasus yang sama di semua mode.</small>
            </div>
            <select
              aria-label="Skenario"
              value={active}
              onChange={(e) => reset(e.target.value)}
            >
              {scenarios.map(([id, title]) => (
                <option key={id} value={id}>
                  {id} — {title}
                </option>
              ))}
            </select>
            <button className="text-button" onClick={() => reset(active)}>
              Muat ulang ↻
            </button>
          </div>
          {tab === 0 && (
            <>
              <section className="hero">
                <div>
                  <span className="eyebrow">LEBIH COCOK, LEBIH HEMAT</span>
                  <h2>
                    Mulai dari batas kebutuhan.
                    <br />
                    Bukan dari kompromi.
                  </h2>
                  <p>
                    {serving} pembeli dapat dilayani dengan seluruh batas
                    terpenuhi.
                    <br />
                    Lihat kelompok yang masuk akal untuk setiap usaha.
                  </p>
                  <button onClick={showSuggestions}>
                    Lihat saran kelompok <span>→</span>
                  </button>
                </div>
                <div className="diagram">
                  <div className="orbit one">
                    Kebutuhan
                    <br />
                    <b>Anda</b>
                  </div>
                  <div className="orbit two">
                    Kebutuhan
                    <br />
                    <b>Bersama</b>
                  </div>
                  <span className="intersection-label">✓ Cocok</span>
                  <small>Irisan spesifikasi yang diterima</small>
                </div>
              </section>
              <section className="stat-grid">
                <Stat
                  label="Penghematan efektif"
                  value={money(baseline - solution.cost)}
                  note={`${baseline ? num(((baseline - solution.cost) / baseline) * 100) : 0}% dibanding pesan sendiri`}
                  accent
                />
                <Stat
                  label="Total biaya efektif"
                  value={money(solution.cost)}
                  note="Termasuk koordinasi & risiko stok"
                />
                <Stat
                  label="Kelebihan stok"
                  value={`${num(totalStock)} unit`}
                  note={`Pesan sendiri: ${num(soloStock)} unit`}
                />
                <Stat
                  label="Kepatuhan batas"
                  value={serving ? "100%" : "—"}
                  note={`${serving}/${buyers.length} pembeli terlayani`}
                />
              </section>
              <div className="section-title">
                <h2>Kelompok yang direkomendasikan</h2>
                <button className="text-button" onClick={showSuggestions}>
                  Lihat semua →
                </button>
              </div>
              {solution.groups.map(planCard)}
            </>
          )}
          {tab === 1 && (
            <>
              <div className="section-title">
                <h2>{buyers.length} pembeli, kebutuhan yang beragam</h2>
                <span className="muted">
                  Klik ubah untuk menyusun batas kebutuhan
                </span>
              </div>
              <div className="card table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Usaha</th>
                      <th>Zona</th>
                      <th>Kebutuhan</th>
                      <th>Tenggat</th>
                      <th>Batas utama</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {buyers.map((b, i) => (
                      <tr key={b.id}>
                        <td>
                          <span className="buyer-icon">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <b>{b.name}</b>
                        </td>
                        <td>{b.zone}</td>
                        <td>{num(b.quantity)} unit</td>
                        <td>{day(b.deadline)}</td>
                        <td>
                          {b.bounds.bahan.choices?.join(", ")} ·{" "}
                          {b.bounds.panjang.min ??
                            b.bounds.panjang.choices?.[0]}{" "}
                          cm
                        </td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => (
                              setFormError(""),
                              setEditing(structuredClone(b))
                            )}
                          >
                            Ubah ↗
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted">
                Wajib harus terpenuhi. Fleksibel adalah pilihan atau rentang
                yang masih diterima, dengan preferensi ideal sebagai penentu
                deviasi.
              </p>
            </>
          )}
          {tab === 2 && (
            <>
              <div className="row section-title">
                <div className="segmented">
                  <button
                    aria-pressed={mode === "auto"}
                    className={mode === "auto" ? "selected" : ""}
                    onClick={() => setMode("auto")}
                  >
                    Saran solver
                  </button>
                  <button
                    aria-pressed={mode === "manual"}
                    className={mode === "manual" ? "selected" : ""}
                    onClick={() => setMode("manual")}
                  >
                    Pilih manual
                  </button>
                </div>
                <span className="muted">
                  Partisi optimal · maksimal 10 pembeli
                </span>
              </div>
              {mode === "manual" ? (
                <>
                  <div className="card">
                    <h3>Anggota kelompok</h3>
                    <div className="checks">
                      {buyers.map((b) => (
                        <label key={b.id}>
                          <input
                            type="checkbox"
                            checked={selected.includes(b.id)}
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? [...selected, b.id]
                                  : selected.filter((id) => id !== b.id),
                              )
                            }
                          />
                          {b.name}
                        </label>
                      ))}
                    </div>
                    <h3>Peta irisan spesifikasi</h3>
                    {attributes.map((a) => (
                      <div className="overlap" key={a}>
                        <b>{labels[a]}</b>
                        <div className="chips">
                          {producer.catalog[a].map((v) => (
                            <span
                              className={
                                overlap.values[a].includes(v)
                                  ? "match"
                                  : "no-match"
                              }
                              key={v}
                            >
                              {v}
                            </span>
                          ))}
                        </div>
                        <small>
                          {overlap.values[a].length
                            ? "Irisan tersedia"
                            : "Tidak ada irisan"}
                        </small>
                      </div>
                    ))}
                    <p className="muted">
                      Hijau: diterima seluruh anggota dan tersedia di katalog.
                      Abu-abu: di luar irisan.
                    </p>
                  </div>
                  {manual.plan ? (
                    planCard(manual.plan, 0)
                  ) : (
                    <div className="error card">
                      <h3>Kelompok belum layak</h3>
                      {manual.issues.map((i, n) => (
                        <p key={n}>
                          {i.message}{" "}
                          <b>
                            {i.buyers
                              .map(
                                (id) => buyers.find((b) => b.id === id)?.name,
                              )
                              .join(", ")}
                          </b>
                        </p>
                      ))}
                      <button onClick={() => setMode("auto")}>
                        Lihat kelompok alternatif →
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {solution.groups.map(planCard)}
                  {solution.ungrouped.map((u) => (
                    <div className="notice" key={u.buyer.id}>
                      <b>{u.buyer.name}: pesan sendiri.</b> {u.reason}
                    </div>
                  ))}
                  {solution.unserved.map((u) => (
                    <div className="error card" key={u.buyer.id}>
                      <b>{u.buyer.name} tidak terlayani</b>
                      {u.issues.map((i, n) => (
                        <p key={n}>{i.message}</p>
                      ))}
                    </div>
                  ))}
                </>
              )}
              <details className="card parameters">
                <summary>Parameter simulasi & kemampuan produsen</summary>
                <div className="form-grid">
                  {(
                    [
                      "platform",
                      "coordination",
                      "communication",
                      "stockRate",
                      "minimumSaving",
                      "deviationWeight",
                    ] as const
                  ).map((k) => (
                    <label key={k}>
                      {
                        {
                          platform: "Biaya platform / kelompok",
                          coordination: "Biaya waktu admin / kelompok",
                          communication: "Komunikasi / anggota",
                          stockRate: "Penalti nilai stok (rasio)",
                          minimumSaving: "Minimum hemat / anggota",
                          deviationWeight: "Bobot deviasi",
                        }[k]
                      }
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={config[k]}
                        onChange={(e) => {
                          setConfig({
                            ...config,
                            [k]: Math.max(0, Number(e.target.value)),
                          });
                          invalidateQuotes();
                        }}
                      />
                    </label>
                  ))}
                  <label>
                    Tujuan pemilihan spesifikasi
                    <select
                      value={config.objective}
                      onChange={(e) => {
                        setConfig({
                          ...config,
                          objective: e.target.value as Config["objective"],
                        });
                        invalidateQuotes();
                      }}
                    >
                      <option value="cost">Biaya minimum</option>
                      <option value="ideal">Deviasi minimum</option>
                    </select>
                  </label>
                  <label>
                    Tanggal mulai simulasi
                    <input
                      type="date"
                      required
                      value={config.date}
                      onChange={(e) => {
                        if (e.target.value) {
                          setConfig({ ...config, date: e.target.value });
                          invalidateQuotes();
                        }
                      }}
                    />
                  </label>
                </div>
                <p>
                  MOQ {producer.moq} unit per varian · setup{" "}
                  {money(producer.setup)} · lead time {producer.leadDays} hari.
                  Bahan premium menambah Rp1.800/unit. Harga dasar:{" "}
                  {producer.tiers
                    .map((t) => `${t.min}+ unit: ${money(t.price)}`)
                    .join(" · ")}
                  .
                </p>
              </details>
            </>
          )}
          {tab === 3 && (
            <>
              <div className="stat-grid">
                <Stat
                  label="Penerimaan sampel"
                  value={
                    samples.length
                      ? `${num((accepted / samples.length) * 100)}%`
                      : "Belum ada"
                  }
                  note={`${accepted} diterima dari ${samples.length} respons lintas putaran`}
                />
                <Stat
                  label="Kelompok disetujui"
                  value={String(
                    quotes.filter((q) => q.status === "disetujui").length,
                  )}
                  note="Harus disetujui semua anggota"
                />
              </div>
              {!quotes.length && (
                <div className="card empty">
                  <h2>Uji kecocokan sebelum pengadaan.</h2>
                  <p>
                    Buat penawaran dari kelompok yang layak, lalu catat
                    persetujuan sampel setiap pembeli.
                  </p>
                  <button onClick={showSuggestions}>Pilih kelompok →</button>
                </div>
              )}
              {quotes.map((q) => (
                <article className="card" key={q.groupKey}>
                  <div className="row">
                    <h3>Penawaran {q.groupKey.toUpperCase()}</h3>
                    <span
                      className={
                        "badge " + (q.status === "ditolak" ? "red" : "")
                      }
                    >
                      {q.status}
                    </span>
                  </div>
                  <p>
                    {money(q.plan.unitPrice)} / unit · setup{" "}
                    {money(q.plan.setup)} · total pengadaan{" "}
                    {money(q.plan.procurement)} · berlaku sampai{" "}
                    {day(q.expires)}
                  </p>
                  {q.plan.ids.map((id) => {
                    const s = q.samples.find((s) => s.buyerId === id);
                    return (
                      <div className="sample-row" key={id}>
                        <b>{buyers.find((b) => b.id === id)?.name}</b>
                        <span>
                          {s?.result ?? "Menunggu sampel"}
                          {s?.note && (
                            <small>
                              {s.attribute}: {s.note}
                            </small>
                          )}
                        </span>
                        <div className="row">
                          <button
                            className="secondary"
                            disabled={
                              s?.result === "ditolak" ||
                              s?.result === "diterima" ||
                              config.date > q.expires
                            }
                            onClick={() => sample(q.groupKey, id, "diterima")}
                          >
                            Terima
                          </button>
                          <button
                            className="text-button"
                            disabled={
                              s?.result !== "ditolak" && config.date > q.expires
                            }
                            onClick={() => {
                              setReject({ key: q.groupKey, id });
                              setRejectAttr(s?.attribute ?? "bahan");
                              setRejectNote(s?.note ?? "");
                              setRevision(
                                String(
                                  producer.catalog[s?.attribute ?? "bahan"][0],
                                ),
                              );
                              setConsent(false);
                            }}
                          >
                            {s?.result === "ditolak"
                              ? "Tinjau & hitung ulang"
                              : "Tolak"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {q.status === "ditolak" && (
                    <div className="notice">
                      Pengadaan diblokir. Tinjau alasan bersama pembeli, setujui
                      batas baru, lalu hitung ulang; atau bubarkan kelompok.
                      <button
                        className="text-button"
                        onClick={() => {
                          setSampleHistory((h) => [...h, ...q.samples]);
                          setQuotes(
                            quotes.filter((x) => x.groupKey !== q.groupKey),
                          );
                        }}
                      >
                        Bubarkan
                      </button>
                    </div>
                  )}
                  {q.status === "disetujui" && (
                    <p className="green">
                      ✓ Semua anggota menerima sampel. Rencana siap dalam
                      simulasi; tidak ada transaksi nyata.
                    </p>
                  )}
                </article>
              ))}
            </>
          )}
          {tab === 4 && (
            <>
              <section className="card">
                <span className="eyebrow">PERBANDINGAN YANG SETARA</span>
                <div className="row">
                  <h2>Tiga cara membeli. Satu data kebutuhan.</h2>
                  <button className="secondary" onClick={exportCosts}>
                    Ekspor biaya CSV ↓
                  </button>
                </div>
                <p>
                  Pembeli yang tidak cocok dengan spesifikasi mayoritas memesan
                  sendiri. Seluruh biaya mereka tetap dihitung.
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Metrik</th>
                        <th>Pesan sendiri</th>
                        <th>Spesifikasi mayoritas</th>
                        <th className="green">IRISPEK</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Total biaya efektif</td>
                        <td>{money(baseline)}</td>
                        <td>{money(major.total)}</td>
                        <td>
                          <b>{money(solution.cost)}</b>
                        </td>
                      </tr>
                      <tr>
                        <td>Biaya / unit kebutuhan terlayani</td>
                        <td>
                          {money(
                            baseline /
                              (solo.reduce(
                                (s, p) =>
                                  s +
                                  buyers.find((b) => b.id === p.ids[0])!
                                    .quantity,
                                0,
                              ) || 1),
                          )}
                        </td>
                        <td>
                          {money(
                            major.total /
                              (buyers
                                .filter(
                                  (b) => solveGroup([b], producer, config).plan,
                                )
                                .reduce((s, b) => s + b.quantity, 0) || 1),
                          )}
                        </td>
                        <td>
                          {money(
                            solution.cost /
                              (solution.groups
                                .flatMap((p) => p.ids)
                                .reduce(
                                  (s, id) =>
                                    s +
                                    buyers.find((b) => b.id === id)!.quantity,
                                  0,
                                ) || 1),
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td>Kelebihan stok (unit)</td>
                        <td>{num(soloStock)}</td>
                        <td>
                          {num(
                            (major.grouped?.allocations.reduce(
                              (s, a) => s + a.excess,
                              0,
                            ) ?? 0) +
                              solo
                                .filter((p) =>
                                  major.excluded.some((b) => b.id === p.ids[0]),
                                )
                                .reduce(
                                  (s, p) => s + p.allocations[0].excess,
                                  0,
                                ),
                          )}
                        </td>
                        <td>{num(totalStock)}</td>
                      </tr>
                      <tr>
                        <td>Penalti stok</td>
                        <td>
                          {money(
                            solo.reduce(
                              (s, p) => s + p.effective - p.procurement,
                              0,
                            ),
                          )}
                        </td>
                        <td>
                          {money(
                            (major.grouped
                              ? major.grouped.effective -
                                major.grouped.procurement
                              : 0) +
                              solo
                                .filter((p) =>
                                  major.excluded.some((b) => b.id === p.ids[0]),
                                )
                                .reduce(
                                  (s, p) => s + p.effective - p.procurement,
                                  0,
                                ),
                          )}
                        </td>
                        <td>
                          {money(
                            solution.groups.reduce(
                              (s, p) => s + p.effective - p.procurement,
                              0,
                            ),
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td>Pengadaan, termasuk koordinasi & platform</td>
                        <td>
                          {money(solo.reduce((s, p) => s + p.procurement, 0))}
                        </td>
                        <td>
                          {money(
                            (major.grouped?.procurement ?? 0) +
                              solo
                                .filter((p) =>
                                  major.excluded.some((b) => b.id === p.ids[0]),
                                )
                                .reduce((s, p) => s + p.procurement, 0),
                          )}
                        </td>
                        <td>
                          {money(
                            solution.groups.reduce(
                              (s, p) => s + p.procurement,
                              0,
                            ),
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td>Terlayani, seluruh batas terpenuhi</td>
                        <td>
                          {solo.length}/{buyers.length}
                        </td>
                        <td>
                          {buyers.length - major.unserved}/{buyers.length}
                        </td>
                        <td>
                          {serving}/{buyers.length}
                        </td>
                      </tr>
                      <tr>
                        <td>Tidak masuk kelompok bersama</td>
                        <td>{buyers.length}</td>
                        <td>{major.excluded.length}</td>
                        <td>
                          {solution.ungrouped.length + solution.unserved.length}
                        </td>
                      </tr>
                      <tr>
                        <td>Deviasi rata-rata per pembeli terlayani</td>
                        <td>
                          {num(
                            solo
                              .flatMap((p) => p.allocations)
                              .reduce((s, a) => s + a.deviation, 0) /
                              (solo.length || 1),
                          )}
                        </td>
                        <td>
                          {num(
                            [
                              ...(major.grouped?.allocations ?? []),
                              ...solo
                                .filter((p) =>
                                  major.excluded.some((b) => b.id === p.ids[0]),
                                )
                                .flatMap((p) => p.allocations),
                            ].reduce((s, a) => s + a.deviation, 0) /
                              (buyers.length - major.unserved || 1),
                          )}
                        </td>
                        <td>
                          {num(
                            solution.groups
                              .flatMap((p) => p.allocations)
                              .reduce((s, a) => s + a.deviation, 0) /
                              (serving || 1),
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="notice">
                  {!serving
                    ? "Tidak ada pembeli terlayani. Belum ada penghematan yang dapat dinilai."
                    : solution.cost < baseline
                      ? "IRISPEK lebih murah daripada pesan sendiri."
                      : "IRISPEK tidak memberi penghematan dibanding pesan sendiri pada parameter ini."}{" "}
                  {solution.cost < major.total
                    ? "Lebih murah juga daripada mode mayoritas."
                    : "Tidak lebih murah daripada mode mayoritas."}
                </div>
                {solution.unserved.length > 0 && (
                  <p className="error">
                    Sebagian pembeli tidak terlayani. Total biaya hanya mencakup
                    yang terlayani; jangan membandingkan penghematan tanpa
                    melihat cakupan.
                  </p>
                )}
                <p className="muted">
                  Mode mayoritas tidak menjamin rasionalitas biaya individual.
                  Lihat biaya individual IRISPEK di kartu kelompok. Penerimaan
                  sampel saat ini:{" "}
                  {samples.length
                    ? `${num((accepted / samples.length) * 100)}%`
                    : "belum diukur"}
                  .
                </p>
              </section>
              <section className="card">
                <h3>Hasil seluruh skenario</h3>
                <p>
                  Ringkasan menggunakan seed masing-masing skenario; tabel di
                  atas memakai data aktif yang dapat Anda ubah.
                </p>
                <ScenarioTable />
              </section>
            </>
          )}
          <footer>
            IRISPEK <span>Irisan spesifikasi, pengadaan bersama.</span>
            <a className="text-button" href="/">
              Profil perusahaan →
            </a>
            <small>Simulasi · tanpa pembayaran nyata</small>
          </footer>
        </div>
      </main>
      {editing && (
        <Modal label="Kebutuhan pembeli" onClose={() => setEditing(null)}>
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              const error = buyerError(editing, producer);
              if (error) {
                setFormError(error);
                return;
              }
              changeBuyers(
                buyers.map((b) => (b.id === editing.id ? editing : b)),
              );
              setEditing(null);
            }}
          >
            <div className="row">
              <h2>Kebutuhan pembeli</h2>
              <button
                type="button"
                className="text-button"
                onClick={() => setEditing(null)}
              >
                Tutup ×
              </button>
            </div>
            {formError && (
              <p role="alert" className="form-error">
                {formError}
              </p>
            )}
            <div className="form-grid">
              <label>
                Nama usaha
                <input
                  required
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                />
              </label>
              <label>
                Zona
                <select
                  value={editing.zone}
                  onChange={(e) =>
                    setEditing({ ...editing, zone: e.target.value })
                  }
                >
                  {Object.keys(producer.shipping).map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </select>
              </label>
              <label>
                Kebutuhan unit
                <input
                  required
                  type="number"
                  min="1"
                  step="1"
                  value={editing.quantity}
                  onChange={(e) =>
                    setEditing({ ...editing, quantity: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Tenggat
                <input
                  required
                  type="date"
                  value={editing.deadline}
                  onChange={(e) =>
                    setEditing({ ...editing, deadline: e.target.value })
                  }
                />
              </label>
            </div>
            {attributes.map((a) => (
              <BoundEditor
                key={a}
                attribute={a}
                bound={editing.bounds[a]}
                update={(bound) =>
                  setEditing({
                    ...editing,
                    bounds: { ...editing.bounds, [a]: bound },
                  })
                }
              />
            ))}
            <button type="submit">Simpan kebutuhan & hitung ulang</button>
          </form>
        </Modal>
      )}
      {reject && (
        <Modal label="Tinjau sampel" onClose={() => setReject(null)}>
          <div className="modal">
            <h2>Tinjau sampel</h2>
            <label>
              Atribut penyebab
              <select
                value={rejectAttr}
                onChange={(e) => {
                  const a = e.target.value as Attribute;
                  setRejectAttr(a);
                  setRevision(String(producer.catalog[a][0]));
                }}
              >
                {attributes.map((a) => (
                  <option key={a} value={a}>
                    {labels[a]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Alasan / catatan
              <textarea
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="Jelaskan ketidakcocokan sampel"
              />
            </label>
            <button
              disabled={!rejectNote.trim()}
              onClick={() => {
                sample(
                  reject.key,
                  reject.id,
                  "ditolak",
                  rejectAttr,
                  rejectNote,
                );
                setReject(null);
              }}
            >
              Catat penolakan
            </button>
            <hr />
            <h3>Usulan batas baru (wajib tepat)</h3>
            <label>
              Nilai yang diterima
              <select
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
              >
                {producer.catalog[rejectAttr].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              Pembeli menyetujui perubahan batas ini.
            </label>
            {(!consent || !rejectNote.trim()) && (
              <p className="muted">
                Isi alasan penolakan dan centang persetujuan pembeli untuk
                mengubah batas.
              </p>
            )}
            <div className="row">
              <button
                disabled={!consent || !rejectNote.trim()}
                onClick={revise}
              >
                Ubah batas & hitung ulang
              </button>
              <button className="secondary" onClick={() => setReject(null)}>
                Tutup
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  note,
  accent = false,
}: {
  label: string;
  value: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <article className={"stat " + (accent ? "accent" : "")}>
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{note}</span>
    </article>
  );
}
function BoundEditor({
  attribute: a,
  bound: r,
  update,
}: {
  attribute: Attribute;
  bound: Bound;
  update: (b: Bound) => void;
}) {
  return (
    <fieldset>
      <legend>{labels[a]}</legend>
      <div className="form-grid">
        <label>
          Tipe batas
          <select
            value={r.type}
            onChange={(e) => {
              const type = e.target.value as Bound["type"];
              const isChoice =
                type === "wajib_tepat" || type === "fleksibel_pilihan";
              update({
                ...r,
                type,
                choices: isChoice ? [r.ideal] : undefined,
                min: isChoice ? undefined : Number(producer.catalog[a][0]),
                max: isChoice ? undefined : Number(producer.catalog[a].at(-1)),
              });
            }}
          >
            <option value="wajib_tepat">Wajib tepat</option>
            {a !== "bahan" && (
              <option value="wajib_rentang">Wajib rentang</option>
            )}
            {a !== "bahan" && (
              <option value="fleksibel_rentang">Fleksibel rentang</option>
            )}
            <option value="fleksibel_pilihan">Fleksibel pilihan</option>
          </select>
        </label>
        <label>
          Preferensi ideal
          <select
            value={String(r.ideal)}
            onChange={(e) =>
              update({
                ...r,
                ideal: a === "bahan" ? e.target.value : Number(e.target.value),
              })
            }
          >
            {[...new Set([r.ideal, ...producer.catalog[a]])]
              .filter((v) => acceptsBound(r, v))
              .map((v) => (
                <option key={v}>{v}</option>
              ))}
          </select>
        </label>
        {r.choices ? (
          <div className="choice-editor">
            <span>
              {r.type === "wajib_tepat" ? "Nilai wajib" : "Pilihan diterima"}
            </span>
            {producer.catalog[a].map((v) => (
              <label className="check" key={v}>
                <input
                  type={r.type === "wajib_tepat" ? "radio" : "checkbox"}
                  name={"bound-" + a}
                  checked={r.choices!.includes(v)}
                  onChange={(e) => {
                    const choices =
                      r.type === "wajib_tepat"
                        ? [v]
                        : e.target.checked
                          ? [...r.choices!, v]
                          : r.choices!.filter((x) => x !== v);
                    if (!choices.length) return;
                    update({
                      ...r,
                      choices,
                      ideal: choices.includes(r.ideal) ? r.ideal : choices[0],
                    });
                  }}
                />
                {v}
              </label>
            ))}
          </div>
        ) : (
          <>
            <label>
              Minimum
              <input
                required
                type="number"
                value={r.min ?? ""}
                max={r.max}
                onChange={(e) =>
                  update({
                    ...r,
                    min: Number(e.target.value),
                    ideal: Math.max(Number(r.ideal), Number(e.target.value)),
                  })
                }
              />
            </label>
            <label>
              Maksimum
              <input
                required
                type="number"
                value={r.max ?? ""}
                min={r.min}
                onChange={(e) =>
                  update({
                    ...r,
                    max: Number(e.target.value),
                    ideal: Math.min(Number(r.ideal), Number(e.target.value)),
                  })
                }
              />
            </label>
          </>
        )}
        <label>
          Bobot kepentingan
          <input
            required
            type="number"
            min="0"
            step="0.1"
            value={r.weight}
            onChange={(e) => update({ ...r, weight: Number(e.target.value) })}
          />
        </label>
      </div>
    </fieldset>
  );
}
function ScenarioTable() {
  const rows = useMemo(
    () =>
      scenarios
        .filter((s) => s[0] !== "S0")
        .map(([id, title]) => {
          const s = scenario(id);
          if (id === "S4")
            s.buyers = reviseAfterRejection(
              s.buyers,
              "b4",
              "bahan",
              {
                type: "wajib_tepat",
                choices: ["ivory"],
                ideal: "ivory",
                weight: 2,
              },
              true,
            );
          const r = solvePartition(s.buyers, producer, s.config);
          return {
            id,
            title,
            total: r.cost,
            solo: s.buyers.reduce(
              (n, b) =>
                n + (solveGroup([b], producer, s.config).plan?.effective ?? 0),
              0,
            ),
            major: majority(s.buyers, producer, s.config).total,
            groups: r.groups.filter((p) => p.ids.length > 1).length,
          };
        }),
    [],
  );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Skenario</th>
            <th>Sendiri</th>
            <th>Mayoritas</th>
            <th>IRISPEK</th>
            <th>Kelompok bersama</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <b>{r.id}</b> {r.title}
              </td>
              <td>{money(r.solo)}</td>
              <td>{money(r.major)}</td>
              <td>{money(r.total)}</td>
              <td>{r.groups}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
