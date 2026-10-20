import { NextResponse } from "next/server";
import { parseState } from "@/domain/state";
import { ConflictError, stateStore } from "@/server/storage";
export const runtime = "nodejs";
export async function GET() {
  try {
    const { state, etag } = await stateStore.read();
    return NextResponse.json(state, {
      headers: { ETag: etag, "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Data lokal rusak atau gagal dibaca. File asli dipertahankan; periksa data/state.json.",
      },
      { status: 500 },
    );
  }
}
export async function PUT(request: Request) {
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  // Next may normalize request.url to localhost; Host preserves the browser-facing address.
  const expectedOrigin =
    requestUrl.protocol +
    "//" +
    (request.headers.get("host") ?? requestUrl.host);
  if (origin && origin !== expectedOrigin)
    return NextResponse.json(
      { error: "Asal permintaan tidak diizinkan." },
      { status: 403 },
    );
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return NextResponse.json(
      { error: "Gunakan application/json." },
      { status: 415 },
    );
  const expected = request.headers.get("if-match");
  if (!expected)
    return NextResponse.json(
      { error: "Versi data diperlukan. Muat data sebelum menyimpan." },
      { status: 428 },
    );
  // Bound the stream before parsing, not after allocating an unbounded request.
  const reader = request.body?.getReader();
  if (!reader)
    return NextResponse.json({ error: "Data kosong." }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 200000) {
        await reader.cancel();
        return NextResponse.json(
          {
            error:
              "Data melebihi 200 KB. Ekspor cadangan dan mulai eksperimen baru.",
          },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
  } catch {
    return NextResponse.json(
      { error: "Permintaan gagal dibaca." },
      { status: 400 },
    );
  }
  let state;
  try {
    state = parseState(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Format data tidak valid." },
      { status: 400 },
    );
  }
  try {
    const { etag } = await stateStore.write(state, expected);
    return NextResponse.json({ ok: true }, { headers: { ETag: etag } });
  } catch (e) {
    if (e instanceof ConflictError)
      return NextResponse.json({ error: e.message }, { status: 409 });
    return NextResponse.json(
      { error: "Penyimpanan gagal. Data sebelumnya tetap dipertahankan." },
      { status: 500 },
    );
  }
}
