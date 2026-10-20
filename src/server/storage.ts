import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { AppState, parseState } from "../domain/state";
export class ConflictError extends Error {}
export function createStateStore(file: string) {
  let queue: Promise<unknown> = Promise.resolve();
  async function read() {
    let data: string;
    try {
      data = await readFile(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        return { state: null, etag: '"empty"' };
      throw e;
    }
    return {
      state: parseState(JSON.parse(data)),
      etag: '"' + createHash("sha256").update(data).digest("hex") + '"',
    };
  }
  function write(state: AppState, expected: string) {
    const task = queue
      .catch(() => {})
      .then(async () => {
        const current = await read();
        if (current.etag !== expected)
          throw new ConflictError(
            "Data berubah di tab lain. Ekspor cadangan perubahan Anda, lalu muat ulang halaman.",
          );
        const text = JSON.stringify(parseState(state), null, 2),
          tmp = file + "." + randomUUID() + ".tmp";
        await mkdir(path.dirname(file), { recursive: true });
        try {
          await writeFile(tmp, text, { mode: 0o600 });
          await rename(tmp, file);
        } finally {
          await unlink(tmp).catch(() => {});
        }
        return {
          etag: '"' + createHash("sha256").update(text).digest("hex") + '"',
        };
      });
    queue = task;
    return task;
  }
  return { read, write };
}
export const stateStore = createStateStore(
  process.env.BATASBELI_STATE_FILE ??
    path.join(process.cwd(), "data", "state.json"),
);
