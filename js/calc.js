/* F05 물타기 계산 로직 + 숫자 포맷 유틸 (기획서 4.1 계산식 그대로 구현) */

var Calc = {
  /* 새 평단가 = (기존수량×기존평단 + 추가수량×현재가) ÷ (기존수량+추가수량) */
  newAvgPrice: function (qty, avg, addQty, cur) {
    return (qty * avg + addQty * cur) / (qty + addQty);
  },

  /* 추가매수수량 = 기존수량 × (기존평단 − 목표평단) ÷ (목표평단 − 현재가) */
  addQtyForTargetAvg: function (qty, avg, target, cur) {
    return qty * (avg - target) / (target - cur);
  },

  /* 목표 손익률 입력 시 목표평단가 역산: 목표평단가 = 현재가 ÷ (1 + 목표손익률)
     ratePct: 손익률(%) 예) -5 → 0.95로 나눔 */
  targetAvgFromRate: function (cur, ratePct) {
    return cur / (1 + ratePct / 100);
  },

  /* 시뮬레이션 실행. 반환: {ok, error} 또는 {ok, addQty, addAmount, totalCost, newAvg, newRatePct}
     예외 처리(기획서): 목표평단가 ≤ 현재가 → 불가능. 목표평단가 ≥ 기존평단가 → 물타기 의미 없음 */
  simulate: function (qty, avg, cur, targetAvg) {
    if (!(targetAvg > 0)) return { ok: false, error: '목표 값을 입력하세요.' };
    if (targetAvg <= cur) return { ok: false, error: '목표 평단가는 현재가보다 높아야 합니다. (현재가 아래로는 평단가를 낮출 수 없습니다)' };
    if (targetAvg >= avg) return { ok: false, error: '목표 평단가는 기존 평단가보다 낮아야 합니다.' };
    var rawQty = Calc.addQtyForTargetAvg(qty, avg, targetAvg, cur);
    var addQty = Math.ceil(rawQty * 10000) / 10000; // 소수 보유 지원, 표시 시 반올림
    var addAmount = addQty * cur;
    var newAvg = Calc.newAvgPrice(qty, avg, addQty, cur);
    var totalCost = qty * avg + addAmount;
    var newRatePct = (cur - newAvg) / newAvg * 100;
    return { ok: true, addQty: addQty, addAmount: addAmount, totalCost: totalCost, newAvg: newAvg, newRatePct: newRatePct };
  },

  /* 종목별 평가손익 */
  holdingPL: function (h, price) {
    var cost = h.quantity * h.avgPrice;
    var evalAmt = h.quantity * price;
    return { cost: cost, evalAmt: evalAmt, pl: evalAmt - cost, ratePct: cost > 0 ? (evalAmt - cost) / cost * 100 : 0 };
  }
};

/* ---------- 숫자 포맷 (3자리 콤마, 통화별 소수 자리) ---------- */
function fmtNum(n, digits) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  return n.toLocaleString('ko-KR', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 });
}
function fmtMoney(n, currency) {
  if (currency === 'USD') return '$' + fmtNum(n, 2);
  return fmtNum(Math.round(n), 0) + '원';
}
/* 손익 표기: ▲▼ 기호 병기 (접근성 — 색맹 사용자 고려) */
function fmtSigned(n, currency) {
  var sym = n > 0 ? '▲' : (n < 0 ? '▼' : '');
  var body = currency === 'USD' ? '$' + fmtNum(Math.abs(n), 2) : fmtNum(Math.abs(Math.round(n)), 0) + '원';
  return sym + body;
}
function fmtRate(pct) {
  var sym = pct > 0 ? '▲' : (pct < 0 ? '▼' : '');
  return sym + Math.abs(pct).toFixed(2) + '%';
}
function plClass(n) { return n > 0 ? 'gain' : (n < 0 ? 'loss' : ''); }
function fmtTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  var p = function (x) { return (x < 10 ? '0' : '') + x; };
  return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
