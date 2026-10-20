import { Buyer, Producer, Bound, Config } from "./model";
import { defaultConfig } from "./config";
const range = (min: number, max: number, ideal: number): Bound => ({
  type: "wajib_rentang",
  min,
  max,
  ideal,
  weight: 1,
});
export const producer: Producer = {
  id: "p1",
  name: "Kemas Nusantara",
  catalog: {
    panjang: [16, 18, 20, 22, 24],
    lebar: [10, 12, 14, 16],
    bahan: ["kraft", "ivory", "premium"],
    warna: [1, 2, 3],
  },
  tiers: [
    { min: 0, price: 1800 },
    { min: 1000, price: 1450 },
    { min: 2000, price: 1200 },
    { min: 4000, price: 1050 },
  ],
  materialSurcharge: { kraft: 0, ivory: 0, premium: 1800 },
  moq: 1000,
  setup: 160000,
  design: 35000,
  leadDays: 7,
  shipping: { Bandung: 20000, Jakarta: 35000, Bogor: 30000 },
};
const names = [
  "Dapur Bu Rini",
  "Kopi Sore",
  "Roti Rumah",
  "Camilan Nusa",
  "Sabun Bumi",
  "Lilin Senja",
  "Teh Akar",
  "Kriya Kecil",
  "Granola Pagi",
  "Kue Manda",
];
export const buyers: Buyer[] = names.map((name, i) => ({
  id: `b${i + 1}`,
  name,
  zone: i % 3 === 0 ? "Jakarta" : "Bandung",
  quantity: 250 + i * 35,
  deadline: "2026-11-10",
  bounds: {
    panjang: range(i < 4 ? 16 : 20, i < 4 ? 20 : 24, i < 4 ? 18 : 22),
    lebar: range(10, 14, 12),
    bahan: {
      type: "wajib_tepat",
      choices: [i < 4 ? "kraft" : "ivory"],
      ideal: i < 4 ? "kraft" : "ivory",
      weight: 2,
    },
    warna: { type: "fleksibel_pilihan", choices: [1, 2], ideal: 1, weight: 1 },
  },
}));
export const scenarios = [
  ["S0", "Semua pembeli", "10 usaha, dua keluarga spesifikasi."],
  [
    "S1",
    "Irisan yang cocok",
    "Empat pembeli berbagi spesifikasi dan menghemat biaya.",
  ],
  [
    "S2",
    "Batas bertabrakan",
    "Bahan wajib pembeli keempat berbeda; kelompok manual ditolak.",
  ],
  [
    "S3",
    "Koordinasi terlalu mahal",
    "Biaya koordinasi menghapus penghematan; pesan sendiri lebih baik.",
  ],
  [
    "S4",
    "Sampel ditolak",
    "Pembeli keempat menolak bahan. Setujui perubahan batas lalu hitung ulang.",
  ],
  [
    "S5",
    "Tidak adil bagi satu anggota",
    "Pembeli besar kehilangan harga bertingkat; dikeluarkan dari kelompok.",
  ],
  [
    "S6",
    "Dua kelompok lebih baik",
    "Bahan premium dapat menyatukan semua pembeli, tetapi lebih mahal.",
  ],
] as const;
export function scenario(id: string): { buyers: Buyer[]; config: Config } {
  const b = structuredClone(
    id === "S0" || id === "S6" ? buyers : buyers.slice(0, 4),
  );
  const config = { ...defaultConfig };
  if (id === "S2")
    b[3].bounds.bahan = {
      type: "wajib_tepat",
      choices: ["ivory"],
      ideal: "ivory",
      weight: 2,
    };
  if (id === "S6")
    b.forEach((x) => {
      x.bounds.bahan = {
        ...x.bounds.bahan,
        type: "fleksibel_pilihan",
        choices: [x.bounds.bahan.ideal, "premium"],
      };
      x.bounds.panjang = { ...x.bounds.panjang, min: 16, max: 24 };
    });
  if (id === "S3") config.coordination = 5000000;
  if (id === "S5") {
    b[0].quantity = 4000;
    config.coordination = 800000;
  }
  return { buyers: b, config };
}
