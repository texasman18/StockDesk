/* 종목 사전 — F01 종목명 자동완성 + 시장 자동 판별 + 데모 시세 기준가
   실서비스에서는 시세 API의 종목 마스터로 대체 */
var SYMBOL_DB = [
  // ---- 한국장 (KOSPI/KOSDAQ) ----
  { market: 'KR', ticker: '005930', name: '삼성전자', base: 71000 },
  { market: 'KR', ticker: '000660', name: 'SK하이닉스', base: 198000 },
  { market: 'KR', ticker: '373220', name: 'LG에너지솔루션', base: 345000 },
  { market: 'KR', ticker: '207940', name: '삼성바이오로직스', base: 1020000 },
  { market: 'KR', ticker: '005380', name: '현대차', base: 235000 },
  { market: 'KR', ticker: '000270', name: '기아', base: 112000 },
  { market: 'KR', ticker: '035420', name: 'NAVER', base: 192000 },
  { market: 'KR', ticker: '035720', name: '카카오', base: 43500 },
  { market: 'KR', ticker: '051910', name: 'LG화학', base: 302000 },
  { market: 'KR', ticker: '006400', name: '삼성SDI', base: 251000 },
  { market: 'KR', ticker: '105560', name: 'KB금융', base: 92000 },
  { market: 'KR', ticker: '055550', name: '신한지주', base: 58000 },
  { market: 'KR', ticker: '005490', name: 'POSCO홀딩스', base: 268000 },
  { market: 'KR', ticker: '028260', name: '삼성물산', base: 152000 },
  { market: 'KR', ticker: '012450', name: '한화에어로스페이스', base: 780000 },
  { market: 'KR', ticker: '042700', name: '한미반도체', base: 98000 },
  { market: 'KR', ticker: '247540', name: '에코프로비엠', base: 118000 },
  { market: 'KR', ticker: '086520', name: '에코프로', base: 62000 },
  { market: 'KR', ticker: '068270', name: '셀트리온', base: 176000 },
  { market: 'KR', ticker: '323410', name: '카카오뱅크', base: 22500 },

  // ---- 미국장 (NYSE/NASDAQ) ----
  { market: 'US', ticker: 'AAPL', name: 'Apple', base: 228 },
  { market: 'US', ticker: 'MSFT', name: 'Microsoft', base: 462 },
  { market: 'US', ticker: 'NVDA', name: 'NVIDIA', base: 158 },
  { market: 'US', ticker: 'GOOGL', name: 'Alphabet (Google)', base: 182 },
  { market: 'US', ticker: 'AMZN', name: 'Amazon', base: 218 },
  { market: 'US', ticker: 'META', name: 'Meta Platforms', base: 712 },
  { market: 'US', ticker: 'TSLA', name: 'Tesla', base: 302 },
  { market: 'US', ticker: 'AVGO', name: 'Broadcom', base: 268 },
  { market: 'US', ticker: 'AMD', name: 'AMD', base: 136 },
  { market: 'US', ticker: 'NFLX', name: 'Netflix', base: 1280 },
  { market: 'US', ticker: 'PLTR', name: 'Palantir', base: 132 },
  { market: 'US', ticker: 'JPM', name: 'JPMorgan Chase', base: 288 },
  { market: 'US', ticker: 'BRK.B', name: 'Berkshire Hathaway B', base: 486 },
  { market: 'US', ticker: 'LLY', name: 'Eli Lilly', base: 782 },
  { market: 'US', ticker: 'UNH', name: 'UnitedHealth', base: 308 },
  { market: 'US', ticker: 'KO', name: 'Coca-Cola', base: 70 },
  { market: 'US', ticker: 'INTC', name: 'Intel', base: 22 },
  { market: 'US', ticker: 'MU', name: 'Micron', base: 118 },

  // ---- ETF (국내 + 해외) ----
  { market: 'ETF', ticker: '069500', name: 'KODEX 200', base: 42000 },
  { market: 'ETF', ticker: '360750', name: 'TIGER 미국S&P500', base: 21500 },
  { market: 'ETF', ticker: '133690', name: 'TIGER 미국나스닥100', base: 128000 },
  { market: 'ETF', ticker: '381170', name: 'TIGER 미국테크TOP10', base: 22800 },
  { market: 'ETF', ticker: '305720', name: 'KODEX 2차전지산업', base: 9800 },
  { market: 'ETF', ticker: '091160', name: 'KODEX 반도체', base: 44500 },
  { market: 'ETF', ticker: 'SPY', name: 'SPDR S&P 500 ETF', base: 622 },
  { market: 'ETF', ticker: 'QQQ', name: 'Invesco QQQ', base: 552 },
  { market: 'ETF', ticker: 'VOO', name: 'Vanguard S&P 500', base: 572 },
  { market: 'ETF', ticker: 'SCHD', name: 'Schwab US Dividend', base: 27 },
  { market: 'ETF', ticker: 'TQQQ', name: 'ProShares UltraPro QQQ', base: 84 },
  { market: 'ETF', ticker: 'SOXL', name: 'Direxion Semiconductor 3X', base: 26 }
];

/* 국내 ETF 티커 목록 (통화 판별용: ETF 시장이라도 6자리 코드는 KRW) */
function isKoreanTicker(ticker) {
  return /^[0-9]{6}$/.test(ticker);
}

/* 시장 자동 판별 (3.1 온보딩: 티커 입력 → 시장 자동 판별) */
function detectMarket(ticker) {
  var t = ticker.trim().toUpperCase();
  var hit = SYMBOL_DB.filter(function (s) { return s.ticker === t; });
  if (hit.length) return hit[0].market;
  if (isKoreanTicker(t)) return 'KR';
  if (/^[A-Z.\-]{1,6}$/.test(t)) return 'US';
  return null;
}

/* 통화 자동 결정: KR=KRW, US=USD, ETF는 코드 형태로 판별 */
function detectCurrency(market, ticker) {
  if (market === 'KR') return 'KRW';
  if (market === 'US') return 'USD';
  return isKoreanTicker(ticker) ? 'KRW' : 'USD';
}

/* 자동완성 검색 (티커 또는 종목명) */
function searchSymbols(query, market) {
  var q = query.trim().toUpperCase();
  if (!q) return [];
  return SYMBOL_DB.filter(function (s) {
    var okMarket = !market || s.market === market;
    return okMarket && (s.ticker.indexOf(q) === 0 || s.name.toUpperCase().indexOf(q) !== -1);
  }).slice(0, 8);
}

function findSymbol(ticker) {
  var t = ticker.trim().toUpperCase();
  for (var i = 0; i < SYMBOL_DB.length; i++) {
    if (SYMBOL_DB[i].ticker === t) return SYMBOL_DB[i];
  }
  return null;
}

/* 모닝 브리핑 핵심 지표 정의 (F07: 핵심 3~5개 + 더보기) */
var BRIEFING_CORE = [
  { key: 'KOSPI', name: '코스피', base: 3180, digits: 2 },
  { key: 'KOSDAQ', name: '코스닥', base: 812, digits: 2 },
  { key: 'DJI', name: '다우존스', base: 44800, digits: 2 },
  { key: 'IXIC', name: '나스닥', base: 20600, digits: 2 },
  { key: 'USDKRW', name: '원/달러 환율', base: 1375, digits: 1 }
];
var BRIEFING_MORE = [
  { key: 'SPX', name: 'S&P 500', base: 6280, digits: 2 },
  { key: 'WTI', name: 'WTI 유가($)', base: 67.5, digits: 2 },
  { key: 'US10Y', name: '미 10년물 금리(%)', base: 4.35, digits: 3 },
  { key: 'BTC', name: '비트코인($)', base: 108500, digits: 0 }
];
