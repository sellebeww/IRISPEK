import { describe, it, expect, vi, beforeEach } from "vitest";
import { scenario } from "../src/domain/seed";
vi.mock("../src/server/storage", () => ({
  ConflictError: class ConflictError extends Error {},
  stateStore: { read: vi.fn(), write: vi.fn() },
}));
import { GET, PUT } from "../src/app/api/state/route";
import { stateStore, ConflictError } from "../src/server/storage";
const valid = () => ({
  ...scenario("S1"),
  quotes: [],
  sampleHistory: [],
  active: "S1",
});
const request = (
  body: unknown = valid(),
  headers: Record<string, string> = {},
) =>
  new Request("http://localhost:3100/api/state", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "If-Match": '"empty"',
      ...headers,
    },
    body: JSON.stringify(body),
  });
beforeEach(() => vi.resetAllMocks());
describe("state API", () => {
  it("GET supplies revision and disables caching", async () => {
    vi.mocked(stateStore.read).mockResolvedValue({
      state: null,
      etag: '"empty"',
    });
    const r = await GET();
    expect(r.status).toBe(200);
    expect(r.headers.get("etag")).toBe('"empty"');
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("bad stored file is a server failure", async () => {
    vi.mocked(stateStore.read).mockRejectedValue(Error());
    expect((await GET()).status).toBe(500);
  });
  it("valid write returns new revision", async () => {
    vi.mocked(stateStore.write).mockResolvedValue({ etag: '"new"' });
    const r = await PUT(request());
    expect(r.status).toBe(200);
    expect(r.headers.get("etag")).toBe('"new"');
  });
  it("allows the browser-facing host when Next normalizes the internal URL", async () => {
    vi.mocked(stateStore.write).mockResolvedValue({ etag: '"new"' });
    const r = await PUT(
      request(valid(), {
        Origin: "http://127.0.0.1:3100",
        Host: "127.0.0.1:3100",
      }),
    );
    expect(r.status).toBe(200);
  });
  it("foreign origin cannot overwrite local data", async () =>
    expect(
      (await PUT(request(valid(), { Origin: "https://bad.example" }))).status,
    ).toBe(403));
  it("requires JSON and revision", async () => {
    expect(
      (await PUT(request(valid(), { "Content-Type": "text/plain" }))).status,
    ).toBe(415);
    expect((await PUT(request(valid(), { "If-Match": "" }))).status).toBe(428);
  });
  it("limits streamed body bytes", async () =>
    expect((await PUT(request({ data: "x".repeat(200001) }))).status).toBe(
      413,
    ));
  it("invalid input is rejected before storage", async () => {
    const s = valid();
    s.buyers[0].quantity = -1;
    expect((await PUT(request(s))).status).toBe(400);
    expect(stateStore.write).not.toHaveBeenCalled();
  });
  it("conflicts and disk errors are distinct", async () => {
    vi.mocked(stateStore.write)
      .mockRejectedValueOnce(new ConflictError("stale"))
      .mockRejectedValueOnce(Error("disk"));
    expect((await PUT(request())).status).toBe(409);
    expect((await PUT(request())).status).toBe(500);
  });
});
