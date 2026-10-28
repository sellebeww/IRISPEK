import { test, expect } from "@playwright/test";
import { scenario } from "../src/domain/seed";
test.beforeEach(async ({ page, request }) => {
  const r = await request.get("/api/state");
  expect(r.ok()).toBeTruthy();
  const s = await request.put("/api/state", {
    headers: { "If-Match": r.headers().etag },
    data: { ...scenario("S0"), quotes: [], sampleHistory: [], active: "S0" },
  });
  expect(s.ok()).toBeTruthy();
  page.on("dialog", (d) => d.accept());
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { name: "Beli bersama. Tetap sesuai." }),
  ).toBeVisible();
});
test("overview, edit, save, reload, backup and CSV export", async ({
  page,
}) => {
  await expect(
    page.getByRole("button", { name: "Simpan perubahan" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Pembeli & kebutuhan", exact: true })
    .click();
  await page.getByRole("button", { name: "Ubah ↗" }).first().click();
  const modal = page.getByRole("dialog", { name: "Kebutuhan pembeli" });
  await modal.getByLabel("Nama usaha").fill("Dapur Rini Audit");
  await modal
    .getByRole("button", { name: "Simpan kebutuhan & hitung ulang" })
    .click();
  await expect(modal).not.toBeVisible();
  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Semua perubahan tersimpan",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Pembeli & kebutuhan", exact: true })
    .click();
  await expect(
    page.getByText("Dapur Rini Audit", { exact: true }),
  ).toBeVisible();
  const json = page.waitForEvent("download");
  await page.getByRole("button", { name: "Ekspor JSON" }).click();
  expect((await json).suggestedFilename()).toMatch(/\.json$/);
  await page.getByRole("button", { name: "Evaluasi", exact: true }).click();
  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "Ekspor biaya CSV" }).click();
  expect((await csv).suggestedFilename()).toMatch(/\.csv$/);
});
test("S2 conflict, S3 no saving and S6 comparison", async ({ page }) => {
  await page.getByLabel("Skenario", { exact: true }).selectOption("S2");
  await page.getByRole("button", { name: "Pilih manual", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Kelompok belum layak" }),
  ).toBeVisible();
  await expect(page.getByText(/Tidak ada bahan yang diterima/)).toBeVisible();
  await page.getByLabel("Skenario", { exact: true }).selectOption("S3");
  await page.getByRole("button", { name: "Evaluasi", exact: true }).click();
  await expect(
    page.getByText(
      "IRISPEK tidak memberi penghematan dibanding pesan sendiri pada parameter ini.",
      { exact: false },
    ),
  ).toBeVisible();
  await page.getByLabel("Skenario", { exact: true }).selectOption("S6");
  await page.getByRole("button", { name: "Evaluasi", exact: true }).click();
  await expect(
    page.getByText(/Lebih murah juga daripada mode mayoritas/),
  ).toBeVisible();
});
test("rejected sample stays in history through approved revision", async ({
  page,
}) => {
  await page.getByLabel("Skenario", { exact: true }).selectOption("S4");
  const rejected = page
    .locator(".sample-row")
    .filter({ hasText: "Camilan Nusa" });
  await expect(
    rejected.getByRole("button", { name: "Terima", exact: true }),
  ).toBeDisabled();
  await rejected.getByRole("button", { name: "Tinjau & hitung ulang" }).click();
  const dialog = page.getByRole("dialog", { name: "Tinjau sampel" });
  await dialog.getByLabel("Nilai yang diterima").selectOption("ivory");
  await expect(
    dialog.getByRole("button", { name: "Ubah batas & hitung ulang" }),
  ).toBeDisabled();
  await dialog.getByLabel("Pembeli menyetujui perubahan batas ini.").check();
  await dialog
    .getByRole("button", { name: "Ubah batas & hitung ulang" })
    .click();
  await expect(page.locator(".plan")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Penawaran & sampel", exact: true })
    .click();
  await expect(
    page.getByText("0 diterima dari 1 respons lintas putaran"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Semua perubahan tersimpan",
  );
});
test("quotes cannot overlap and approval requires all members", async ({
  page,
}) => {
  await page.getByLabel("Skenario", { exact: true }).selectOption("S1");
  await page.getByRole("button", { name: "Buat penawaran simulasi" }).click();
  await page
    .getByRole("button", { name: "Terima", exact: true })
    .first()
    .click();
  await expect(page.locator("article.card .badge")).toHaveText("ditawarkan");
  await page
    .getByRole("button", { name: "Pembentukan kelompok", exact: true })
    .click();
  await page.getByRole("button", { name: "Pilih manual", exact: true }).click();
  await page.getByLabel("Camilan Nusa", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Buat penawaran simulasi" }).click();
  await expect(page.locator(".sample-row")).toHaveCount(3);
  await expect(
    page.getByText("1 diterima dari 1 respons lintas putaran"),
  ).toBeVisible();
  for (const button of await page
    .getByRole("button", { name: "Terima", exact: true })
    .all())
    await button.click();
  await expect(page.locator("article.card .badge")).toHaveText("disetujui");
  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Semua perubahan tersimpan",
  );
});
test("stale tab cannot overwrite newer saved changes", async ({
  page,
  context,
}) => {
  const other = await context.newPage();
  other.on("dialog", (d) => d.accept());
  await other.goto("/app");
  await expect(
    other.getByRole("heading", { name: "Beli bersama. Tetap sesuai." }),
  ).toBeVisible();
  await page.getByLabel("Skenario", { exact: true }).selectOption("S1");
  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Semua perubahan tersimpan",
  );
  await other.getByLabel("Skenario", { exact: true }).selectOption("S2");
  await other.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(other.getByRole("status")).toContainText(
    "Data berubah di tab lain",
  );
  await other.close();
});
test("malformed backup rejected and keyboard dialog closes cleanly", async ({
  page,
}) => {
  await page.getByLabel("Impor cadangan JSON").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"buyers":[]}'),
  });
  await expect(page.getByRole("status")).toContainText("Jumlah pembeli");
  await page
    .getByRole("button", { name: "Pembeli & kebutuhan", exact: true })
    .click();
  await page.getByRole("button", { name: "Ubah ↗" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ubah ↗" }).first(),
  ).toBeFocused();
});
test("mobile navigation, modal and page fit viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Pembeli & kebutuhan", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Pembeli & kebutuhan", exact: true })
    .click();
  await page.getByRole("button", { name: "Ubah ↗" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Ringkasan", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-overview.png",
    fullPage: true,
  });
});
test("desktop visual and no client console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Beli bersama. Tetap sesuai." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/desktop-overview.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("company profile links to and from the app", async ({ page }) => {
  await page.getByRole("link", { name: "Profil perusahaan →" }).click();
  await expect(page).toHaveURL(/:\d+\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Pabrik minta",
  );
  await page.getByRole("link", { name: /Coba simulasinya/ }).click();
  await expect(
    page.getByRole("heading", { name: "Beli bersama. Tetap sesuai." }),
  ).toBeVisible();
});
