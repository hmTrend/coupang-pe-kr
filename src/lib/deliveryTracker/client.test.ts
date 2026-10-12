import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeliveryTrackerConfig } from "@/lib/config";
import { FIXTURE_INVOICE_NO, loadGraphql } from "./__fixtures__/load";
import { DeliveryTrackerClient, RATE_LIMIT_BACKOFF_MS, TRACK_QUERY } from "./client";

const NO = FIXTURE_INVOICE_NO;
const SECRET = "s3cr3t-value-DO-NOT-LOG";

const baseConfig: DeliveryTrackerConfig = {
  clientId: "test-client-id",
  clientSecret: SECRET,
  carrierId: "kr.coupangls",
  endpoint: "https://tracker.test/graphql",
  timeoutMs: 15_000,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const gqlError = (code: string, message = "에러") => ({ errors: [{ message, extensions: { code } }] });

let clock: number;
let logs: string[];
let fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>;
let config: DeliveryTrackerConfig;

function makeClient() {
  return new DeliveryTrackerClient({
    getConfig: () => config,
    fetchImpl,
    now: () => clock,
    log: (message) => logs.push(message),
  });
}

beforeEach(() => {
  clock = 1_000_000;
  logs = [];
  config = { ...baseConfig };
  fetchImpl = vi.fn<typeof fetch>();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("요청 형식", () => {
  it("POST + Authorization: TRACKQL-API-KEY id:secret + GraphQL 변수 전달 + no-store", async () => {
    fetchImpl.mockResolvedValue(json(loadGraphql("delivered")));
    await makeClient().fetchTrack(NO);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://tracker.test/graphql");
    expect(init?.method).toBe("POST");
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);

    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`TRACKQL-API-KEY test-client-id:${SECRET}`);
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init?.body as string);
    expect(body.variables).toEqual({ carrierId: "kr.coupangls", trackingNumber: NO });
    expect(body.query).toBe(TRACK_QUERY);
    expect(body.query).toContain("track(carrierId: $carrierId, trackingNumber: $trackingNumber)");
    expect(body.query).toContain("events(last: 100)");
  });

  it("Secret 은 Authorization 헤더에만 있고 URL/본문에는 없다", async () => {
    fetchImpl.mockResolvedValue(json(loadGraphql("delivered")));
    await makeClient().fetchTrack(NO);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).not.toContain(SECRET);
    expect(init?.body as string).not.toContain(SECRET);
  });

  it("carrierId 설정을 변수로 보낸다", async () => {
    config.carrierId = "kr.cjlogistics";
    fetchImpl.mockResolvedValue(json(loadGraphql("delivered")));
    await makeClient().fetchTrack(NO);
    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(body.variables.carrierId).toBe("kr.cjlogistics");
  });
});

describe("결과 분류", () => {
  it("정상 응답은 ok + 매핑된 TrackingData", async () => {
    fetchImpl.mockResolvedValue(json(loadGraphql("delivered")));
    const result = await makeClient().fetchTrack(NO);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.data.invoiceNo).toBe(NO);
    expect(result.data.delivered).toBe(true);
    expect(result.data.events).toHaveLength(5);
    expect(logs).toEqual([]);
  });

  it("이벤트가 없는 정상 응답은 not_found 가 아니라 ok(빈 이력)", async () => {
    fetchImpl.mockResolvedValue(json(loadGraphql("empty-events")));
    const result = await makeClient().fetchTrack(NO);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.events).toEqual([]);
  });

  it("NOT_FOUND -> not_found (로그 없음)", async () => {
    fetchImpl.mockResolvedValue(json(loadGraphql("not-found")));
    expect(await makeClient().fetchTrack(NO)).toEqual({ kind: "not_found" });
    expect(logs).toEqual([]);
  });

  it("FORBIDDEN(HTTP 200) -> auth", async () => {
    fetchImpl.mockResolvedValue(json(loadGraphql("forbidden")));
    expect(await makeClient().fetchTrack(NO)).toEqual({ kind: "error", reason: "auth" });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("reason=auth");
    expect(logs[0]).toContain("code=FORBIDDEN");
  });

  it.each(["UNAUTHENTICATED", "UNAUTHORIZED"])("%s -> auth", async (code) => {
    fetchImpl.mockResolvedValue(json(gqlError(code)));
    expect(await makeClient().fetchTrack(NO)).toEqual({ kind: "error", reason: "auth" });
  });

  it.each([401, 403])("HTTP %i -> auth", async (status) => {
    fetchImpl.mockResolvedValue(new Response("denied", { status }));
    expect(await makeClient().fetchTrack(NO)).toEqual({ kind: "error", reason: "auth" });
  });

  it("HTTP 429 -> rate_limited", async () => {
    fetchImpl.mockResolvedValue(new Response("slow down", { status: 429 }));
    expect(await makeClient().fetchTrack(NO)).toEqual({ kind: "error", reason: "rate_limited" });
  });

  it("호출 제한을 뜻하는 GraphQL 오류(코드/메시지) -> rate_limited", async () => {
    fetchImpl.mockResolvedValueOnce(json(gqlError("RATE_LIMITED")));
    expect(await makeClient().fetchTrack(NO)).toEqual({ kind: "error", reason: "rate_limited" });
    fetchImpl.mockResolvedValueOnce(json(gqlError("INTERNAL", "Rate limit exceeded for this client")));
    expect(await makeClient().fetchTrack(NO)).toEqual({ kind: "error", reason: "rate_limited" });
  });

  it.each([500, 502, 503])("HTTP %i -> server_error", async (status) => {
    fetchImpl.mockResolvedValue(new Response("<html>bad gateway</html>", { status }));
    expect(await makeClient().fetchTrack(NO)).toEqual({ kind: "error", reason: "server_error" });
  });

  it("INTERNAL / 알 수 없는 오류 코드 -> server_error", async () => {
    fetchImpl.mockResolvedValueOnce(json(gqlError("INTERNAL")));
    expect(await makeClient().fetchTrack(NO)).toEqual({ kind: "error", reason: "server_error" });
    fetchImpl.mockResolvedValueOnce(json({ errors: [{ message: "boom" }] }));
    expect(await makeClient().fetchTrack(NO)).toEqual({ kind: "error", reason: "server_error" });
  });

  it("BAD_REQUEST -> bad_request", async () => {
    fetchImpl.mockResolvedValue(json(gqlError("BAD_REQUEST")));
    expect(await makeClient().fetchTrack(NO)).toEqual({ kind: "error", reason: "bad_request" });
  });

  it("JSON 이 아닌 응답 -> invalid_response (HTTP 4xx 면 bad_request)", async () => {
    fetchImpl.mockResolvedValueOnce(new Response("<html>hello</html>", { status: 200 }));
    expect(await makeClient().fetchTrack(NO)).toEqual({ kind: "error", reason: "invalid_response" });
    fetchImpl.mockResolvedValueOnce(new Response("<html>nope</html>", { status: 404 }));
    expect(await makeClient().fetchTrack(NO)).toEqual({ kind: "error", reason: "bad_request" });
  });

  it("오류 없이 track 이 비어 있으면 not_found 가 아니라 invalid_response", async () => {
    fetchImpl.mockResolvedValueOnce(json({ data: { track: null } }));
    expect(await makeClient().fetchTrack(NO)).toEqual({ kind: "error", reason: "invalid_response" });
    fetchImpl.mockResolvedValueOnce(json({ data: null }));
    expect(await makeClient().fetchTrack(NO)).toEqual({ kind: "error", reason: "invalid_response" });
    fetchImpl.mockResolvedValueOnce(json({}));
    expect(await makeClient().fetchTrack(NO)).toEqual({ kind: "error", reason: "invalid_response" });
  });

  it("오류와 부분 데이터가 같이 오면 오류로 처리한다 (부분 이력을 정상 스냅샷으로 쓰지 않음)", async () => {
    const partial = { ...loadGraphql("delivered"), errors: [{ message: "x", extensions: { code: "INTERNAL" } }] };
    fetchImpl.mockResolvedValue(json(partial));
    expect(await makeClient().fetchTrack(NO)).toEqual({ kind: "error", reason: "server_error" });
  });

  it("네트워크 오류 -> network", async () => {
    fetchImpl.mockRejectedValue(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }));
    expect(await makeClient().fetchTrack(NO)).toEqual({ kind: "error", reason: "network" });
    expect(logs[0]).toContain("reason=network");
    expect(logs[0]).toContain("code=ECONNREFUSED");
  });

  it("타임아웃(AbortSignal) -> timeout", async () => {
    vi.useFakeTimers();
    config.timeoutMs = 5_000;
    fetchImpl.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const pending = makeClient().fetchTrack(NO);
    await vi.advanceTimersByTimeAsync(4_999);
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ kind: "error", reason: "timeout" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("성공 후에는 타임아웃 타이머가 남지 않는다", async () => {
    vi.useFakeTimers();
    fetchImpl.mockResolvedValue(json(loadGraphql("delivered")));
    await makeClient().fetchTrack(NO);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("in-flight dedup", () => {
  it("같은 번호의 동시 요청은 API 호출 1회로 합친다", async () => {
    let release!: (res: Response) => void;
    fetchImpl.mockImplementation(() => new Promise<Response>((resolve) => (release = resolve)));
    const client = makeClient();

    const a = client.fetchTrack(NO);
    const b = client.fetchTrack(NO);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    release(json(loadGraphql("delivered")));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.kind).toBe("ok");
    expect(rb).toBe(ra);
  });

  it("다른 번호는 각각 호출하고, 끝난 뒤의 요청은 새로 호출한다", async () => {
    fetchImpl.mockImplementation(async () => json(loadGraphql("delivered")));
    const client = makeClient();

    await Promise.all([client.fetchTrack(NO), client.fetchTrack("10332152871107")]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await client.fetchTrack(NO);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("실패한 요청도 끝나면 in-flight 에서 빠진다", async () => {
    fetchImpl.mockRejectedValueOnce(new TypeError("fetch failed"));
    const client = makeClient();
    expect((await client.fetchTrack(NO)).kind).toBe("error");
    fetchImpl.mockResolvedValueOnce(json(loadGraphql("delivered")));
    expect((await client.fetchTrack(NO)).kind).toBe("ok");
  });
});

describe("자격증명 없음", () => {
  it.each([
    ["Client Id 없음", { clientId: undefined }],
    ["Client Secret 없음", { clientSecret: undefined }],
    ["둘 다 없음", { clientId: undefined, clientSecret: undefined }],
  ])("%s -> not_configured, 외부 호출 없음, 경고 로그는 1회", async (_name, patch) => {
    config = { ...baseConfig, ...patch };
    const client = makeClient();

    expect(await client.fetchTrack(NO)).toEqual({ kind: "error", reason: "not_configured" });
    expect(await client.fetchTrack(NO)).toEqual({ kind: "error", reason: "not_configured" });
    expect(await client.fetchTrack("10332152871107")).toEqual({ kind: "error", reason: "not_configured" });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("DELIVERY_TRACKER_CLIENT_ID");
  });
});

describe("호출 제한 백오프", () => {
  it("429 를 받으면 30초 동안은 API 를 부르지 않고, 지나면 다시 부른다", async () => {
    fetchImpl.mockResolvedValueOnce(new Response("slow down", { status: 429 }));
    const client = makeClient();
    expect(await client.fetchTrack(NO)).toEqual({ kind: "error", reason: "rate_limited" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clock += RATE_LIMIT_BACKOFF_MS - 1;
    expect(await client.fetchTrack("10332152871107")).toEqual({ kind: "error", reason: "rate_limited" });
    expect(await client.fetchTrack(NO)).toEqual({ kind: "error", reason: "rate_limited" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clock += 1;
    fetchImpl.mockResolvedValueOnce(json(loadGraphql("delivered")));
    expect((await client.fetchTrack(NO)).kind).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("호출 제한이 아닌 오류는 백오프를 만들지 않는다", async () => {
    fetchImpl.mockResolvedValue(new Response("oops", { status: 502 }));
    const client = makeClient();
    await client.fetchTrack(NO);
    await client.fetchTrack(NO);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("로그 안전성", () => {
  it("서버가 오류 메시지에 Secret 을 되돌려줘도 로그에는 남지 않는다", async () => {
    fetchImpl.mockResolvedValue(json(gqlError("BAD_REQUEST", `invalid key ${SECRET} for client`)));
    await makeClient().fetchTrack(NO);
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toContain(SECRET);
    expect(logs[0]).toContain("***");
  });

  it("네트워크 오류 메시지에 Secret 이 섞여도 로그에는 남지 않는다", async () => {
    fetchImpl.mockRejectedValue(new TypeError(`Invalid header value: TRACKQL-API-KEY id:${SECRET}`));
    await makeClient().fetchTrack(NO);
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toContain(SECRET);
  });

  it("모든 실패 경로의 로그에 Secret 과 응답 본문이 없다", async () => {
    const bodyMarker = "RESPONSE-BODY-MARKER";
    const responses: Array<() => Response | Promise<Response>> = [
      () => new Response(bodyMarker, { status: 500 }),
      () => new Response(bodyMarker, { status: 429 }),
      () => new Response(bodyMarker, { status: 200 }),
      () => json(loadGraphql("forbidden")),
      () => json({ data: { track: null }, extra: bodyMarker }),
    ];
    for (const make of responses) {
      fetchImpl.mockImplementationOnce(async () => make());
      const client = makeClient();
      await client.fetchTrack(NO);
    }
    expect(logs.length).toBeGreaterThanOrEqual(responses.length);
    for (const line of logs) {
      expect(line).not.toContain(SECRET);
      expect(line).not.toContain(bodyMarker);
      expect(line).not.toContain("TRACKQL-API-KEY");
    }
  });
});
