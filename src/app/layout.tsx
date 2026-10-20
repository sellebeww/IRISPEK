import "./globals.css";
import { Plus_Jakarta_Sans } from "next/font/google";
const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-sans" });
export const metadata = {
  title: "IRISPEK — Pengadaan bersama, sesuai kebutuhan",
  description:
    "Simulasi pengadaan bersama UMKM dari irisan spesifikasi: setiap batas kebutuhan terpenuhi dan biaya yang adil.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={sans.variable}>
      <body>{children}</body>
    </html>
  );
}
