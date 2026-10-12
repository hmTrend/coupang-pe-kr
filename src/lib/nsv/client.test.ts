import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NsvConfig } from "@/lib/config";
import {
  __resetNsvClientForTest,
  fetchNsvInvoiceMeta,
  getDefaultNsvClient,
  NSV_QUERY,
  NsvClient,
  parseNsvGraphqlUrls,
} from "./client";

const NO = "10332484648894";
const URL_A = "http://a.test:40141/graphql";
const URL_B = "http://b.test:40107/graphql";
const URL_C = "https://c.test:40222/graphql";

const FOUND_A = {
  found: true,
  trackingNo: NO,
  productName: "A사 양말 세트",
  receiverName: "홍*동",
  receiverAddress: "서울 강남구 도산대로45길 *** ***동 ****호",
  deliveryMessage: "문 앞 (*********)",
};
const FOUND_B = { ...FOUND_A, productName: "B사 수건" };

const nodeRes = (node: unknown, status = 200) =>
  new Response(JSON.stringify({ data: { getTrackingSiteInvoice: node } }), {
    status,
    headers: { "content-type": "application/json" },
  });
const notFoundRes = () => nodeRes({ found: false, trackingNo: NO, productName: null, receiverName: null, receiverAddress: null, deliveryMessage: null });
const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let logs: string[];
let config: NsvConfig;
let fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>;

/** URL 별로 응답을 지정한다 (지정하지 않은 주소는 네트워크 오류) */
function route(routes: Record<string, () => Response | Promise<Response>>) {
  fetchImpl.mockImplementation(async (input) => {
    const handler = routes[String(input)];
    if (!handler) throw new TypeError("fetch failed");
    return handler();
  });
}

/** 해제 전까지 응답하지 않는 요청 (abort 되면 AbortError) */
function hang(): (_url: unknown, init?: RequestInit) => Promise<Response> {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
}

function makeClient() {
  return new NsvClient({ getConfig: () => config, fetchImpl, log: (message) => logs.push(message) });
}

beforeEach(() => {
  logs = [];
  config = { graphqlUrls: `${URL_A},${URL_B}`, timeoutMs: 3_000 };
  fetchImpl = vi.fn<typeof fetch>();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("NSV_GRAPHQL_URLS 파싱", () => {
  it("쉼표·공백·줄바꿈으로 구분한 http(s) 주소를 순서대로 읽는다", () => {
    const raw = `${URL_A}, ${URL_B}\n  ${URL_C}\t,\n`;
    expect(parseNsvGraphqlUrls(raw)).toEqual({ urls: [URL_A, URL_B, URL_C], invalid: [] });
  });

  it("같은 주소가 중복되면 처음 것만 남긴다", () => {
    expect(parseNsvGraphqlUrls(`${URL_A} ${URL_B} ${URL_A}`).urls).toEqual([URL_A, URL_B]);
  });

  it("http/https 가 아니거나 형식이 틀린 항목, 자격증명이 들어 있는 주소는 건너뛰고 번호(1부터)만 알려준다", () => {
    const raw = [URL_A, "localhost:4000/graphql", "ftp://x.test/graphql", "http://", "http://user:pw@h.test/graphql", URL_B].join(",");
    expect(parseNsvGraphqlUrls(raw)).toEqual({ urls: [URL_A, URL_B], invalid: [2, 3, 4, 5] });
  });

  it("비었거나 없으면 빈 목록", () => {
    expect(parseNsvGraphqlUrls(undefined)).toEqual({ urls: [], invalid: [] });
    expect(parseNsvGraphqlUrls(" ,\n, ")).toEqual({ urls: [], invalid: [] });
  });

  it("형식 오류 항목은 경고를 남기되 값 자체는 로그에 쓰지 않고, 같은 설정이면 1회만 경고한다", async () => {
    config.graphqlUrls = `${URL_A},http://user:SECRETPW@h.test/graphql,nonsense`;
    fetchImpl.mockImplementation(async () => notFoundRes());
    const client = makeClient();
    await client.fetchInvoiceMeta(NO);
    await client.fetchInvoiceMeta("10332484648895");

    const warnings = logs.filter((line) => line.includes("NSV_GRAPHQL_URLS"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("2번째");
    expect(warnings[0]).toContain("3번째");
    expect(logs.join("\n")).not.toContain("SECRETPW");
    expect(fetchImpl).toHaveBeenCalledTimes(2); // 유효한 주소(A) 1곳 x 2회
  });
});

describe("비활성화 (disabled)", () => {
  it.each([
    ["미설정", undefined],
    ["빈 문자열", ""],
    ["공백뿐", "  \n "],
    ["유효한 주소가 하나도 없음", "nonsense, ftp://x.test"],
  ])("NSV_GRAPHQL_URLS %s -> disabled, fetch 를 부르지 않는다", async (_name, value) => {
    config.graphqlUrls = value;
    expect(await makeClient().fetchInvoiceMeta(NO)).toEqual({ kind: "disabled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("요청 형식", () => {
  it("모든 엔드포인트에 POST + 계약대로의 쿼리/변수, 인증 헤더 없음, no-store", async () => {
    route({ [URL_A]: notFoundRes, [URL_B]: notFoundRes });
    await makeClient().fetchInvoiceMeta(NO);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url]) => String(url)).sort()).toEqual([URL_A, URL_B]);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init?.method).toBe("POST");
      expect(init?.cache).toBe("no-store");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const headers = init?.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
      expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("authorization");

      const body = JSON.parse(init?.body as string);
      expect(body.variables).toEqual({ input: { trackingNo: NO } });
      expect(body.query).toBe(NSV_QUERY);
    }
    expect(NSV_QUERY).toContain("query TrackingSiteInvoice($input: GetTrackingSiteInvoiceInput!)");
    expect(NSV_QUERY).toContain("getTrackingSiteInvoice(input: $input)");
    for (const field of ["found", "trackingNo", "productName", "receiverName", "receiverAddress", "deliveryMessage"]) {
      expect(NSV_QUERY).toContain(field);
    }
  });
});

describe("병렬 호출과 결과 채택", () => {
  it("엔드포인트를 순차가 아니라 동시에 호출한다 (응답 전에 모두 호출됨)", async () => {
    vi.useFakeTimers();
    config.graphqlUrls = `${URL_A},${URL_B},${URL_C}`;
    fetchImpl.mockImplementation(hang());
    const pending = makeClient().fetchInvoiceMeta(NO);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(await pending).toEqual({ kind: "error", reason: "timeout" });
  });

  it("found 가 하나뿐이면 그 응답의 meta 를 쓴다", async () => {
    route({ [URL_A]: notFoundRes, [URL_B]: () => nodeRes(FOUND_B) });
    expect(await makeClient().fetchInvoiceMeta(NO)).toEqual({
      kind: "found",
      meta: {
        productName: "B사 수건",
        receiverName: "홍*동",
        receiverAddress: FOUND_B.receiverAddress,
        deliveryMessage: "문 앞 (*********)",
      },
    });
  });

  it("여러 곳이 found 면 목록 순서상 앞쪽을 쓴다 (뒤쪽이 먼저 답해도)", async () => {
    let releaseA!: (res: Response) => void;
    const slowA = new Promise<Response>((resolve) => (releaseA = resolve));
    route({ [URL_A]: () => slowA, [URL_B]: () => nodeRes(FOUND_B) });

    const pending = makeClient().fetchInvoiceMeta(NO);
    let settled = false;
    void pending.then(() => (settled = true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false); // 앞쪽(A)이 아직 답하지 않았으므로 B 의 found 를 확정하지 않는다

    releaseA(nodeRes(FOUND_A));
    const result = await pending;
    expect(result.kind).toBe("found");
    if (result.kind === "found") expect(result.meta.productName).toBe("A사 양말 세트");
  });

  it("앞쪽이 found 가 아닌 것으로 확정되면, 뒤쪽 found 를 쓰고 나머지(느린 곳)는 기다리지 않는다", async () => {
    vi.useFakeTimers();
    config.graphqlUrls = `${URL_A},${URL_B},${URL_C}`;
    fetchImpl.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === URL_A) return notFoundRes();
      if (url === URL_B) return nodeRes(FOUND_B);
      return hang()(url, init); // C 는 타임아웃까지 응답하지 않는다
    });
    // 타이머를 전혀 진행시키지 않아도 결과가 나온다 = C 를 기다리지 않았다
    const result = await makeClient().fetchInvoiceMeta(NO);
    expect(result.kind).toBe("found");
    if (result.kind === "found") expect(result.meta.productName).toBe("B사 수건");

    await vi.advanceTimersByTimeAsync(3_000); // 남은 요청 정리
    expect(vi.getTimerCount()).toBe(0);
  });

  it("일부는 실패하고 일부는 not_found 면 not_found", async () => {
    route({ [URL_B]: notFoundRes }); // A 는 네트워크 오류
    expect(await makeClient().fetchInvoiceMeta(NO)).toEqual({ kind: "not_found" });
  });

  it("일부는 실패하고 일부는 found 면 found (실패한 곳은 무시)", async () => {
    route({ [URL_B]: () => nodeRes(FOUND_B) });
    const result = await makeClient().fetchInvoiceMeta(NO);
    expect(result.kind).toBe("found");
  });

  it("모두 found:false 면 not_found", async () => {
    route({ [URL_A]: notFoundRes, [URL_B]: notFoundRes });
    expect(await makeClient().fetchInvoiceMeta(NO)).toEqual({ kind: "not_found" });
  });

  it("전부 실패하면 error (사유는 목록 순서상 첫 실패)", async () => {
    route({ [URL_A]: () => new Response("<html>bad gateway</html>", { status: 502 }) }); // B 는 네트워크 오류
    expect(await makeClient().fetchInvoiceMeta(NO)).toEqual({ kind: "error", reason: "http_error" });
    expect(logs).toHaveLength(2);
  });

  it("found:true 인데 표시 필드가 모두 null 이면 빈 meta 의 found", async () => {
    route({
      [URL_A]: () => nodeRes({ found: true, trackingNo: NO, productName: null, receiverName: null, receiverAddress: null, deliveryMessage: null }),
      [URL_B]: notFoundRes,
    });
    expect(await makeClient().fetchInvoiceMeta(NO)).toEqual({ kind: "found", meta: {} });
  });
});

describe("오류 응답 분류", () => {
  beforeEach(() => {
    config.graphqlUrls = URL_A;
  });

  it("GraphQL errors -> error(graphql_error), 부분 데이터가 있어도 쓰지 않는다", async () => {
    fetchImpl.mockImplementation(async () =>
      jsonRes({ data: { getTrackingSiteInvoice: FOUND_A }, errors: [{ message: "boom", extensions: { code: "INTERNAL_SERVER_ERROR" } }] }),
    );
    expect(await makeClient().fetchInvoiceMeta(NO)).toEqual({ kind: "error", reason: "graphql_error" });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("reason=graphql_error");
  });

  it("아직 새 쿼리를 모르는 백엔드(Cannot query field, HTTP 400) -> error(schema_mismatch), 예외 없음", async () => {
    fetchImpl.mockImplementation(async () =>
      jsonRes(
        { errors: [{ message: 'Cannot query field "getTrackingSiteInvoice" on type "Query".', extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }] },
        400,
      ),
    );
    expect(await makeClient().fetchInvoiceMeta(NO)).toEqual({ kind: "error", reason: "schema_mismatch" });
    expect(logs[0]).toContain("reason=schema_mismatch");
    expect(logs[0]).toContain("http=400");
  });

  it("에러 코드가 없어도 메시지가 Cannot query field 면 schema_mismatch", async () => {
    fetchImpl.mockImplementation(async () => jsonRes({ errors: [{ message: 'Cannot query field "x" on type "Query".' }] }));
    expect(await makeClient().fetchInvoiceMeta(NO)).toEqual({ kind: "error", reason: "schema_mismatch" });
  });

  it("errors 가 빈 배열이면 오류로 보지 않는다", async () => {
    fetchImpl.mockImplementation(async () => jsonRes({ data: { getTrackingSiteInvoice: FOUND_A }, errors: [] }));
    expect((await makeClient().fetchInvoiceMeta(NO)).kind).toBe("found");
  });

  it.each([
    ["HTTP 500", () => new Response("oops", { status: 500 }), "http_error"],
    ["HTTP 404 (JSON 아님)", () => new Response("<html>nope</html>", { status: 404 }), "http_error"],
    ["HTTP 401 (errors 없음)", () => jsonRes({ data: null }, 401), "http_error"],
    ["JSON 이 아닌 200", () => new Response("<html>hello</html>", { status: 200 }), "invalid_response"],
    ["JSON 이지만 객체가 아님", () => jsonRes([1, 2]), "invalid_response"],
    ["data 없음", () => jsonRes({}), "invalid_response"],
    ["data null", () => jsonRes({ data: null }), "invalid_response"],
    ["getTrackingSiteInvoice null", () => nodeRes(null), "invalid_response"],
    ["found 가 boolean 이 아님", () => nodeRes({ found: "true", productName: "x" }), "invalid_response"],
    ["본문이 너무 큼", () => new Response("x".repeat(200_000), { status: 200 }), "invalid_response"],
  ] as const)("%s -> error(%s)", async (_name, make, reason) => {
    fetchImpl.mockImplementation(async () => make());
    expect(await makeClient().fetchInvoiceMeta(NO)).toEqual({ kind: "error", reason });
  });

  it("네트워크 오류 -> error(network)", async () => {
    fetchImpl.mockRejectedValue(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }));
    expect(await makeClient().fetchInvoiceMeta(NO)).toEqual({ kind: "error", reason: "network" });
    expect(logs[0]).toContain("reason=network");
  });

  it("본문을 읽다가 실패해도 예외를 던지지 않는다", async () => {
    fetchImpl.mockImplementation(async () => {
      const res = new Response("{}", { status: 200 });
      vi.spyOn(res, "text").mockRejectedValue(new TypeError("terminated"));
      return res;
    });
    expect(await makeClient().fetchInvoiceMeta(NO)).toEqual({ kind: "error", reason: "network" });
  });
});

describe("타임아웃", () => {
  it("NSV_GRAPHQL_TIMEOUT_MS 가 지나면 그 엔드포인트는 timeout 실패로 처리하고 타이머를 정리한다", async () => {
    vi.useFakeTimers();
    config = { graphqlUrls: URL_A, timeoutMs: 5_000 };
    fetchImpl.mockImplementation(async (url, init) => hang()(url, init));

    const pending = makeClient().fetchInvoiceMeta(NO);
    await vi.advanceTimersByTimeAsync(4_999);
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ kind: "error", reason: "timeout" });
    expect(logs[0]).toContain("reason=timeout");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("앞쪽 엔드포인트가 타임아웃 나면 그때까지 기다렸다가 뒤쪽 found 를 쓴다 (순서 우선, 이후에도 느린 곳에 끌려가지 않음)", async () => {
    vi.useFakeTimers();
    config = { graphqlUrls: `${URL_A},${URL_B}`, timeoutMs: 3_000 };
    fetchImpl.mockImplementation(async (input, init) =>
      String(input) === URL_A ? hang()(input, init) : nodeRes(FOUND_B),
    );

    const pending = makeClient().fetchInvoiceMeta(NO);
    await vi.advanceTimersByTimeAsync(2_999);
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.kind).toBe("found");
    if (result.kind === "found") expect(result.meta.productName).toBe("B사 수건");
  });

  it("전부 응답이 없으면 error(timeout)", async () => {
    vi.useFakeTimers();
    fetchImpl.mockImplementation(async (url, init) => hang()(url, init));
    const pending = makeClient().fetchInvoiceMeta(NO);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await pending).toEqual({ kind: "error", reason: "timeout" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("성공 후에는 타임아웃 타이머가 남지 않는다", async () => {
    vi.useFakeTimers();
    route({ [URL_A]: notFoundRes, [URL_B]: notFoundRes });
    await makeClient().fetchInvoiceMeta(NO);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("방어적 재마스킹", () => {
  it("NSV 가 가리지 못한 주소·배송메시지·수령인은 받는 즉시 가린다", async () => {
    config.graphqlUrls = URL_A;
    fetchImpl.mockImplementation(async () =>
      nodeRes({
        found: true,
        trackingNo: NO,
        productName: "  빨간   양말\n(L)  ",
        receiverName: "홍길동1234",
        receiverAddress: "서울 강남구 도산대로45길 12 101동 1203호",
        deliveryMessage: "직접 받고 부재 시 문 앞 (현관 1234) 비번 abcd 연락 010-1234-5678",
      }),
    );
    const result = await makeClient().fetchInvoiceMeta(NO);
    expect(result).toEqual({
      kind: "found",
      meta: {
        productName: "빨간 양말 (L)",
        receiverName: "홍길동****",
        receiverAddress: "서울 강남구 도산대로45길 *** ***동 ****호",
        deliveryMessage: "직접 받고 부재 시 문 앞 (*********) 비번 *** 연락 ****",
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/1234|5678|1203|abcd/);
  });

  it("이미 가려진 값은 그대로 둔다 (멱등)", async () => {
    config.graphqlUrls = URL_A;
    fetchImpl.mockImplementation(async () => nodeRes(FOUND_A));
    const result = await makeClient().fetchInvoiceMeta(NO);
    expect(result).toEqual({
      kind: "found",
      meta: {
        productName: FOUND_A.productName,
        receiverName: FOUND_A.receiverName,
        receiverAddress: FOUND_A.receiverAddress,
        deliveryMessage: FOUND_A.deliveryMessage,
      },
    });
  });

  it("문자열이 아닌 값과 빈 값은 필드를 뺀다", async () => {
    config.graphqlUrls = URL_A;
    fetchImpl.mockImplementation(async () =>
      nodeRes({ found: true, trackingNo: NO, productName: 123, receiverName: "   ", receiverAddress: null, deliveryMessage: "문 앞" }),
    );
    expect(await makeClient().fetchInvoiceMeta(NO)).toEqual({ kind: "found", meta: { deliveryMessage: "문 앞" } });
  });
});

describe("in-flight dedup", () => {
  it("같은 번호의 동시 요청은 엔드포인트별 호출 1회로 합친다", async () => {
    let release!: (res: Response) => void;
    config.graphqlUrls = URL_A;
    fetchImpl.mockImplementation(() => new Promise<Response>((resolve) => (release = resolve)));
    const client = makeClient();

    const a = client.fetchInvoiceMeta(NO);
    const b = client.fetchInvoiceMeta(NO);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    release(nodeRes(FOUND_A));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.kind).toBe("found");
    expect(rb).toBe(ra);
  });

  it("다른 번호는 각각 호출하고, 끝난 뒤의 요청은 새로 호출한다", async () => {
    config.graphqlUrls = URL_A;
    fetchImpl.mockImplementation(async () => notFoundRes());
    const client = makeClient();

    await Promise.all([client.fetchInvoiceMeta(NO), client.fetchInvoiceMeta("10332484648895")]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await client.fetchInvoiceMeta(NO);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("실패한 요청도 끝나면 in-flight 에서 빠진다", async () => {
    config.graphqlUrls = URL_A;
    fetchImpl.mockRejectedValueOnce(new TypeError("fetch failed"));
    const client = makeClient();
    expect((await client.fetchInvoiceMeta(NO)).kind).toBe("error");
    fetchImpl.mockResolvedValueOnce(nodeRes(FOUND_A));
    expect((await client.fetchInvoiceMeta(NO)).kind).toBe("found");
  });
});

describe("로그 안전성", () => {
  it("실패 로그에는 호스트·사유·상태·번호 뒤 4자리만 있고 응답 본문과 전체 번호는 없다", async () => {
    const marker = "RESPONSE-BODY-MARKER-홍길동-서울시";
    const responses: Array<() => Response> = [
      () => new Response(marker, { status: 500 }),
      () => new Response(marker, { status: 200 }),
      () => jsonRes({ errors: [{ message: `${marker} Cannot query field`, extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }] }, 400),
      () => jsonRes({ errors: [{ message: marker }], data: { getTrackingSiteInvoice: FOUND_A } }),
      () => nodeRes({ found: "yes", productName: marker }),
    ];
    for (const make of responses) {
      fetchImpl.mockImplementationOnce(async () => make());
      fetchImpl.mockImplementationOnce(async () => make());
      await makeClient().fetchInvoiceMeta(NO);
    }
    fetchImpl.mockRejectedValue(new TypeError(`getaddrinfo failed for ${NO} ${marker}`));
    await makeClient().fetchInvoiceMeta(NO);

    expect(logs.length).toBeGreaterThanOrEqual(responses.length * 2);
    for (const line of logs) {
      expect(line).not.toContain(marker);
      expect(line).not.toContain(NO);
      expect(line).not.toContain("Cannot query");
      expect(line).not.toContain(FOUND_A.productName);
      expect(line).toMatch(/^\[nsv\] 조회 실패 host=[\w.]+:\d+ reason=\w+( http=\d+)? no=\*\*\*8894$/);
    }
    expect(logs.some((line) => line.includes("host=a.test:40141"))).toBe(true);
    expect(logs.some((line) => line.includes("host=b.test:40107"))).toBe(true);
  });

  it("정상(found / not_found) 응답은 로그를 남기지 않는다", async () => {
    route({ [URL_A]: notFoundRes, [URL_B]: () => nodeRes(FOUND_B) });
    await makeClient().fetchInvoiceMeta(NO);
    expect(logs).toEqual([]);
  });
});

describe("전역 클라이언트(fetchNsvInvoiceMeta)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    __resetNsvClientForTest();
  });

  it("NSV_GRAPHQL_URLS 가 없으면 즉시 disabled 이고 전역 fetch 를 부르지 않는다", async () => {
    vi.stubEnv("NSV_GRAPHQL_URLS", "");
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await fetchNsvInvoiceMeta(NO)).toEqual({ kind: "disabled" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("환경변수의 주소와 NSV_GRAPHQL_TIMEOUT_MS 를 호출 시점에 읽는다", async () => {
    vi.stubEnv("NSV_GRAPHQL_URLS", URL_A);
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => notFoundRes());
    expect(await fetchNsvInvoiceMeta(NO)).toEqual({ kind: "not_found" });
    expect(String(spy.mock.calls[0][0])).toBe(URL_A);

    vi.stubEnv("NSV_GRAPHQL_URLS", `${URL_B}\n${URL_C}`);
    await fetchNsvInvoiceMeta("10332484648895");
    expect(spy.mock.calls.slice(1).map(([url]) => String(url)).sort()).toEqual([URL_B, URL_C]);
  });

  it("같은 모듈 안에서는 인스턴스를 재사용하고, 핫리로드 전 인스턴스(다른 클래스)는 버린다", () => {
    expect(getDefaultNsvClient()).toBe(getDefaultNsvClient());
    class OldClient {}
    (globalThis as unknown as { __nsvClient?: unknown }).__nsvClient = new OldClient();
    const fresh = getDefaultNsvClient();
    expect(fresh).toBeInstanceOf(NsvClient);
    expect(getDefaultNsvClient()).toBe(fresh);
  });
});
