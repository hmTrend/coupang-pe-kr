# 배송조회 (coupang-pe-kr)

쿠팡 로지스틱스 운송장 배송조회 웹사이트. 고객이 `https://<도메인>/<운송장번호>` 로 접속하면 조회 시점에
[Delivery Tracker](https://tracker.delivery) Tracking API(택배사 `kr.coupangls`)로 배송 정보를 가져와 보여준다.
카카오톡 링크로 휴대폰에서 여는 경우를 가정한 모바일 우선 화면이고, 외부 프로그램(NSV)이 운송장번호를
자동 등록할 수 있는 수집 API와 운영자용 관리자 목록 페이지가 있다.

- 스택: Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · MongoDB(공식 `mongodb` 드라이버) · vitest
- 런타임: Node 22
- 쿠팡 로고/브랜드 색상은 쓰지 않는 중립 디자인이다.

## 빠른 시작

```bash
npm install
cp .env.example .env.local     # 필요한 값만 채운다 (모두 비워도 개발 서버는 뜬다)
npm run dev                    # http://localhost:3000
```

배송 조회를 하려면 [Delivery Tracker 콘솔](https://console.tracker.delivery)에서 Client Id / Client Secret 을 발급받아
`.env.local` 의 `DELIVERY_TRACKER_CLIENT_ID`, `DELIVERY_TRACKER_CLIENT_SECRET` 에 넣는다(환경변수를 바꾼 뒤에는 서버 재시작).
자격증명이 없으면 조회 화면은 "일시적으로 조회할 수 없습니다"가 되고 서버 로그에 경고가 1회 남는다.

`MONGODB_URI` 를 비워 두면 인메모리 저장소로 동작한다(개발용, 서버 재시작 시 등록·스냅샷 소실, 시작 시 경고 로그).

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 |
| `npm run build` / `npm start` | 프로덕션 빌드 / 실행 |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | vitest (배송 조회 API·DB 없이 픽스처/목으로 동작) |
| `npm run smoke -- <운송장번호>` | **실제** Delivery Tracker API 에 1건 조회해 매핑 결과 출력 (자격증명 필요, 쿼터 소모) |

## 왜 서버에서 API 를 호출하나

Tracking API 는 매 요청에 Client Secret 을 요구한다(`Authorization: TRACKQL-API-KEY {ClientId}:{ClientSecret}`).
브라우저(프론트엔드)에서 직접 호출하면 Secret 이 번들/네트워크 탭에 노출되어 누구나 키를 복사해 쿼터를 소진시킬 수 있다.
그래서 호출은 **Next.js 서버 쪽(서버 컴포넌트·route)** 에서만 하고, 환경변수에는 `NEXT_PUBLIC_` 접두사를 붙이지 않는다.
같은 프로젝트 안의 서버 코드이므로 별도 백엔드를 두는 것은 아니다(Vercel 이면 서버리스 함수로 돈다).

## 환경변수

전체 목록과 설명은 [`.env.example`](./.env.example) 참고.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_NAME` | `배송조회` | 사이트 이름. 빌드 시점에 인라인되므로 바꾸면 재빌드 필요 |
| `NEXT_PUBLIC_SITE_URL` | (없음) | 공개 URL. 미리보기용 `metadataBase` |
| `DELIVERY_TRACKER_CLIENT_ID` | (없음) | Delivery Tracker Client Id. Tracking Link 보조 버튼에도 쓴다 |
| `DELIVERY_TRACKER_CLIENT_SECRET` | (없음) | Client Secret (**비밀값**, 서버 전용). 없으면 조회 불가(`not_configured`) |
| `DELIVERY_TRACKER_CARRIER_ID` | `kr.coupangls` | 택배사 ID |
| `DELIVERY_TRACKER_TIMEOUT_MS` | `15000` | 요청 1회 타임아웃 (공식 권장 최대 15초) |
| `DELIVERY_TRACKER_ENDPOINT` | `https://apis.tracker.delivery/graphql` | 개발/테스트 전용 override. 운영에서는 비워 둔다 |
| `MONGODB_URI` | (없음) | 미설정 시 인메모리 저장소 |
| `MONGODB_DB` | `coupang_pe_kr` | DB 이름 (컬렉션 `invoices`) |
| `CACHE_TTL_MS` | `120000` | ok 스냅샷 캐시 시간 |
| `NOT_FOUND_TTL_MS` | `60000` | not_found 스냅샷 캐시 시간 |
| `MIN_FORCE_REFRESH_MS` | `30000` | 새로고침(`?refresh=1`)이 반영되려면 스냅샷이 이보다 오래돼야 함 |
| `DELIVERED_RECHECK_MS` | `3600000` | 배송완료 스냅샷은 새로고침해도 이 시간 이내면 재조회 안 함 |
| `ALLOW_UNREGISTERED_LOOKUP` | `true` | 미등록 번호 조회 허용 여부 |
| `API_RATE_LIMIT_PER_MIN` | `30` | `GET /api/track/*` IP당 분당 한도 |
| `INGEST_API_KEYS` | (없음) | `operator1:KEY1,operator2:KEY2`. 미설정이면 수집 API 비활성(503) |
| `ADMIN_USER` | `admin` | 관리자 Basic Auth 사용자 |
| `ADMIN_PASSWORD` | (없음) | 필수. 미설정이면 `/admin` 비활성(503) |

## 화면 / API 개요

| 경로 | 설명 |
| --- | --- |
| `/` | 홈. 운송장번호 입력 → `/{번호}` 이동 |
| `/{운송장번호}` | 조회 화면 (단계바 · 이동 내역(최신이 위) · 수령인/택배사 · 마지막 확인 시각 · 새로고침 `?refresh=1`). `noindex` |
| `/admin` | 등록 운송장 목록 (Basic Auth). 저장된 스냅샷만 표시하며 배송 조회 API 를 호출하지 않는다 |
| `GET /api/track/{번호}[?refresh=1]` | 조회 결과 JSON. IP당 분당 30회, 초과 시 429 |
| `POST /api/invoices` | NSV 수집용 등록 API |
| `GET /api/health` | 프로세스 상태 (배송 조회 API/DB 를 호출하지 않음) |

### 조회 결과(JSON) 상태

`status`: `ok` · `not_found` · `unavailable` · `invalid`, 그리고 `stale`(실시간 조회 실패로 이전 스냅샷을 대신 보여주는 중), `fetchedAt`(스냅샷 시각), `reason`.
`GET /api/track` HTTP 상태: ok/not_found 200, invalid 400, unavailable 503, rate limit 429.

`reason` 은 일반화된 값만 노출한다: `not_configured`(자격증명 미설정) · `upstream_unavailable`(인증 실패·호출 제한·타임아웃 등 모든 조회 실패) ·
`unregistered_lookup_disabled` · `invalid_invoice_no`. 세부 사유(`error:auth`, `error:rate_limited` 등)는 서버 로그와 저장소의 `lastError`(관리자 화면)에만 남는다.

## 조회 / 캐시 정책

### Delivery Tracker 호출 (`src/lib/deliveryTracker/`)

- `POST https://apis.tracker.delivery/graphql` (GraphQL). 인증은 `Authorization: TRACKQL-API-KEY {ClientId}:{ClientSecret}`.
  요청은 `cache: "no-store"` 로 보내 Next 의 fetch 캐시가 끼지 않게 하고, 타임아웃은 AbortSignal(기본 15초)로 건다.
- 결과 분류: `ok` · `not_found`(GraphQL `NOT_FOUND`) · `error`. error 사유는 `not_configured` · `auth`(FORBIDDEN/UNAUTHENTICATED, HTTP 401/403) ·
  `rate_limited`(HTTP 429 등) · `timeout` · `network` · `server_error`(5xx, INTERNAL) · `bad_request` · `invalid_response`.
  GraphQL 오류가 하나라도 있으면 부분 데이터가 있어도 쓰지 않는다(빈 이력을 정상 스냅샷으로 캐시하지 않기 위함).
- 같은 운송장에 대한 동시 요청은 API 호출 1회로 합친다(in-flight dedup).
- `rate_limited` 를 받으면 **30초 동안 전역 백오프**: 그 동안은 API 를 부르지 않고 캐시/stale 로만 응답한다(쿼터 보호).
- 로그에는 사유·HTTP 상태·에러 코드·(Secret 을 가린) 짧은 메시지만 남기고, 응답 본문과 자격증명은 남기지 않는다.
- 쿼리는 오픈소스 스키마에 있는 필드만 쓴다(`track { trackingNumber lastEvent events(last: 100) recipient }`).

### 응답 -> 화면 매핑 (`map.ts`, 순수 함수)

- `events`: API 순서(오래된 것 -> 최신) 그대로. `time` 은 KST `yyyy-MM-dd HH:mm:ss`, `status` 는 `status.name`(없으면 코드의 한국어 라벨),
  `location` 은 `description`(`"{상태} - {위치}"`)의 첫 `" - "` 뒤. 없으면 `location.name`, 둘 다 없으면 빈 문자열.
- `delivered`/`latest`: `lastEvent` 우선(없으면 마지막 이벤트). `lastEvent.status.code === DELIVERED` 가 배송완료이며, 배송완료 뒤에 다른 이벤트가 등록돼도 배송완료를 유지한다.
- 단계바(인수/이동/배송지/배송중/배송완료): 가장 진행된 이벤트 기준. `status.name` 으로 먼저 정한다 —
  운송장 등록·택배접수·집하 → 인수 / 캠프상차·소터분류·센터상차·센터도착·공항·통관 계열 → 이동 / 캠프도착 → 배송지 / 배송출발 → 배송중 / 배송완료 → 배송완료.
  이름으로 못 정하면 코드로: INFORMATION_RECEIVED·AT_PICKUP → 인수, IN_TRANSIT → 이동, OUT_FOR_DELIVERY·ATTEMPT_FAIL·AVAILABLE_FOR_PICKUP → 배송중, DELIVERED → 배송완료,
  UNKNOWN·EXCEPTION → 변화 없음.
- 수령인: `recipient.name`(마스킹 원문, 예 `이*화`) / 주소는 `recipient.location.name`(없으면 빈 문자열이며 화면에서 그 줄을 숨긴다).
- 택배사: `kr.coupangls` 면 `Coupang Logistics Services` / `1544-9898` 고정, 다른 carrierId 면 이름만 carrierId.
- 이벤트가 하나도 없지만 오류도 아니면 `ok`(빈 이력)이며 화면에는 "배송 이력 없음 / 아직 배송 이력이 없습니다"로 나온다. `not_found` 와는 다르다.

### 조회 불가 시 보조 링크

조회가 안 될 때(`unavailable`)는 화면에 **"배송조회 페이지에서 보기"** 버튼을 보조로 보여준다. Delivery Tracker Tracking Link
(`https://link.tracker.delivery/track?client_id={ClientId}&carrier_id={CarrierId}&tracking_number={번호}`)로 연결하며,
링크형은 Client Id 만 쓰는 공식 방식이라 **Client Secret 은 URL 에 들어가지 않는다.** Client Id 가 없으면 버튼을 숨긴다.

### 스냅샷 캐시 (`src/lib/tracking.ts`)

- 배송완료 스냅샷: 최종 상태라 API 를 다시 부르지 않는다. 새로고침(`forceRefresh`)도 스냅샷이 1시간 이내면 무시.
- ok 스냅샷: `CACHE_TTL_MS`(2분) 이내면 캐시.
- not_found 스냅샷: `NOT_FOUND_TTL_MS`(1분) 이내면 캐시.
- 새로고침은 스냅샷이 `MIN_FORCE_REFRESH_MS`(30초)보다 오래됐을 때만 반영.
- 그 외에는 API 조회 → ok/not_found 면 저장. error 면 **이전 스냅샷을 덮어쓰지 않고** `lastError` 만 기록하고,
  이전 스냅샷이 있으면 `stale: true` 로, 없으면 `unavailable` 로 응답한다. 응답이 이상하거나(`invalid_response`) 오류인 경우 **절대 not_found 로 처리하지 않는다**.
- 목록(`/admin`) 렌더링은 DB 의 스냅샷만 읽고 API 를 호출하지 않는다. 수집 API 도 호출하지 않는다(대량 등록이 쿼터를 소진하지 않게).
- 공개 API(`GET /api/track`)에는 IP당 rate limit(`API_RATE_LIMIT_PER_MIN`)이 걸려 있다.

## 수집(ingest) API

키 설정: `INGEST_API_KEYS="nsv-main:긴랜덤키1,nsv-sub:긴랜덤키2"` (키별 operator 라벨). 미설정이면 503.
인증: `Authorization: Bearer <key>` 또는 `x-api-key: <key>`.

```bash
curl -X POST https://<도메인>/api/invoices \
  -H "Authorization: Bearer 긴랜덤키1" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      { "invoiceNo": "10332152871106", "carrier": "coupang",
        "orderId": "20261008-0001", "productName": "양말 세트",
        "receiverName": "홍길동", "orderedAt": "2026-10-08T09:00:00+09:00", "memo": "선물포장" },
      { "invoiceNo": "1033-2152-871107" }
    ]
  }'
```

응답:

```json
{ "ok": true, "received": 2, "upserted": 2, "updated": 0, "duplicates": 0, "invalid": [] }
```

- 한 번에 최대 500건. 번호의 공백·하이픈은 제거하고 `10~16자리 숫자`가 아니면 `invalid: [{ index, invoiceNo, reason }]` 로 보고(나머지는 정상 처리).
- `invoiceNo` 기준 **멱등 upsert**. 이미 등록된 건은 보낸 필드만 갱신(meta 병합)하고 `registeredAt`/`operator` 는 유지한다.
- `carrier` 는 생략하거나 `"coupang"` 만 허용. 문자열 필드는 길이 상한(주문번호 64 / 상품명 200 / 수령인 50 / 주문시각 40 / 메모 500)을 넘으면 잘라서 저장한다.
- 같은 요청 안에서 번호가 중복되면 하나로 합치고(뒤 값 우선) `duplicates` 에 센다.
- 인증 실패를 IP당 분당 20회 넘게 반복하면 429.

## 관리자

`ADMIN_PASSWORD` 를 설정하면 `/admin` 이 열린다(HTTP Basic Auth, 사용자 기본 `admin`). **반드시 HTTPS 뒤에서** 쓸 것.
등록된 운송장을 최신 등록순 50건씩 보여주고 운송장번호/상품명/주문번호로 검색할 수 있으며, 고객 링크 복사 버튼이 있다.

## 배포

### pm2 (권장: 단일 인스턴스)

in-flight dedup, 호출 제한 백오프, rate limit 상태가 **프로세스 메모리**에 있으므로 **인스턴스는 1개**를 권장한다
(`ecosystem.config.js` 는 `instances: 1`, fork 모드. cluster 모드/다중 인스턴스에서는 이 보호가 인스턴스별로 따로 동작한다).

```bash
npm ci
cp .env.example .env.local && vi .env.local      # DELIVERY_TRACKER_*, MONGODB_URI, INGEST_API_KEYS, ADMIN_PASSWORD 등
npm run build
pm2 start ecosystem.config.js
pm2 save
```

- `next start` 가 프로젝트 디렉터리의 `.env.local` / `.env.production` 을 읽는다. `NEXT_PUBLIC_*` 를 바꾸면 재빌드.
- 리버스 프록시(nginx / Cloudflare)를 앞에 둘 것. rate limit 의 IP 는 `cf-connecting-ip` → `x-real-ip` → `x-forwarded-for` 첫 항목 순으로 읽으므로,
  프록시가 이 헤더를 **덮어써서** 전달하도록 설정해야 한다(직접 노출하면 헤더 위조로 제한을 우회할 수 있음).
- 모든 응답이 항상 최신이어야 하므로 프록시에서 `/api/*`, `/{운송장번호}` 응답을 캐시하지 말 것.
- 배포 후 서버에서 `npm run smoke -- <운송장번호>` 로 자격증명·연결을 1회 확인한다(쿼터가 소모되므로 반복 실행하지 말 것).

### Vercel 등 서버리스

가능하다. 다만 서버리스는 인스턴스(람다)마다 메모리가 분리되어 **in-flight dedup·백오프·IP rate limit 이 인스턴스 사이에 공유되지 않는다.**
트래픽이 몰리면 같은 번호가 여러 인스턴스에서 동시에 조회될 수 있으므로 쿼터 여유를 확인할 것. 인메모리 저장소는 쓸 수 없고 `MONGODB_URI` 가 필수.
Client Secret 은 서버 환경변수(`NEXT_PUBLIC_` 없이)로만 등록한다.

## 구조

```
src/
  middleware.ts                  /admin Basic Auth
  app/
    page.tsx                     홈
    [invoiceNo]/page.tsx         조회 화면 (generateMetadata + React cache 로 조회 1회)
    admin/page.tsx               관리자 목록
    api/track/[invoiceNo]/       조회 JSON
    api/invoices/                수집 API
    api/health/  go/
  components/                    StepBar, EventTable, TrackingView, CopyButton(관리자), InvoiceForm ...
  lib/
    deliveryTracker/client.ts    Tracking API 호출: GraphQL, 타임아웃, in-flight dedup, 결과 분류, 호출 제한 백오프
    deliveryTracker/map.ts       순수 함수: API 응답 -> TrackingData (픽스처: __fixtures__/)
    deliveryTracker/link.ts      Tracking Link(보조 버튼) URL 생성 — Client Id 만 사용
    deliveryTracker/types.ts     TrackingData / UpstreamResult 타입
    store/                       InvoiceStore 인터페이스 + Mongo / Memory 구현
    tracking.ts                  캐시 정책 + 조회 오케스트레이션
    ingest.ts auth.ts rateLimit.ts format.ts config.ts invoiceNo.ts
scripts/smoke.ts                 실제 1건 조회 확인용
ecosystem.config.js              pm2 (instances: 1)
```

## 테스트

`npm test` 는 네트워크/DB 없이 돈다(GraphQL 응답 JSON 픽스처, `fetch` 목, 가짜 타이머, 인메모리 저장소).
Mongo 구현까지 검증하려면 로컬 MongoDB 를 띄우고 `TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test` 로 실행한다
(`src/lib/store/store.test.ts` 의 계약 테스트가 임시 DB 를 만들고 지운다).

화면을 실제 API 호출 없이 확인하려면 `DELIVERY_TRACKER_ENDPOINT` 를 로컬 목 GraphQL 서버(`POST /graphql`, 픽스처 JSON 응답)로 지정하고
임의의 `DELIVERY_TRACKER_CLIENT_ID` / `DELIVERY_TRACKER_CLIENT_SECRET` 값을 넣으면 된다.

## 개발 시 주의

- 실제 Delivery Tracker 호출(`npm run smoke`)은 쿼터를 소모한다. 로직은 `src/lib/deliveryTracker/__fixtures__/` 의 픽스처로 검증한다.
- Client Secret 은 `.env.local` 에만 두고 저장소·로그·화면·URL 어디에도 남기지 않는다.
- 운송장 페이지는 `noindex` 이며, 고객 개인정보 보호를 위해 수령인은 API 가 내려주는 마스킹 원문(`이*화`)만 저장·표시한다.
