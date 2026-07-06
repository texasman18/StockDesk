# StockDesk (스탁데스크)

증권사 애널리스트 전용 개인 포트폴리오 관리 앱 — `StockDesk_기획서.docx` v1.0 기반 구현.

## 실행 방법

빌드 과정 없음. 정적 파일이므로 아무 웹서버로 열면 됩니다.

```bash
cd StockDesk
python3 -m http.server 8080
# 브라우저에서 http://localhost:8080 접속
```

아이폰에서 사용: 같은 Wi-Fi에서 `http://<맥의IP>:8080` 접속 → Safari 공유 → **홈 화면에 추가** 하면 전체화면 앱처럼 실행됩니다. (iPhone 17 Air 해상도 기준 최적화, 320~520px 유동 대응)

## 기능 구현 현황 (기획서 Feature Map 대비)

| 코드 | 기능 | 상태 |
|---|---|---|
| F01 | 종목 등록/수정/삭제 (자동완성, 롱프레스 메뉴, 삭제 확인, 중복 시 평단 재계산/덮어쓰기) | ✅ |
| F02 | 평단가·수량 입력/수정 | ✅ |
| F03 | 시세 연동 | ✅ 실시세 연동 완료 — 국내: 네이버 금융 비공식 API(키 불필요), 해외: Alpha Vantage. 기본은 데모 모드, 설정에서 전환 |
| F04 | 대시보드 (총 매입/평가/손익/손익률, 원화 환산 합산) | ✅ |
| F05 | 물타기 계산기 (목표 평단가/손익률 토글, 슬라이더+직접입력, 예외 처리) | ✅ |
| F06 | 종목 상세 (당일 5분봉 차트 + 전일종가 기준선 + 뉴스 3건) | ✅ 뉴스는 Google News RSS 실연동(API 키 불필요) — 데모 모드에서는 샘플 |
| F07 | 모닝 브리핑 (핵심지표 5 + 더보기, 보유종목 뉴스 분리, 08:00 자동 갱신) | ✅ |
| F08 | 수동 새로고침 (전 화면 공통 헤더 버튼) | ✅ |
| F09 | 시장 구분 탭 (전체/한국장/미국장/ETF) | ✅ |
| F10 | 환율 반영 (해외주식 원화 환산, 설정에서 수동 조정 가능) | ✅ |

비기능 요구사항: 고정폭 숫자(tabular figures)·3자리 콤마, 수익=적색/손실=청색 + ▲▼ 기호 병기, 시세 타임스탬프 노출, 갱신 실패 시 마지막 데이터 유지, 로컬 저장(계좌 연동 없음) + JSON 백업/복원 — 모두 반영.

## 실시세 연동 (F03) — 배포 가이드

설정 화면에서 **"데모 시세 모드"를 끄면** 실시세를 사용합니다.

- **국내주식/국내ETF** → 네이버 금융 모바일 API(비공식/undocumented, 키 불필요). [netlify/functions/naver-quote.js](netlify/functions/naver-quote.js) 프록시를 거칩니다(CORS 우회 목적일 뿐 인증은 필요 없음). **로컬 `python3 -m http.server`나 단순 정적 호스팅으로는 동작하지 않고, Netlify에 배포해야만 동작합니다.** 비공식 API라 네이버가 구조를 바꾸면 예고 없이 깨질 수 있습니다 — 개인용(기획서 1.2 "1인 로컬 사용 전제")으로는 실용적이지만, 더 안정적인 공식 연동이 필요하면 [netlify/functions/kis-quote.js](netlify/functions/kis-quote.js)(한국투자증권 오픈API, 이미 구현되어 있으나 현재는 미사용)로 교체할 수 있습니다.
- **미국주식/해외ETF + 환율(F10)** → Alpha Vantage. CORS를 지원해서 브라우저에서 바로 호출하며, 별도 배포 없이 로컬에서도 동작합니다.
- **종목 뉴스(F06) + 모닝 브리핑 시장 전체 뉴스(F07)** → Google News RSS. [netlify/functions/news.js](netlify/functions/news.js) 프록시를 거치지만 **API 키가 필요 없습니다.** 공개 RSS라서 CORS 우회용 프록시만 있으면 됩니다.
- **모닝 브리핑 지수(코스피/코스닥/다우/나스닥 등)와 당일 분봉 차트**는 이번 연동 범위에 포함되지 않아 실시간 모드에서도 데모 데이터로 유지됩니다(기획서 7장 "확인 필요" 항목 — 추후 별도 연동 필요).
- 프록시 호출 실패, API 키 미입력 등 오류 시 마지막 성공 데이터를 유지하고(뉴스는 샘플로 자동 폴백) 새로고침 시 오류 메시지를 토스트로 보여줍니다.

### 발급해야 하는 키 목록

| 항목 | 필요 여부 | 발급 난이도 |
|---|---|---|
| Alpha Vantage API 키 | 필요 (해외주식·ETF·환율) | 이메일만 입력, 즉시 발급 |
| 네이버 금융 (국내주식·ETF) | **불필요** | 비공식 공개 엔드포인트, 키 없이 바로 사용 |
| Google News RSS | **불필요** | 공개 피드, 키 없이 바로 사용 |
| (선택) 한국투자증권 App Key/Secret | 불필요 — 더 안정적인 공식 연동으로 나중에 바꾸고 싶을 때만 | 계좌 필요, 개발자센터 가입 + 승인 |

### 1. Alpha Vantage API 키 발급 (무료, 즉시) — 유일하게 직접 발급받아야 하는 키

1. [alphavantage.co/support/#api-key](https://www.alphavantage.co/support/#api-key) 접속
2. 이메일 주소만 입력 → **GET FREE API KEY** 클릭
3. 화면에 바로 뜨는 키를 앱 설정 화면의 "Alpha Vantage API 키"에 입력

**무료 티어는 분당 5회·일 25회 호출 제한**이 있어 보유 종목이 많으면 새로고침 한 번에 시간이 걸리거나 일부 종목이 갱신되지 않을 수 있습니다.

### 2. (선택) 한국투자증권 App Key/Secret — 지금은 필요 없음

네이버 연동으로 국내 시세는 키 없이 바로 되므로 이 단계는 건너뛰어도 됩니다. 나중에 네이버 비공식 API가 불안정해져서 공식 API로 바꾸고 싶어지면:

1. 한국투자증권 계좌 개설 (실전 계좌 또는 **모의투자 계좌**만으로도 가능 — 모의투자는 비대면 개설이 더 간단함)
2. [KIS Developers 개발자센터](https://apiportal.koreainvestment.com)에서 회원가입 후 로그인 (1번의 증권 계좌 정보로 인증)
3. 상단 메뉴 "OpenAPI 신청" → 이용 목적 등 간단한 신청서 작성 후 제출
4. 승인되면 마이페이지에서 **App Key**, **App Secret** 확인 (실전투자/모의투자용이 각각 별도 발급됨 — 둘 중 쓸 쪽만 있으면 됨)
5. [js/quotes.js](js/quotes.js)의 `fetchNaverQuotes` 호출을 `fetchKisQuotes`(이미 구현되어 있음)로 되돌리고 Netlify 환경변수(`KIS_APP_KEY`/`KIS_APP_SECRET`)를 등록

### 3. Netlify 배포 (Functions 사용을 위해 CLI/Git 배포 필요 — 단순 드래그앤드롭 불가)

```bash
npm install -g netlify-cli
cd StockDesk
netlify init      # 새 사이트 생성 또는 기존 사이트 연결
netlify deploy --prod
```

네이버 연동은 환경변수 없이 바로 동작합니다. Alpha Vantage 키는 브라우저에서 직접 호출하므로 서버 환경변수가 아니라 **앱 설정 화면**에 입력하면 됩니다. (KIS로 나중에 교체할 경우에만 `KIS_APP_KEY`/`KIS_APP_SECRET`/`KIS_ENV` 환경변수 등록이 필요합니다.)

로컬에서 프록시 동작까지 확인하려면 `netlify dev`(Netlify CLI)로 실행해야 합니다 — 일반 `http.server`는 `/.netlify/functions/*` 경로를 처리하지 못해 404가 뜹니다.

## 파일 구조

```
index.html                       화면 6종 (S01~S06) 마크업
netlify.toml                     Netlify 빌드/Functions 설정
netlify/functions/naver-quote.js 네이버 금융 API 프록시 (기본 사용, 키 불필요, CORS 우회용)
netlify/functions/kis-quote.js   한국투자증권 API 프록시 (선택적 대체 옵션, 현재 미사용)
netlify/functions/news.js        Google News RSS 프록시 (API 키 불필요, CORS 우회용)
css/style.css                    최소 기능 스타일 (디자인 작업은 추후 별도 예정)
js/data.js                       종목 사전 (자동완성/시장 판별) + 브리핑 지표 정의
js/calc.js                       물타기 계산식(F05) + 숫자 포맷
js/store.js                      로컬 저장소 (Holding 등 6.1 데이터 모델)
js/quotes.js                     시세 서비스 레이어 (데모 엔진 + 실시세: 네이버/Alpha Vantage/Google News)
js/chart.js                      당일 분봉 canvas 차트
js/app.js                        화면 전환·이벤트·렌더링
```
