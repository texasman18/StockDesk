/* F03 시세 서비스 레이어
   ─ 설정 화면의 '데모 시세 모드'를 끄면 실시세를 사용한다:
     국내(KR/국내ETF) → 네이버 금융 모바일 API, Netlify Functions 프록시(netlify/functions/naver-quote.js) 경유
       (비공식/undocumented 엔드포인트라 키는 불필요하지만, 네이버가 구조를 바꾸면 깨질 수 있음 — 1인 개인용 전제.
        더 안정적인 공식 연동이 필요해지면 netlify/functions/kis-quote.js(한국투자증권 오픈API)로 교체 가능)
     해외(US/해외ETF) + 환율(F10) → Alpha Vantage (CORS 지원, 브라우저에서 직접 호출, API 키 필요)
   ─ 모닝 브리핑 지수(코스피 등)와 당일 분봉(F06)은 별도 API 미선정 상태라
     실시간 모드에서도 데모 데이터를 유지한다 (기획서 7장 [확인 필요]). */

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

  /* ---------- 종목 뉴스 (F06: 최신 3건) — 데모 샘플 + 원문 링크 ---------- */
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

  function demoMarketNews() {
    return [
      { headline: '[샘플] 미 증시, 기술주 강세 속 혼조 마감… 나스닥 최고치 경신', source: '샘플뉴스 (뉴스 API 미연동)', publishedAt: null, url: null },
      { headline: '[샘플] 한은 기준금리 동결 전망 우세… 환율 변동성 주시', source: '샘플뉴스 (뉴스 API 미연동)', publishedAt: null, url: null },
      { headline: '[샘플] 반도체 수출 호조 지속, 7월 수출입 동향 발표 예정', source: '샘플뉴스 (뉴스 API 미연동)', publishedAt: null, url: null }
    ];
  }

  /* ---------- 실API: 뉴스 (Google News RSS, Netlify Functions 프록시 — API 키 불필요) ---------- */
  function fetchGoogleNews(query, limit, locale) {
    var qp = 'q=' + encodeURIComponent(query) + '&limit=' + (limit || 3);
    if (locale) qp += '&hl=' + encodeURIComponent(locale.hl) + '&gl=' + encodeURIComponent(locale.gl) + '&ceid=' + encodeURIComponent(locale.ceid);
    return fetch('/.netlify/functions/news?' + qp)
      .then(function (res) {
        if (!res.ok) throw new Error('뉴스 프록시 호출 실패 (' + res.status + ')');
        return res.json();
      })
      .then(function (data) { return data.items || []; });
  }

  /* 종목 관련 뉴스: 데모 모드면 샘플, 실시간 모드면 종목명으로 Google News 검색 (실패/결과없음 시 샘플로 폴백) */
  function getNews(holding) {
    if (Store.state.settings.demoMode) return Promise.resolve(demoNews(holding));
    var locale = isKrMarket(holding) ? { hl: 'ko', gl: 'KR', ceid: 'KR:ko' } : { hl: 'en-US', gl: 'US', ceid: 'US:en' };
    return fetchGoogleNews(holding.name, 3, locale)
      .then(function (items) {
        if (!items.length) return demoNews(holding);
        return items.map(function (it) {
          return { ticker: holding.ticker, headline: it.headline, source: it.source, publishedAt: it.publishedAt || Date.now(), url: it.url };
        });
      })
      .catch(function () { return demoNews(holding); });
  }

  /* 시장 전체 뉴스 (F07 모닝 브리핑): 데모 모드면 샘플, 실시간 모드면 국내 증시 시황 검색 */
  function getMarketNews() {
    if (Store.state.settings.demoMode) return Promise.resolve(demoMarketNews());
    return fetchGoogleNews('코스피 증시 시황', 3, { hl: 'ko', gl: 'KR', ceid: 'KR:ko' })
      .then(function (items) { return items.length ? items : demoMarketNews(); })
      .catch(function () { return demoMarketNews(); });
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

  /* ---------- 실API: 국내 (네이버 금융 모바일 API, 키 불필요 — Netlify Functions 프록시로 CORS만 우회) ---------- */
  function isKrMarket(h) {
    return h.market === 'KR' || (h.market === 'ETF' && isKoreanTicker(h.ticker));
  }

  function fetchNaverQuotes(tickers) {
    return fetch('/.netlify/functions/naver-quote?tickers=' + tickers.join(','))
      .then(function (res) {
        if (!res.ok) throw new Error('프록시 호출 실패 (' + res.status + ') — Netlify 배포 여부를 확인하세요.');
        return res.json();
      })
      .then(function (payload) { return payload.results || []; });
  }

  /* ---------- 실API: 해외 + 환율 (Alpha Vantage) ---------- */
  function fetchAlphaVantageQuote(ticker, apiKey) {
    var url = 'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=' + encodeURIComponent(ticker) + '&apikey=' + encodeURIComponent(apiKey);
    return fetch(url).then(function (res) { return res.json(); }).then(function (data) {
      var q = data['Global Quote'];
      if (!q || !q['05. price']) {
        throw new Error(data['Note'] || data['Information'] || data['Error Message'] || (ticker + ' 시세 없음'));
      }
      var current = parseFloat(q['05. price']);
      var prevClose = parseFloat(q['08. previous close']);
      var changePct = parseFloat((q['10. change percent'] || '').replace('%', ''));
      return {
        currentPrice: current,
        prevClose: prevClose,
        changeRate: isNaN(changePct) ? (prevClose ? (current - prevClose) / prevClose * 100 : 0) : changePct,
        timestamp: Date.now(),
        delayed: false
      };
    });
  }

  function fetchAlphaVantageFx(apiKey) {
    var url = 'https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=USD&to_currency=KRW&apikey=' + encodeURIComponent(apiKey);
    return fetch(url).then(function (res) { return res.json(); }).then(function (data) {
      var r = data['Realtime Currency Exchange Rate'];
      if (!r) throw new Error(data['Note'] || data['Information'] || '환율 조회 실패');
      return parseFloat(r['5. Exchange Rate']);
    });
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---------- 전체 새로고침 (F08): 시세 + 환율 + 브리핑 재수집 ----------
     실패 시 마지막 성공 데이터 유지 (비기능 '가용성').
     데모 모드가 꺼져 있으면 국내는 KIS 프록시(배치 1회), 해외는 Alpha Vantage(순차 호출,
     무료 티어 분당 5회 제한 고려)로 실시세를 가져온다. */
  function refreshAll() {
    return Store.state.settings.demoMode ? refreshAllDemo() : refreshAllReal();
  }

  function refreshAllDemo() {
    return new Promise(function (resolve) {
      setTimeout(function () {
        Store.state.holdings.forEach(function (h) { Store.setSnapshot(h.ticker, demoQuote(h)); });
        var briefing = demoBriefing();
        var fx = briefing.indices.filter(function (x) { return x.key === 'USDKRW'; })[0];
        if (fx) Store.state.settings.fxRate = Math.round(fx.value * 10) / 10;
        Store.state.briefing = briefing;
        Store.state.lastRefreshedAt = Date.now();
        Store.save();
        resolve({ warnings: [] });
      }, 350);
    });
  }

  function refreshAllReal() {
    var warnings = [];
    var holdings = Store.state.holdings;
    var krTickers = holdings.filter(isKrMarket).map(function (h) { return h.ticker; });
    var usHoldings = holdings.filter(function (h) { return !isKrMarket(h); });
    var apiKey = Store.state.settings.alphaVantageKey;

    var krStep = krTickers.length
      ? fetchNaverQuotes(krTickers).then(function (results) {
          results.forEach(function (r) {
            if (r.error) { warnings.push(r.ticker + ': ' + r.error); return; }
            Store.setSnapshot(r.ticker, r);
          });
        }).catch(function (e) { warnings.push('국내주식 시세 조회 실패: ' + e.message); })
      : Promise.resolve();

    var usStep = krStep.then(function () {
      if (!usHoldings.length) return;
      if (!apiKey) { warnings.push('해외주식 시세 조회 불가 — 설정에서 Alpha Vantage API 키를 입력하세요.'); return; }
      var chain = Promise.resolve();
      usHoldings.forEach(function (h, i) {
        chain = chain.then(function () {
          return fetchAlphaVantageQuote(h.ticker, apiKey)
            .then(function (snap) { Store.setSnapshot(h.ticker, snap); })
            .catch(function (e) { warnings.push(h.ticker + ': ' + e.message); })
            .then(function () { return sleep(900); }); // 마지막 종목 이후에도 대기 — 뒤이은 환율 호출이 분당/초당 제한에 걸리지 않도록
        });
      });
      return chain.then(function () {
        return fetchAlphaVantageFx(apiKey)
          .then(function (fx) { if (fx) Store.state.settings.fxRate = Math.round(fx * 10) / 10; })
          .catch(function (e) { warnings.push('환율 조회 실패: ' + e.message); });
      });
    });

    return usStep.then(function () {
      Store.state.briefing = demoBriefing(); // 지수 API 미선정 — 데모 데이터 유지
      Store.state.lastRefreshedAt = Date.now();
      Store.save();
      return { warnings: warnings };
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
    getNews: getNews,
    getMarketNews: getMarketNews,
    newsLinkFor: newsLinkFor,
    sessionProgress: sessionProgress
  };
})();
