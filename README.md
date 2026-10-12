# 배송조회 (coupang-pe-kr)

쿠팡 로지스틱스 운송장 배송조회 웹사이트. 고객이 `https://<도메인>/<운송장번호>` 로 접속하면 조회 시점에
[Delivery Tracker](https://tracker.delivery) Tracking API(택배사 `kr.coupangls`)로 배송 정보를 가져와 보여준다.
카카오톡 링크로 휴대폰에서 여는 경우를 가정한 모바일 우선 화면이고, 상품명·받는주소·배송요청사항은 NSV 백엔드 GraphQL 을
운송장번호로 직접 조회(pull)해서 가져온다. 외부 프로그램(NSV)이 운송장번호를 밀어넣을 수 있는 수집 API(push, 선택 사항)와
운영자용 관리자 목록 페이지도 있다.

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
| `NEXT_PUBLIC_COUPANG_PARTNERS_URL` | `https://link.coupang.com/a/bQkvJ5` | 쿠팡 홈 바로가기 배너(상단/하단)의 쿠팡 파트너스 링크. http(s) 주소만 허용, 재빌드 필요 |
| `NEXT_PUBLIC_CONTACT_PHONE` | `010-3277-0737` | 택배사 표 "전화번호" 줄의 문의 연락처 + 문자보내기/전화하기 버튼. 문자 본문 맨 위에 `[배송문의] / 송장번호 / 고객명(마스킹)` 이 채워진다 |
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
| `ALLOW_UNREGISTERED_LOOKUP` | `true` | 미등록 번호 조회 허용 여부. `false` 면 수집 API 로 등록되지 않은 번호는 NSV 도 조회하지 않고 "검색결과 없음" |
| `NSV_GRAPHQL_URLS` | (없음) | NSV 백엔드 GraphQL 엔드포인트 목록(쉼표·공백·줄바꿈 구분, http(s) 만). 비우면 NSV 직접 조회(pull) 꺼짐 |
| `NSV_GRAPHQL_TIMEOUT_MS` | `3000` | NSV 엔드포인트 1곳당 타임아웃 |
| `NSV_META_TTL_MS` | `600000` | NSV 에서 받은 meta 를 다시 조회하지 않는 시간(10분). 지나면 갱신(수집 API 로 들어온 meta 포함) |
| `NSV_META_NEGATIVE_TTL_MS` | `120000` | NSV 가 "없음"으로 답한 번호를 다시 묻지 않는 시간(2분) |
| `API_RATE_LIMIT_PER_MIN` | `30` | `GET /api/track/*` IP당 분당 한도 |
| `INGEST_API_KEYS` | (없음) | `operator1:KEY1,operator2:KEY2`. 미설정이면 수집 API 비활성(503) |
| `ADMIN_USER` | `admin` | 관리자 Basic Auth 사용자 |
| `ADMIN_PASSWORD` | (없음) | 필수. 미설정이면 `/admin` 비활성(503) |

## 화면 / API 개요

| 경로 | 설명 |
| --- | --- |
| `/` | 홈. 운송장번호 입력 → `/{번호}` 이동 |
| `/{운송장번호}` | 조회 화면 (단계바 · 이동 내역(최신이 위) · 수령인(+상품명/받는주소/배송요청사항)/택배사 · 마지막 확인 시각 · 새로고침 `?refresh=1`). `noindex` |
| `/admin` | 등록 운송장 목록 (Basic Auth). 저장된 스냅샷만 표시하며 배송 조회 API 를 호출하지 않는다 |
| `GET /api/track/{번호}[?refresh=1]` | 조회 결과 JSON. IP당 분당 30회, 초과 시 429 |
| `POST /api/invoices` | NSV 수집용 등록 API |
| `GET /api/health` | 프로세스 상태 (배송 조회 API/DB 를 호출하지 않음) |

### 조회 결과(JSON) 상태

`status`: `ok` · `not_found` · `unavailable` · `invalid`, 그리고 `stale`(실시간 조회 실패로 이전 스냅샷을 대신 보여주는 중), `fetchedAt`(스냅샷 시각), `reason`.
`GET /api/track` HTTP 상태: ok/not_found 200, invalid 400, unavailable 503, rate limit 429.

`meta`(NSV 조회(pull) 또는 수집 API(push)로 값을 얻은 번호에만, 값이 있을 때만): `{ productName, receiverAddress, deliveryMessage, receiverName }` 중 값이 있는 것.
수집 API 로 받은 `orderId` / `memo` / `orderedAt` / `operator` 와 내부 기록(`metaFetchedAt` / `metaSource` / `metaNotFoundAt`)은 공개 JSON 에도 화면에도 나가지 않는다.

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
  화면의 수령인 블록은 `이름 님`(굵게, API 이름이 없으면 `meta.receiverName`) 바로 밑에 쿠팡 주문 상세처럼 `상품명` / `받는주소` / `배송요청사항` 행(왼쪽 회색 라벨, 값이 있는 줄만)을 보여주고,
  `meta.receiverAddress` 가 없을 때만 API 지역 줄을 쓴다. meta 가 없는 번호(NSV 에도 없고 push 도 없음)는 예전과 같은 화면이다.
- 택배사: `kr.coupangls` 면 `Coupang Logistics Services` / `1544-9898` 고정, 다른 carrierId 면 이름만 carrierId.
  화면의 "전화번호" 줄은 이 대표번호 대신 문의 연락처(`NEXT_PUBLIC_CONTACT_PHONE`)와 문자보내기/전화하기 버튼을 보여준다.
- 이벤트가 하나도 없지만 오류도 아니면 `ok`(빈 이력)이며 화면에는 "배송 이력 없음 / 아직 배송 이력이 없습니다"로 나온다. `not_found` 와는 다르다.

### 조회 불가 시 보조 링크

조회가 안 될 때(`unavailable`)는 화면에 **"배송조회 페이지에서 보기"** 버튼을 보조로 보여준다. Delivery Tracker Tracking Link
(`https://link.tracker.delivery/track?client_id={ClientId}&carrier_id={CarrierId}&tracking_number={번호}`)로 연결하며,
링크형은 Client Id 만 쓰는 공식 방식이라 **Client Secret 은 URL 에 들어가지 않는다.** Client Id 가 없으면 버튼을 숨긴다.

### NSV 직접 조회 — pull (`src/lib/nsv/client.ts`)

화면의 상품명 / 받는주소 / 배송요청사항(과 수령인 이름 보조값)은 사이트가 NSV 백엔드 GraphQL 에서 **운송장번호로 직접 조회**해서 가져온다.
NSV 쪽에서 아무것도 밀어넣지 않아도(push 설정이 없어도) 동작한다.

```graphql
query TrackingSiteInvoice($input: GetTrackingSiteInvoiceInput!) {
  getTrackingSiteInvoice(input: $input) { found trackingNo productName receiverName receiverAddress deliveryMessage }
}
# variables: { "input": { "trackingNo": "10332484648894" } }
```

- 쿼리는 NSV 가 마스킹한 공개 수준 정보만 돌려주므로 **인증이 없다**. 그래도 받은 값은 사이트가 `src/lib/mask.ts` 로 한 번 더 가린다(멱등, 수집 API 와 같은 정리·마스킹·길이 제한).
- 업체(tenant)마다 NSV 백엔드가 따로 있어 `NSV_GRAPHQL_URLS` 에 엔드포인트를 여러 개 적는다. 번호가 어느 업체 것인지 모르므로 **모든 엔드포인트에 병렬로 POST** 한다(엔드포인트별 타임아웃 `NSV_GRAPHQL_TIMEOUT_MS`).
  `found: true` 인 첫 응답을 쓰고, 여러 곳이 found 면 목록 순서상 앞쪽을 쓴다. 앞쪽 엔드포인트가 모두 found 가 아닌 것으로 확정되면 나머지(느리거나 죽은 곳)를 기다리지 않고 바로 쓴다.
- 결과: `found`(meta) · `not_found`(정상 응답이 있고 모두 `found:false`) · `error`(모든 엔드포인트가 네트워크·타임아웃·GraphQL errors·비정상 응답으로 실패) · `disabled`(`NSV_GRAPHQL_URLS` 가 없음 — 아무것도 호출하지 않음).
  error 사유는 `timeout` · `network` · `http_error` · `schema_mismatch`(NSV 가 아직 이 쿼리를 모름 = 백엔드 재시작·배포 필요) · `graphql_error` · `invalid_response`.
- 같은 번호의 동시 요청은 엔드포인트별 호출 1회로 합친다(in-flight dedup). 로그에는 엔드포인트 `host:port` · 사유 · HTTP 상태 · 운송장번호 뒤 4자리만 남기고, 응답 본문과 전체 번호는 남기지 않는다.
- `NSV_GRAPHQL_URLS` 항목 중 http(s) 주소가 아니거나 형식이 틀린(또는 `user:pw@` 가 들어간) 것은 경고(몇 번째 항목인지만) 후 건너뛴다.

**조회 시점과 저장 (`src/lib/tracking.ts`)** — 번호를 조회할 때마다 저장소 문서의 meta 상태를 보고 NSV 를 부를지 정한다.

| 저장소 상태 | 동작 |
| --- | --- |
| 화면용 meta 가 있고 `metaFetchedAt` 이 `NSV_META_TTL_MS` 이내 | NSV 를 부르지 않고 저장된 meta 사용 |
| `metaNotFoundAt`(음성 캐시)이 `NSV_META_NEGATIVE_TTL_MS` 이내 | NSV 를 부르지 않음 (기존 meta 가 있으면 그대로 사용) |
| 그 밖 (meta 없음 / TTL 지남 / push 로만 들어와 `metaFetchedAt` 없음) | **Delivery Tracker 조회와 병렬로** NSV 조회. 배송 스냅샷이 캐시 히트여도 NSV 만 조회한다 |

- `found` -> meta 를 저장소에 **병합 저장**: 값이 있는 필드만 덮고(빈 값으로 기존 값을 지우지 않음) `metaFetchedAt` · `metaSource: "nsv"` 를 기록, 음성 캐시는 해제. 표시할 값이 하나도 없는 found 는 `not_found` 처럼 취급한다.
- `not_found` -> 음성 캐시 시각(`metaNotFoundAt`)만 기록. 기존 meta 는 지우지 않는다.
- `error` / `disabled` -> 아무것도 기록하지 않고 저장소에 있는 meta 를 그대로 쓴다. 다음 조회에서 바로 다시 시도한다. **NSV 조회 실패는 화면 오류가 되지 않는다** — 배송 조회 결과는 그대로 보이고 meta 만 빈다.
- 운송장이 미등록(`registered:false`)이어도 조회한다(pull 의 목적). 단 `ALLOW_UNREGISTERED_LOOKUP=false` 로 차단된 번호와 잘못된 번호는 NSV 도 부르지 않는다.
- 조회만 된 번호는 `registered:false` 캐시 문서로 저장된다(관리자 목록 `/admin` 에는 수집 API 로 등록된 번호만 나온다).

### pull 과 push(수집 API) 관계

- **pull(NSV_GRAPHQL_URLS)이 기본 경로**다. 설정만 하면 NSV 가 아무것도 보내지 않아도 화면에 상품명·받는주소·배송요청사항이 나온다.
- **push(수집 API `POST /api/invoices`, `INGEST_API_KEYS`)는 선택 사항**이다. 쓰면 NSV 가 보낸 값이 먼저 저장소에 들어가고, pull 이 켜져 있으면 `metaFetchedAt` 이 없는 push meta 는 첫 조회에서 pull 로 갱신된 뒤 TTL 마다 갱신된다
  (같은 필드는 pull 값이 이기고, pull 이 안 준 필드와 운영용 `orderId` / `memo` / `orderedAt` 는 유지).
- pull 이 꺼져 있거나(`NSV_GRAPHQL_URLS` 없음) NSV 가 응답하지 않으면 push 로 들어온 meta 를 그대로 쓴다.
- 로컬 개발: `.env.local` 에 `NSV_GRAPHQL_URLS=http://localhost:4000/graphql`. 백엔드가 아직 `getTrackingSiteInvoice` 를 모르면(재시작·배포 전) `reason=schema_mismatch` 경고만 남고 화면은 meta 없이 정상 동작한다.

### 스냅샷 캐시 (`src/lib/tracking.ts`)

- 배송완료 스냅샷: 최종 상태라 API 를 다시 부르지 않는다. 새로고침(`forceRefresh`)도 스냅샷이 1시간 이내면 무시.
- ok 스냅샷: `CACHE_TTL_MS`(2분) 이내면 캐시.
- not_found 스냅샷: `NOT_FOUND_TTL_MS`(1분) 이내면 캐시.
- 새로고침은 스냅샷이 `MIN_FORCE_REFRESH_MS`(30초)보다 오래됐을 때만 반영.
- 그 외에는 API 조회 → ok/not_found 면 저장. error 면 **이전 스냅샷을 덮어쓰지 않고** `lastError` 만 기록하고,
  이전 스냅샷이 있으면 `stale: true` 로, 없으면 `unavailable` 로 응답한다. 응답이 이상하거나(`invalid_response`) 오류인 경우 **절대 not_found 로 처리하지 않는다**.
- 목록(`/admin`) 렌더링은 DB 의 스냅샷만 읽고 API 를 호출하지 않는다. 수집 API 도 Delivery Tracker 를 호출하지 않는다(대량 등록이 쿼터를 소진하지 않게). NSV 조회(pull)는 번호를 조회할 때만 일어난다(위 "NSV 직접 조회" 참고).
- 공개 API(`GET /api/track`)에는 IP당 rate limit(`API_RATE_LIMIT_PER_MIN`)이 걸려 있다.

## 수집(ingest) API (push, 선택 사항)

NSV 가 운송장번호와 화면용 정보를 사이트로 밀어넣는 경로다. 화면용 정보는 `NSV_GRAPHQL_URLS` 로 사이트가 직접 조회(pull)할 수 있으므로 이 API 는 쓰지 않아도 된다.

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
        "receiverName": "홍길동", "orderedAt": "2026-10-08T09:00:00+09:00", "memo": "선물포장",
        "receiverAddress": "충청북도 청주시 상당구 용암동 **** 지음프라자 *** 호",
        "deliveryMessage": "직접 받고 부재 시 문 앞 (*********)" },
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
- `carrier` 는 생략하거나 `"coupang"` 만 허용. 문자열 필드는 길이 상한(주문번호 64 / 상품명 200 / 수령인 50 / 수취인 주소 200 / 배송메시지 200 / 주문시각 40 / 메모 500)을 넘으면 잘라서 저장한다.
- 고객 화면에 나가는 필드: `productName`(노출상품명·옵션명), `receiverName`, `receiverAddress`, `deliveryMessage`(모두 선택). `orderId` / `memo` / `orderedAt` 는 운영용이라 고객에게 나가지 않는다.
  문자열이 아닌 값(객체·배열·불리언)이면 그 항목만 `invalid_type:<필드>` 로 보고한다(숫자는 문자열로 받아준다).
- **재마스킹(안전망)**: `receiverAddress` / `deliveryMessage` 는 NSV 가 이미 가려서 보내는 값이지만, 사이트도 저장 전에 한 번 더 같은 규칙으로 가린다(`src/lib/mask.ts`, 이미 별표인 값은 그대로 = 멱등. 길이 제한은 마스킹 뒤에 자른다).
  `receiverName` 에 숫자가 섞여 있으면 숫자만 가린다. 규칙은 아래 "마스킹 규칙" 참고.
- 같은 요청 안에서 번호가 중복되면 하나로 합치고(뒤 값 우선) `duplicates` 에 센다.
- 인증 실패를 IP당 분당 20회 넘게 반복하면 429.

### 마스킹 규칙 (`src/lib/mask.ts`)

| 대상 | 규칙 | 예 |
| --- | --- | --- |
| 주소 | 숫자 덩어리(`-`·`,` 로 이어진 숫자열 전체)를 별표로. 숫자 1~3개 `***`, 4개 이상 `****`. 한글 지명·건물명은 유지하고, **숫자 덩어리 바로 앞 글자가 한글**이면(행정구역·도로명) 덩어리 전체를 그대로 둔다 | `101동 1203호` -> `***동 ****호`, `B102호` -> `B***호`, `상계3동`·`종로1가`·`도산대로45길`·`가산로9-1` 유지, `010-1234-5678` -> `****` |
| 배송메시지 | (1) 괄호 안 전체 -> `(*********)`(별표 9개) (2) 괄호 밖 숫자 덩어리와 `#`·`*` 가 붙은 코드 -> `***`·`****` (3) `비밀번호·비번·출입번호·현관번호·공동현관·pw·password` 다음 토큰(조사 은/는/이/가와 `: = -` 는 건너뜀)에 숫자·영문자·`#`·`*` 가 있으면 `***`. 순수 한글 토큰과 이미 별표뿐인 토큰은 그대로 | `문 앞 (공동현관 1234)` -> `문 앞 (*********)`, `비밀번호는 #1234 입니다` -> `비밀번호는 **** 입니다`, `공동현관 비번 종1234 문앞` -> `공동현관 비번 *** 문앞`, `공동현관 앞에 놔주세요` 그대로, `3시 이후 배송` -> `***시 이후 배송` |
| 공통 | 제어문자·연속 공백 정리, 빈 값은 빈 문자열 | |

NSV 와 같은 규칙이며 사이트는 1차 마스킹이 빠진 값을 막는 안전망이다.

## 관리자

`ADMIN_PASSWORD` 를 설정하면 `/admin` 이 열린다(HTTP Basic Auth, 사용자 기본 `admin`). **반드시 HTTPS 뒤에서** 쓸 것.
등록된 운송장을 최신 등록순 50건씩 보여주고(상품명·수령인·마스킹된 받는주소/배송요청사항 포함) 운송장번호/상품명/주문번호로 검색할 수 있으며, 고객 링크 복사 버튼이 있다.

## 배포

### pm2 (권장: 단일 인스턴스)

in-flight dedup, 호출 제한 백오프, rate limit 상태가 **프로세스 메모리**에 있으므로 **인스턴스는 1개**를 권장한다
(`ecosystem.config.js` 는 `instances: 1`, fork 모드. cluster 모드/다중 인스턴스에서는 이 보호가 인스턴스별로 따로 동작한다).

```bash
npm ci
cp .env.example .env.local && vi .env.local      # DELIVERY_TRACKER_*, NSV_GRAPHQL_URLS, MONGODB_URI, ADMIN_PASSWORD (선택: INGEST_API_KEYS) 등
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
  components/                    StepBar, EventTable, TrackingView, CoupangHomeBanner(Shell 상·하단), CopyButton(관리자), InvoiceForm ...
  lib/
    deliveryTracker/client.ts    Tracking API 호출: GraphQL, 타임아웃, in-flight dedup, 결과 분류, 호출 제한 백오프
    deliveryTracker/map.ts       순수 함수: API 응답 -> TrackingData (픽스처: __fixtures__/)
    deliveryTracker/link.ts      Tracking Link(보조 버튼) URL 생성 — Client Id 만 사용
    deliveryTracker/types.ts     TrackingData / UpstreamResult 타입
    nsv/client.ts                NSV GraphQL 조회(pull): 병렬 호출, 순서 우선 found 채택, 타임아웃, dedup, 재마스킹
    store/                       InvoiceStore 인터페이스 + Mongo / Memory 구현 (meta 병합 저장, 음성 캐시 포함)
    tracking.ts                  캐시 정책 + 조회 오케스트레이션 (Delivery Tracker 와 NSV 병렬 조회)
    ingest.ts auth.ts rateLimit.ts format.ts config.ts invoiceNo.ts
    mask.ts                      주소·배송메시지 마스킹 (수집 API 저장 직전 안전망, 멱등)
scripts/smoke.ts                 실제 1건 조회 확인용
ecosystem.config.js              pm2 (instances: 1)
```

## 테스트

`npm test` 는 네트워크/DB 없이 돈다(GraphQL 응답 JSON 픽스처, `fetch` 목, 가짜 타이머, 인메모리 저장소). NSV 조회도 `fetch` 목으로 검증하며,
테스트 환경에서는 `NSV_GRAPHQL_URLS` 를 비워 둔다(`vitest.config.mts`)라서 개발자 셸에 값이 있어도 실제 NSV 를 부르지 않는다.
Mongo 구현까지 검증하려면 로컬 MongoDB 를 띄우고 `TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test` 로 실행한다
(`src/lib/store/store.test.ts` 의 계약 테스트가 임시 DB 를 만들고 지운다).

화면을 실제 API 호출 없이 확인하려면 `DELIVERY_TRACKER_ENDPOINT` 를 로컬 목 GraphQL 서버(`POST /graphql`, 픽스처 JSON 응답)로 지정하고
임의의 `DELIVERY_TRACKER_CLIENT_ID` / `DELIVERY_TRACKER_CLIENT_SECRET` 값을 넣으면 된다.

## 개발 시 주의

- 실제 Delivery Tracker 호출(`npm run smoke`)은 쿼터를 소모한다. 로직은 `src/lib/deliveryTracker/__fixtures__/` 의 픽스처로 검증한다.
- Client Secret 은 `.env.local` 에만 두고 저장소·로그·화면·URL 어디에도 남기지 않는다.
- 운송장 페이지는 `noindex` 이며, 고객 개인정보 보호를 위해 수령인은 API 가 내려주는 마스킹 원문(`이*화`)만 저장·표시한다.
  수취인 주소·배송메시지는 마스킹된 값만 저장·표시하며(저장 전 재마스킹, NSV pull 로 받은 값도 동일), 원본 주소/전화번호/출입 비밀번호는 저장소·로그·화면·공개 JSON 어디에도 남기지 않는다.
