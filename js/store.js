/* 로컬 저장소 — 실계좌 연동 없음, 데이터는 기기 내에만 저장 (기획서 1.2 / 비기능 '보안') */

var STORAGE_KEY = 'stockdesk.v1';

var Store = {
  state: {
    holdings: [],        // Holding: {id, market, ticker, name, quantity, avgPrice, currency, createdAt}
    snapshots: {},       // PriceSnapshot: ticker → {currentPrice, changeRate, prevClose, timestamp}
    briefing: null,      // MorningBriefing: {date, indices[], more[], lastRefreshedAt}
    calcLogs: [],        // DilutionCalc 계산 이력 (선택 기능)
    settings: {
      autoRefreshMin: 0, // 자동 새로고침 주기(분), 0=사용 안 함
      demoMode: true,    // 실시세 API 연동 전 데모 시세
      fxRate: 1375.0,    // USD/KRW (F10)
      notify: false
    },
    lastRefreshedAt: null
  },

  load: function () {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        // 얕은 병합으로 새 설정 필드 기본값 유지
        Store.state = Object.assign({}, Store.state, saved);
        Store.state.settings = Object.assign({}, { autoRefreshMin: 0, demoMode: true, fxRate: 1375.0, notify: false }, saved.settings || {});
      }
    } catch (e) { /* 손상된 데이터면 초기 상태 유지 */ }
  },

  save: function () {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Store.state)); }
    catch (e) { /* 저장 실패(용량 등) 무시 */ }
  },

  /* ---------- Holding CRUD (F01/F02) ---------- */
  findHolding: function (ticker) {
    var t = ticker.trim().toUpperCase();
    for (var i = 0; i < Store.state.holdings.length; i++) {
      if (Store.state.holdings[i].ticker === t) return Store.state.holdings[i];
    }
    return null;
  },

  getHoldingById: function (id) {
    for (var i = 0; i < Store.state.holdings.length; i++) {
      if (Store.state.holdings[i].id === id) return Store.state.holdings[i];
    }
    return null;
  },

  addHolding: function (h) {
    h.id = 'h' + Date.now() + Math.floor(Math.random() * 1000);
    h.ticker = h.ticker.trim().toUpperCase();
    h.createdAt = new Date().toISOString();
    Store.state.holdings.push(h);
    Store.save();
    return h;
  },

  /* 동일 종목 재입력: 추가매수 합산(평단가 자동 재계산) — F01 */
  mergeHolding: function (existing, addQty, addAvg) {
    var newQty = existing.quantity + addQty;
    existing.avgPrice = (existing.quantity * existing.avgPrice + addQty * addAvg) / newQty;
    existing.quantity = newQty;
    Store.save();
    return existing;
  },

  updateHolding: function (id, fields) {
    var h = Store.getHoldingById(id);
    if (h) { Object.assign(h, fields); Store.save(); }
    return h;
  },

  deleteHolding: function (id) {
    Store.state.holdings = Store.state.holdings.filter(function (h) { return h.id !== id; });
    Store.save();
  },

  /* ---------- 시세 캐시 ---------- */
  setSnapshot: function (ticker, snap) {
    Store.state.snapshots[ticker] = snap;
  },
  getSnapshot: function (ticker) {
    return Store.state.snapshots[ticker] || null;
  },

  /* ---------- 물타기 계산 로그 (DilutionCalc) ---------- */
  addCalcLog: function (log) {
    log.calculatedAt = new Date().toISOString();
    Store.state.calcLogs.push(log);
    if (Store.state.calcLogs.length > 100) Store.state.calcLogs.shift();
    Store.save();
  },

  /* ---------- 백업/복원 (S06) ---------- */
  exportJSON: function () {
    return JSON.stringify(Store.state, null, 2);
  },
  importJSON: function (text) {
    var data = JSON.parse(text); // 유효하지 않으면 throw
    if (!data || !Array.isArray(data.holdings)) throw new Error('invalid backup');
    Store.state = Object.assign({}, Store.state, data);
    Store.save();
  },
  resetAll: function () {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }
};
