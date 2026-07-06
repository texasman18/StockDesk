/* F03 시세 서비스 레이어
   ─ 기획서 7장: 실시세/뉴스/환율 API는 계약·비용 확정 전 [확인 필요] 상태.
   ─ 따라서 기본은 '데모 시세 프로바이더'(결정적 시뮬레이션)이며,
     실서비스 연동 시 아래 fetchRealQuote / fetchRealNews / fetchRealBriefing 만 구현하면 된다.
   후보: 국내(한국투자증권 오픈API, 키움 OpenAPI+, KRX), 해외(Polygon.io, Alpha Vantage, Finnhub),
         환율(한국수출입은행 API), 뉴스(네이버/다음 금융, Benzinga, Finnhub) */

var Quotes = (function () {

  /* ---------- 시드 기반 난수 (같은 날 같은 종목 → 일관된 데모 시세) ---------- */
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dateKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  /* ---------- 장 운영시간 (국내 09:00~15:30 KST / 미국 정규장 22:30~05:00 KST, 프리마켓 제외) ---------- */
  function sessionProgress(market, ticker) {
    var now = new Date();
    var mins = now.getHours() * 60 + now.getMinutes();
    var isKR = market === 'KR' || (market === 'ETF' && isKoreanTicker(ticker));
    if (isKR) {
      var open = 9 * 60, close = 15 * 60 + 30;
      if (mins < open) return { p: 0, closed: true, label: '개장 전' };
      if (mins >= close) return { p: 1, closed: true, label: '장 마감' };
      return { p: (mins - open) / (close - open), closed: false, label: '장중' };
    }
    // 미국 정규장(서머타임 기준) 22:30 ~ 익일 05:00 KST
    var uOpen = 22 * 60 + 30, uClose = 5 * 60;
    if (mins >= uOpen) return { p: (mins - uOpen) / (24 * 60 - uOpen + uClose), closed: false, label: '장중' };
    if (mins < uClose) return { p: (24 * 60 - uOpen + mins) / (24 * 60 - uOpen + uClose), closed: false, label: '장중' };
    return { p: 1, closed: true, label: '장 마감' };
  }

  /* ---------- 데모 시세 생성 ---------- */
  function basePriceOf(holding) {
    var sym = findSymbol(holding.ticker);
    if (sym) return sym.base;
    // 사전에 없는 종목: 평단가 기준 ±20% 범위의 결정적 기준가
    var r = mulberry32(hashStr(holding.ticker))();
    return holding.avgPrice * (0.8 + r * 0.4);
  }

  function demoQuote(holding) {
    var seedDay = hashStr(holding.ticker + '|' + dateKey());
    var rDay = mulberry32(seedDay);
    var base = basePriceOf(holding);
    var prevClose = base * (1 + (rDay() - 0.5) * 0.06);            // 전일 종가: 기준가 ±3%
    var dayMove = (rDay() - 0.5) * 0.08;                            // 당일 방향성 최대 ±4%
    var sess = sessionProgress(holding.market, holding.ticker);
    // 새로고침마다 미세 변동(분 단위 틱)
    var tick = mulberry32(seedDay ^ Math.floor(Date.now() / 60000))();
    var jitter = (tick - 0.5) * 0.006;
    var cur = prevClose * (1 + dayMove * Math.max(sess.p, 0.15) + jitter);
    cur = roundTick(cur, holding.currency);
    prevClose = roundTick(prevClose, holding.currency);
    return {
      currentPrice: cur,
      prevClose: prevClose,
      changeRate: (cur - prevClose) / prevClose * 100,
      timestamp: Date.now(),
      delayed: true // 비기능 요구사항: 지연 데이터 표시
    };
  }

  function roundTick(p, currency) {
    if (currency === 'USD') return Math.round(p * 100) / 100;
    if (p >= 500000) return Math.round(p / 1000) * 1000;
    if (p >= 100000) return Math.round(p / 100) * 100;
    if (p >= 10000) return Math.round(p / 50) * 50;
    return Math.round(p / 10) * 10;
  }

  /* ---------- 당일 분봉 차트 데이터 (F06: 5분봉, 전일 종가 기준선) ---------- */
  function demoIntraday(holding) {
    var snap = Store.getSnapshot(holding.ticker) || demoQuote(holding);
    var sess = sessionProgress(holding.market, holding.ticker);
    var isKR = holding.market === 'KR' || (holding.market === 'ETF' && isKoreanTicker(holding.ticker));
    var totalMin = 390; // KR/US 정규장 6.5h
    var stepMin = 5;
    var preOpen = sess.closed && sess.p === 0; // 개장 전: 전일 전체 차트 고정 표시
    var progress = preOpen ? 1 : Math.min(sess.p, 1);
    var steps = Math.max(2, Math.floor((totalMin / stepMin) * progress));
    var rnd = mulberry32(hashStr(holding.ticker + '|chart|' + dateKey()));
    var series = [];
    var start = snap.prevClose * (1 + (rnd() - 0.5) * 0.01);
    var end = snap.currentPrice;
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      // 시작가→현재가 경로 + 랜덤워크 노이즈
      var noise = (rnd() - 0.5) * snap.prevClose * 0.012 * Math.sin(t * Math.PI);
      var price = start + (end - start) * t + noise;
      var minutes = (isKR ? 9 * 60 : 22 * 60 + 30) + i * stepMin;
      var hh = Math.floor(minutes / 60) % 24, mm = minutes % 60;
      series.push({ time: (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm, price: price });
    }
    series[series.length - 1].price = end;
    return { series: series, prevClose: snap.prevClose, closed: sess.closed, preOpen: preOpen, sessionLabel: sess.label, isKR: isKR };
  }

  /* ---------- 종목 뉴스 (F06: 최신 3건) — 실API 연동 전 샘플 + 원문 링크 ---------- */
  function newsLinkFor(holding) {
    if (isKoreanTicker(holding.ticker)) {
      return 'https://m.stock.naver.com/domestic/stock/' + holding.ticker + '/news';
    }
    return 'https://finance.yahoo.com/quote/' + encodeURIComponent(holding.ticker) + '/news';
  }

  function demoNews(holding) {
    var templates = [
      { h: '{name}, 2분기 실적 발표 앞두고 목표주가 상향 조정 잇따라', s: '샘플뉴스' },
      { h: '{name} 관련 업황 지표 개선… 외국인 순매수 지속', s: '샘플뉴스' },
      { h: '[공시] {name}, 주요 사업 부문 신규 계약 체결 공시', s: '샘플공시' }
    ];
    var now = Date.now();
    return templates.map(function (t, i) {
      return {
        ticker: holding.ticker,
        headline: '[샘플] ' + t.h.replace('{name}', holding.name),
        source: t.s + ' (뉴스 API 연동 필요)',
        publishedAt: now - (i + 1) * 47 * 60000,
        url: newsLinkFor(holding)
      };
    });
  }

  /* ---------- 모닝 브리핑 데이터 (F07) ---------- */
  function demoBriefing() {
    var rnd = mulberry32(hashStr('briefing|' + dateKey()));
    function build(defs) {
      return defs.map(function (d) {
        var chg = (rnd() - 0.48) * 2.4; // -1.2% ~ +1.4% 부근
        var val = d.base * (1 + chg / 100);
        return { key: d.key, name: d.name, value: val, changePct: chg, digits: d.digits };
      });
    }
    return {
      date: dateKey(),
      indices: build(BRIEFING_CORE),
      more: build(BRIEFING_MORE),
      lastRefreshedAt: Date.now()
    };
  }

  /* ---------- 실서비스 연동 지점 (API 확정 후 구현) ---------- */
  function fetchRealQuote(holding) {
    // TODO: 한국투자증권/키움/Polygon 등 확정된 API 호출로 교체
    return Promise.reject(new Error('시세 API 미연동'));
  }
  function fetchRealNews(holding) {
    return Promise.reject(new Error('뉴스 API 미연동'));
  }
  function fetchRealBriefing() {
    return Promise.reject(new Error('시황 API 미연동'));
  }

  /* ---------- 전체 새로고침 (F08): 시세 + 환율 + 브리핑 재수집 ----------
     실패 시 마지막 성공 데이터 유지 (비기능 '가용성') */
  function refreshAll() {
    var demo = Store.state.settings.demoMode;
    return new Promise(function (resolve, reject) {
      setTimeout(function () { // 네트워크 지연 시뮬레이션
        if (!demo) {
          reject(new Error('시세 API가 아직 연동되지 않았습니다. 마지막 데이터를 유지합니다. (설정에서 데모 모드를 켜면 시뮬레이션 시세를 사용합니다)'));
          return;
        }
        Store.state.holdings.forEach(function (h) {
          Store.setSnapshot(h.ticker, demoQuote(h));
        });
        // 환율도 브리핑 지표에서 동기화 (F10)
        var briefing = demoBriefing();
        var fx = briefing.indices.filter(function (x) { return x.key === 'USDKRW'; })[0];
        if (fx) Store.state.settings.fxRate = Math.round(fx.value * 10) / 10;
        Store.state.briefing = briefing;
        Store.state.lastRefreshedAt = Date.now();
        Store.save();
        resolve();
      }, 350);
    });
  }

  /* 08:00 자동 갱신 체크 (F07): 마지막 갱신이 오늘 08:00 이전이고 현재 08:00 경과 시 자동 갱신 */
  function needsMorningRefresh() {
    var now = new Date();
    var eight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 0).getTime();
    if (now.getTime() < eight) return false;
    return !Store.state.lastRefreshedAt || Store.state.lastRefreshedAt < eight;
  }

  return {
    refreshAll: refreshAll,
    needsMorningRefresh: needsMorningRefresh,
    getIntraday: demoIntraday,
    getNews: demoNews,
    newsLinkFor: newsLinkFor,
    sessionProgress: sessionProgress
  };
})();
