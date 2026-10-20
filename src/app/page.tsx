import Image from "next/image";
import Link from "next/link";
import { producer, scenario, scenarios } from "@/domain/seed";
import { majority, solveGroup, solvePartition } from "@/solver";
import { Reveal } from "./Reveal";
import "./profil.css";

export const metadata = {
  title: "Profil IRISPEK — Irisan spesifikasi untuk UMKM",
  description:
    "IRISPEK menyatukan pesanan kecil UMKM yang spesifikasinya beririsan, sehingga mereka bisa memesan bersama tanpa melanggar kebutuhan siapa pun.",
};

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
const num = (n: number) => new Intl.NumberFormat("id-ID").format(n);

// Every figure on this page comes from the same solver and seed the app uses.
function caseStudy() {
  const s = scenario("S1");
  const plan = solvePartition(s.buyers, producer, s.config).groups[0];
  const solo = s.buyers.map((b) => ({
    buyer: b,
    plan: solveGroup([b], producer, s.config).plan!,
  }));
  const soloCost = solo.reduce((n, x) => n + x.plan.effective, 0);
  return {
    buyers: s.buyers,
    plan,
    solo,
    soloCost,
    soloExcess: solo.reduce((n, x) => n + x.plan.allocations[0].excess, 0),
    saving: Math.round((1 - plan.effective / soloCost) * 100),
  };
}
function comparison() {
  // S4 is a sample-rejection workflow, not a different cost case.
  return scenarios
    .filter(([id]) => !["S0", "S4"].includes(id))
    .map(([id, title, note]) => {
      const s = scenario(id);
      const solo = s.buyers.reduce(
        (n, b) =>
          n + (solveGroup([b], producer, s.config).plan?.effective ?? 0),
        0,
      );
      return {
        id,
        title,
        note,
        solo,
        major: majority(s.buyers, producer, s.config).total,
        irispek: solvePartition(s.buyers, producer, s.config).cost,
      };
    });
}

export default function Profile() {
  const c = caseStudy(),
    rows = comparison(),
    [a, b, d] = c.buyers,
    spec = c.plan.spec;
  return (
    <div className="pf">
      <Reveal />
      <a className="pf-skip" href="#isi">
        Lewati ke konten
      </a>
      <header className="pf-nav">
        <Link href="/" className="pf-logo" aria-label="IRISPEK">
          <Image
            src="/brand/irispek-mark.png"
            alt=""
            width={512}
            height={416}
            loading="eager"
          />
          <Image
            src="/brand/irispek-wordmark.png"
            alt=""
            width={600}
            height={98}
            loading="eager"
          />
        </Link>
        <nav aria-label="Bagian halaman">
          <a href="#masalah">Masalah</a>
          <a href="#cara-kerja">Cara kerja</a>
          <a href="#janji">Janji</a>
          <a href="#angka">Angka</a>
        </nav>
        <Link href="/app" className="pf-btn pf-btn-small">
          Buka aplikasi <span aria-hidden="true">→</span>
        </Link>
      </header>

      <main id="isi">
        <section className="pf-hero">
          <div className="pf-hero-copy">
            <p className="pf-kicker">Pengadaan bersama untuk UMKM</p>
            <h1>
              Butuh {num(a.quantity)} kemasan.
              <br />
              <span>Pabrik minta {num(producer.moq)}.</span>
            </h1>
            <p className="pf-lede">
              IRISPEK mencari <em>irisan spesifikasi</em> dari beberapa usaha,
              lalu memesannya sekali. Tidak ada syarat yang dilanggar, dan tidak
              ada yang membayar lebih mahal daripada memesan sendiri.
            </p>
            <div className="pf-actions">
              <Link href="/app" className="pf-btn">
                Coba simulasinya <span aria-hidden="true">→</span>
              </Link>
              <a href="#cara-kerja" className="pf-link">
                Lihat cara kerjanya
              </a>
            </div>
          </div>
          <figure className="pf-venn">
            <svg viewBox="0 0 520 500" role="img" aria-labelledby="venn-title">
              <title id="venn-title">
                Tiga lingkaran kebutuhan pembeli yang beririsan pada satu
                spesifikasi bersama
              </title>
              <defs>
                <clipPath id="clip-orange">
                  <circle cx="185" cy="305" r="145" />
                </clipPath>
                <clipPath id="clip-teal">
                  <circle cx="335" cy="305" r="145" />
                </clipPath>
              </defs>
              <g className="v v-blue">
                <circle cx="260" cy="175" r="145" />
                <text x="260" y="88" textAnchor="middle">
                  <tspan className="v-name">{a.name}</tspan>
                  <tspan x="260" dy="20">
                    {num(a.quantity)} unit
                  </tspan>
                </text>
              </g>
              <g className="v v-orange">
                <circle cx="185" cy="305" r="145" />
                <text x="128" y="375" textAnchor="middle">
                  <tspan className="v-name">{b.name}</tspan>
                  <tspan x="128" dy="20">
                    {num(b.quantity)} unit
                  </tspan>
                </text>
              </g>
              <g className="v v-teal">
                <circle cx="335" cy="305" r="145" />
                <text x="392" y="375" textAnchor="middle">
                  <tspan className="v-name">{d.name}</tspan>
                  <tspan x="392" dy="20">
                    {num(d.quantity)} unit
                  </tspan>
                </text>
              </g>
              <g clipPath="url(#clip-orange)">
                <g clipPath="url(#clip-teal)">
                  <circle className="v-core" cx="260" cy="175" r="145" />
                </g>
              </g>
              <g className="v-chip">
                <rect x="185" y="236" width="150" height="46" rx="23" />
                <text x="260" y="257" textAnchor="middle">
                  {spec.panjang}×{spec.lebar} cm · {spec.bahan}
                </text>
                <text x="260" y="273" textAnchor="middle" className="v-sub">
                  {spec.warna} warna cetak
                </text>
              </g>
            </svg>
            <figcaption>
              Spesifikasi yang diterima semua pihak, dari skenario S1.
            </figcaption>
          </figure>
        </section>

        <section className="pf-section pf-problem" id="masalah">
          <div className="pf-head" data-reveal>
            <p className="pf-kicker">01 · Masalah</p>
            <h2>MOQ dibuat untuk pabrik, bukan untuk warung.</h2>
            <p>
              Produsen kemasan {producer.name} mensyaratkan minimal{" "}
              {num(producer.moq)} unit per varian. Empat usaha di skenario S1
              hanya butuh {num(c.buyers[0].quantity)}–
              {num(c.buyers.at(-1)!.quantity)} unit. Kalau memesan sendiri,
              sisanya jadi stok yang mengendap.
            </p>
          </div>
          <ul
            className="pf-bars"
            aria-label="Kebutuhan dibanding pesanan minimum"
          >
            {c.solo.map(({ buyer, plan }, i) => (
              <li
                key={buyer.id}
                data-reveal
                style={{ "--i": i } as React.CSSProperties}
              >
                <span className="pf-bar-label">
                  <b>{buyer.name}</b>
                  {num(buyer.quantity)} dipakai ·{" "}
                  {num(plan.allocations[0].excess)} tersisa
                </span>
                <span className="pf-bar" aria-hidden="true">
                  <span
                    className="pf-bar-fill"
                    style={{
                      width: `${(buyer.quantity / plan.quantity) * 100}%`,
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
          <div className="pf-callout" data-reveal>
            <div>
              <small>Pesan sendiri-sendiri</small>
              <strong>{rupiah(c.soloCost)}</strong>
              <span>{num(c.soloExcess)} unit stok berlebih</span>
            </div>
            <div className="pf-arrow" aria-hidden="true">
              →
            </div>
            <div className="pf-good">
              <small>Dipesan bersama lewat IRISPEK</small>
              <strong>{rupiah(c.plan.effective)}</strong>
              <span>
                {num(c.plan.allocations.reduce((n, x) => n + x.excess, 0))} unit
                stok berlebih · hemat {c.saving}%
              </span>
            </div>
          </div>
        </section>

        <section className="pf-section pf-how" id="cara-kerja">
          <div className="pf-head" data-reveal>
            <p className="pf-kicker">02 · Cara kerja</p>
            <h2>Dari batas kebutuhan ke satu pesanan.</h2>
          </div>
          <ol className="pf-steps">
            {[
              [
                "Tulis batas, bukan keinginan",
                "Setiap usaha menyatakan apa yang masih bisa diterima: rentang ukuran, pilihan bahan, jumlah warna, jumlah unit, dan tenggat. Batas wajib tidak pernah ditawar.",
              ],
              [
                "Hitung irisan",
                "Batas semua anggota dipotong dengan katalog produsen. Jika irisannya kosong, IRISPEK menyebut atribut yang bertabrakan dan siapa saja yang membatasinya.",
              ],
              [
                "Bentuk kelompok yang adil",
                "Solver menguji setiap kemungkinan kelompok. Kelompok ditolak bila ada satu anggota saja yang lebih rugi daripada memesan sendiri.",
              ],
              [
                "Uji sampel bersama",
                "Penawaran baru jalan setelah semua anggota menerima sampel. Penolakan dicatat, batas direvisi dengan persetujuan, lalu kelompok dihitung ulang.",
              ],
            ].map(([title, body], i) => (
              <li
                key={title}
                data-reveal
                style={{ "--i": i } as React.CSSProperties}
              >
                <span className="pf-step-no">0{i + 1}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="pf-section pf-promise" id="janji">
          <div className="pf-head" data-reveal>
            <p className="pf-kicker">03 · Janji</p>
            <h2>Tiga hal yang tidak kami kompromikan.</h2>
          </div>
          <div className="pf-promises">
            {[
              [
                "blue",
                "Setiap batas terpenuhi",
                "Spesifikasi akhir selalu berada di dalam batas semua anggota. Preferensi boleh bergeser; syarat tidak.",
              ],
              [
                "orange",
                "Tidak ada yang lebih rugi",
                "Biaya efektif tiap anggota dibandingkan dengan biaya pesan sendiri. Tidak ada subsidi silang diam-diam.",
              ],
              [
                "teal",
                "Biaya dibuka per orang",
                "Setup, koordinasi, platform, pengiriman, dan risiko stok ditampilkan per anggota, bisa diekspor ke CSV.",
              ],
            ].map(([tone, title, body], i) => (
              <article
                key={title}
                className={"pf-promise-card " + tone}
                data-reveal
                style={{ "--i": i } as React.CSSProperties}
              >
                <span className="pf-dot" aria-hidden="true" />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="pf-section pf-numbers" id="angka">
          <div className="pf-head" data-reveal>
            <p className="pf-kicker">04 · Angka</p>
            <h2>Hasil simulasi, termasuk yang tidak menguntungkan.</h2>
            <p>
              Total biaya efektif per skenario. Bila koordinasi terlalu mahal,
              IRISPEK menyarankan pesan sendiri, dan angkanya ditampilkan apa
              adanya.
            </p>
          </div>
          <div className="pf-legend" aria-hidden="true">
            <span className="solo">Pesan sendiri</span>
            <span className="major">Spesifikasi mayoritas</span>
            <span className="iris">IRISPEK</span>
          </div>
          <div className="pf-chart">
            {rows.map((r) => {
              const max = Math.max(r.solo, r.major, r.irispek);
              return (
                <div className="pf-chart-row" key={r.id} data-reveal>
                  <div className="pf-chart-title">
                    <b>
                      {r.id} · {r.title}
                    </b>
                    <small>{r.note}</small>
                  </div>
                  <dl>
                    {(
                      [
                        ["solo", "Pesan sendiri", r.solo],
                        ["major", "Spesifikasi mayoritas", r.major],
                        ["iris", "IRISPEK", r.irispek],
                      ] as const
                    ).map(([k, label, v], i) => (
                      <div key={k} className={k}>
                        <dt>{label}</dt>
                        <dd>
                          <span
                            className="pf-chart-bar"
                            style={
                              {
                                "--w": `${(v / max) * 100}%`,
                                "--i": i,
                              } as React.CSSProperties
                            }
                          />
                          {rupiah(v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })}
          </div>
          <p className="pf-footnote">
            Mode mayoritas memaksa satu spesifikasi dan bisa tampak lebih murah,
            tetapi tidak memeriksa apakah setiap anggota diuntungkan. Data dari
            simulasi, bukan transaksi nyata.
          </p>
        </section>

        <section className="pf-cta" data-reveal>
          <Image
            className="pf-cta-mark"
            src="/brand/irispek-mark.png"
            alt=""
            width={512}
            height={416}
          />
          <h2>Coba dengan kebutuhan Anda sendiri.</h2>
          <p>
            Ubah batas pembeli, ganti parameter biaya, dan lihat kelompok mana
            yang tetap adil.
          </p>
          <Link href="/app" className="pf-btn pf-btn-light">
            Buka aplikasi <span aria-hidden="true">→</span>
          </Link>
        </section>
      </main>

      <footer className="pf-footer">
        <Image
          src="/brand/irispek-logo.png"
          alt="IRISPEK"
          width={900}
          height={751}
        />
        <p>
          IRISPEK, dari <em>irisan spesifikasi</em>. Versi MVP untuk simulasi;
          tidak ada pembayaran atau pengiriman nyata.
        </p>
        <nav aria-label="Tautan bawah">
          <Link href="/app">Aplikasi</Link>
          <a href="#isi">Kembali ke atas ↑</a>
        </nav>
      </footer>
    </div>
  );
}
