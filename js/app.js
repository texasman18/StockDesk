/* StockDesk 메인 앱 — 화면 전환, 이벤트, 렌더링 */
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var currentScreen = 'dashboard';
  var currentMarket = 'ALL';       // F09 시장 탭
  var detailHoldingId = null;      // S03에서 보고 있는 종목
  var editHoldingId = null;        // S01 수정 모드
  var calcHoldingId = null;        // S04 대상 종목
  var calcMode = 'price';          // 'price' | 'rate'
  var refreshTimer = null;
  var detailNewsSeq = 0;           // 종목 상세 뉴스 비동기 응답의 최신성 체크용

  /* ================= 공통 유틸 ================= */

  function toKRW(amount, currency) {
    return currency === 'USD' ? amount * Store.state.settings.fxRate : amount;
  }

  function priceOf(h) {
    var snap = Store.getSnapshot(h.ticker);
    return snap ? snap.currentPrice : h.avgPrice; // 시세 없으면 평단가로 표시(손익 0)
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  function showScreen(name) {
    currentScreen = name;
    $$('.screen').forEach(function (s) { s.hidden = true; });
    $('#screen-' + name).hidden = false;
    $$('.tabbar-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.screen === name);
    });
    var titles = { dashboard: 'StockDesk', detail: '종목 상세', briefing: '모닝 브리핑', settings: '설정' };
    $('#header-title').textContent = titles[name] || 'StockDesk';
    // 종목 추가(+)는 홈에서만 노출
    $('#btn-add').style.visibility = (name === 'dashboard') ? 'visible' : 'hidden';
    window.scrollTo(0, 0);
  }

  function renderLastRefreshed() {
    var ts = Store.state.lastRefreshedAt;
    $('#last-refreshed').textContent = ts ? '갱신 ' + fmtTime(ts) : '';
  }

  /* ================= F08 전체 새로고침 ================= */

  function refreshAll(silent) {
    var btn = $('#btn-refresh');
    btn.classList.add('spinning');
    return Quotes.refreshAll().then(function (result) {
      btn.classList.remove('spinning');
      renderAll();
      var warnings = (result && result.warnings) || [];
      if (warnings.length) {
        toast(warnings[0] + (warnings.length > 1 ? ' 외 ' + (warnings.length - 1) + '건' : ''));
      } else if (!silent) {
        toast('시세·환율·브리핑을 갱신했습니다.');
      }
    }).catch(function (err) {
      btn.classList.remove('spinning');
      renderAll(); // 마지막 성공 데이터 유지 (가용성)
      toast(err.message || '갱신 실패 — 마지막 데이터를 유지합니다.');
    });
  }

  /* ================= S02 대시보드 (F04/F09) ================= */

  function filteredHoldings() {
    if (currentMarket === 'ALL') return Store.state.holdings;
    return Store.state.holdings.filter(function (h) { return h.market === currentMarket; });
  }

  function renderDashboard() {
    var list = filteredHoldings();
    var totalCost = 0, totalEval = 0;
    Store.state.holdings.forEach(function (h) { // 요약은 항상 전체 기준 (원화 환산 합산 — F10)
      var price = priceOf(h);
      totalCost += toKRW(h.quantity * h.avgPrice, h.currency);
      totalEval += toKRW(h.quantity * price, h.currency);
    });
    var totalPL = totalEval - totalCost;
    var totalRate = totalCost > 0 ? totalPL / totalCost * 100 : 0;

    $('#sum-cost').textContent = fmtNum(Math.round(totalCost)) + '원';
    $('#sum-eval').textContent = fmtNum(Math.round(totalEval)) + '원';
    var plEl = $('#sum-pl'), rateEl = $('#sum-rate');
    plEl.textContent = fmtSigned(totalPL, 'KRW');
    plEl.className = 'summary-value num ' + plClass(totalPL);
    rateEl.textContent = fmtRate(totalRate);
    rateEl.className = 'summary-value num ' + plClass(totalPL);

    var wrap = $('#holding-list');
    wrap.innerHTML = '';
    $('#empty-state').hidden = list.length > 0;

    var marketNames = { KR: '한국장', US: '미국장', ETF: 'ETF' };
    list.forEach(function (h) {
      var price = priceOf(h);
      var r = Calc.holdingPL(h, price);
      var snap = Store.getSnapshot(h.ticker);
      var card = document.createElement('div');
      card.className = 'holding-card num';
      card.innerHTML =
        '<div class="hc-top">' +
          '<span class="hc-name">' + escapeHtml(h.name) + '<span class="hc-market">' + marketNames[h.market] + ' · ' + escapeHtml(h.ticker) + '</span></span>' +
          '<span class="hc-price ' + (snap ? plClass(snap.changeRate) : '') + '">' + fmtMoney(price, h.currency) + '</span>' +
        '</div>' +
        '<div class="hc-bottom">' +
          '<span class="hc-sub">' + fmtNum(h.quantity, h.quantity % 1 ? 4 : 0) + '주 · 평단 ' + fmtMoney(h.avgPrice, h.currency) + '</span>' +
          '<span class="hc-pl ' + plClass(r.pl) + '">' + fmtSigned(r.pl, h.currency) + ' (' + fmtRate(r.ratePct) + ')' +
            (h.currency === 'USD' ? '<br><span class="muted">' + fmtSigned(toKRW(r.pl, 'USD'), 'KRW') + ' 환산</span>' : '') +
          '</span>' +
        '</div>';

      // 3.3 물타기 분기: 손실 종목만 활성화
      var calcBtn = document.createElement('button');
      calcBtn.className = 'hc-calc-btn';
      calcBtn.textContent = '물타기 계산';
      if (r.pl < 0) {
        calcBtn.addEventListener('click', function (e) { e.stopPropagation(); openCalc(h.id); });
      } else {
        // 비활성(그레이아웃) + 탭 시 '현재 수익 구간입니다' 안내만 노출 (3.3)
        calcBtn.classList.add('is-disabled');
        calcBtn.setAttribute('aria-disabled', 'true');
        calcBtn.addEventListener('click', function (e) { e.stopPropagation(); toast('현재 수익 구간입니다'); });
      }
      card.appendChild(calcBtn);

      card.addEventListener('click', function (e) {
        if (e.target === calcBtn) return;
        openDetail(h.id);
      });
      attachLongPress(card, function () { openActionSheet(h.id); });
      wrap.appendChild(card);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 뉴스 항목 렌더링 — url이 있으면 링크, 없으면(데모 시장뉴스 등) 일반 블록 */
  function renderNewsItem(n) {
    var el = document.createElement(n.url ? 'a' : 'div');
    el.className = 'news-item';
    if (n.url) { el.href = n.url; el.target = '_blank'; el.rel = 'noopener'; }
    el.innerHTML = '<div class="news-headline">' + escapeHtml(n.headline) + '</div>' +
      '<div class="news-meta">' + escapeHtml(n.source) + (n.publishedAt ? ' · ' + fmtTime(n.publishedAt) : '') + '</div>';
    return el;
  }

  /* 롱프레스 → 수정/삭제 액션시트 (F01) */
  function attachLongPress(el, cb) {
    var timer = null, moved = false;
    el.addEventListener('touchstart', function () {
      moved = false;
      timer = setTimeout(function () { if (!moved) cb(); }, 550);
    }, { passive: true });
    el.addEventListener('touchmove', function () { moved = true; clearTimeout(timer); }, { passive: true });
    el.addEventListener('touchend', function () { clearTimeout(timer); });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); cb(); }); // 데스크톱 대응
  }

  var sheetHoldingId = null;
  function openActionSheet(id) {
    var h = Store.getHoldingById(id);
    if (!h) return;
    sheetHoldingId = id;
    $('#sheet-title').textContent = h.name + ' (' + h.ticker + ')';
    $('#action-sheet').hidden = false;
  }

  function confirmDelete(id) {
    var h = Store.getHoldingById(id);
    if (!h) return;
    // 삭제 확인 다이얼로그 필수 (F01)
    if (confirm(h.name + ' 종목을 삭제하시겠습니까?')) {
      Store.deleteHolding(id);
      if (detailHoldingId === id) showScreen('dashboard');
      renderAll();
      toast('삭제되었습니다.');
    }
  }

  /* ================= S01 종목 추가/수정 모달 (F01/F02) ================= */

  var formMarket = 'KR';

  function openHoldingModal(editId) {
    editHoldingId = editId || null;
    var modal = $('#modal-holding');
    $('#holding-modal-title').textContent = editId ? '종목 수정' : '종목 추가';
    $('#dup-notice').hidden = true;
    $('#ticker-suggest').hidden = true;
    var form = $('#holding-form');
    form.reset();
    if (editId) {
      var h = Store.getHoldingById(editId);
      setFormMarket(h.market);
      $('#form-ticker').value = h.ticker;
      $('#form-ticker').disabled = true;
      $('#form-name').value = h.name;
      $('#form-quantity').value = h.quantity;
      $('#form-avg').value = h.avgPrice;
    } else {
      setFormMarket('KR');
      $('#form-ticker').disabled = false;
    }
    updateCurrencyLabel();
    modal.hidden = false;
  }

  function setFormMarket(m) {
    formMarket = m;
    $$('#form-market .seg-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.value === m);
    });
    updateCurrencyLabel();
  }

  function updateCurrencyLabel() {
    var cur = detectCurrency(formMarket, $('#form-ticker').value || '');
    $('#form-currency-label').textContent = '(' + cur + ')';
  }

  function onTickerInput() {
    var input = $('#form-ticker');
    var q = input.value;
    // 시장 자동 판별 (3.1)
    var detected = detectMarket(q);
    if (detected && !editHoldingId) setFormMarket(detected);
    updateCurrencyLabel();
    checkDuplicate();

    var box = $('#ticker-suggest');
    var results = searchSymbols(q, null);
    if (!q.trim() || !results.length) { box.hidden = true; return; }
    box.innerHTML = '';
    var marketNames = { KR: '한국장', US: '미국장', ETF: 'ETF' };
    results.forEach(function (s) {
      var item = document.createElement('div');
      item.className = 'suggest-item';
      item.innerHTML = '<span>' + escapeHtml(s.name) + '</span><span class="suggest-ticker">' + s.ticker + ' · ' + marketNames[s.market] + '</span>';
      item.addEventListener('click', function () {
        input.value = s.ticker;
        $('#form-name').value = s.name;
        setFormMarket(s.market);
        updateCurrencyLabel();
        checkDuplicate();
        box.hidden = true;
      });
      box.appendChild(item);
    });
    box.hidden = false;
  }

  function checkDuplicate() {
    if (editHoldingId) { $('#dup-notice').hidden = true; return; }
    var existing = Store.findHolding($('#form-ticker').value || '');
    $('#dup-notice').hidden = !existing;
  }

  function submitHoldingForm(e) {
    e.preventDefault();
    var ticker = $('#form-ticker').value.trim().toUpperCase();
    var name = $('#form-name').value.trim();
    var qty = parseFloat($('#form-quantity').value);
    var avg = parseFloat($('#form-avg').value);
    if (!ticker || !name || !(qty > 0) || !(avg > 0)) { toast('입력값을 확인하세요.'); return; }

    if (editHoldingId) {
      Store.updateHolding(editHoldingId, { name: name, quantity: qty, avgPrice: avg, market: formMarket, currency: detectCurrency(formMarket, ticker) });
      toast('수정되었습니다.');
    } else {
      var existing = Store.findHolding(ticker);
      if (existing) {
        var mode = (document.querySelector('input[name="dup-mode"]:checked') || {}).value || 'merge';
        if (mode === 'merge') {
          Store.mergeHolding(existing, qty, avg); // 평단가 자동 재계산 (추가매수 반영)
          toast('추가매수 반영 — 새 평단가 ' + fmtMoney(existing.avgPrice, existing.currency));
        } else {
          Store.updateHolding(existing.id, { quantity: qty, avgPrice: avg, name: name });
          toast('입력값으로 덮어썼습니다.');
        }
      } else {
        Store.addHolding({ market: formMarket, ticker: ticker, name: name, quantity: qty, avgPrice: avg, currency: detectCurrency(formMarket, ticker) });
        toast('종목이 추가되었습니다.');
      }
    }
    closeModals();
    refreshAll(true); // 저장 → 시세 수집 → 대시보드 자동 생성 (3.1)
    if (detailHoldingId) renderDetail();
  }

  /* ================= S03 종목 상세 (F06) ================= */

  function openDetail(id) {
    detailHoldingId = id;
    showScreen('detail');
    renderDetail();
  }

  function renderDetail() {
    var h = Store.getHoldingById(detailHoldingId);
    if (!h) { showScreen('dashboard'); return; }
    var snap = Store.getSnapshot(h.ticker);
    var price = priceOf(h);
    var r = Calc.holdingPL(h, price);
    var marketNames = { KR: '한국장', US: '미국장', ETF: 'ETF' };

    $('#detail-head').innerHTML =
      '<div class="detail-head-card num">' +
        '<div class="dh-name">' + escapeHtml(h.name) + ' <span class="hc-market">' + marketNames[h.market] + ' · ' + escapeHtml(h.ticker) + '</span></div>' +
        '<div class="dh-price-row">' +
          '<span class="dh-price ' + (snap ? plClass(snap.changeRate) : '') + '">' + fmtMoney(price, h.currency) + '</span>' +
          '<span class="dh-change ' + (snap ? plClass(snap.changeRate) : '') + '">' + (snap ? fmtRate(snap.changeRate) + ' (전일대비)' : '시세 없음') + '</span>' +
        '</div>' +
        '<div class="dh-grid">' +
          '<div><div class="lbl">보유수량</div><div class="val">' + fmtNum(h.quantity, h.quantity % 1 ? 4 : 0) + '주</div></div>' +
          '<div><div class="lbl">평단가</div><div class="val">' + fmtMoney(h.avgPrice, h.currency) + '</div></div>' +
          '<div><div class="lbl">평가손익</div><div class="val ' + plClass(r.pl) + '">' + fmtSigned(r.pl, h.currency) + '<br>' + fmtRate(r.ratePct) + '</div></div>' +
        '</div>' +
        (snap ? '<div class="hc-sub" style="margin-top:8px">시세 기준: ' + fmtTime(snap.timestamp) + (snap.delayed ? ' (지연/데모 시세)' : '') + '</div>' : '') +
      '</div>';

    // 당일 차트
    var chartData = Quotes.getIntraday(h);
    $('#chart-title').textContent = chartData.preOpen ? '전일 차트 (5분봉)' : '당일 차트 (5분봉)';
    $('#chart-note').textContent = chartData.preOpen
      ? '개장 전 — 개장 후 당일 차트로 전환됩니다'
      : (chartData.closed
        ? '장 마감 — 다음 거래일 개장 전까지 갱신되지 않습니다'
        : (chartData.isKR ? '장중 09:00~15:30' : '미국 정규장 (프리마켓 제외)'));
    drawIntradayChart($('#detail-chart'), chartData, h.currency);

    // 관련 뉴스 3건 (실시간 모드에서는 Google News 비동기 조회)
    var newsWrap = $('#detail-news');
    newsWrap.innerHTML = '<div class="news-empty">뉴스 불러오는 중...</div>';
    var newsReqId = ++detailNewsSeq;
    Quotes.getNews(h).then(function (newsList) {
      if (newsReqId !== detailNewsSeq) return; // 그 사이 다른 종목으로 이동했으면 무시
      newsWrap.innerHTML = '';
      newsList.forEach(function (n) { newsWrap.appendChild(renderNewsItem(n)); });
    });

    // 하단 물타기 버튼 분기 (3.3): 수익 구간이면 그레이아웃, 탭 시 안내만
    var calcBtn = $('#btn-detail-calc');
    calcBtn.classList.toggle('is-disabled', r.pl >= 0);
    calcBtn.setAttribute('aria-disabled', r.pl >= 0 ? 'true' : 'false');
  }

  /* ================= S04 물타기 계산기 (F05) ================= */

  function openCalc(id) {
    var h = Store.getHoldingById(id);
    if (!h) return;
    var price = priceOf(h);
    var r = Calc.holdingPL(h, price);
    if (r.pl >= 0) { toast('현재 수익 구간입니다'); return; }

    calcHoldingId = id;
    calcMode = 'price';
    $$('#calc-mode .seg-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.value === 'price'); });

    // 현재가·평단가·보유수량 자동 채움 (3.3)
    $('#calc-stock-info').innerHTML =
      '<div><span>종목</span><b>' + escapeHtml(h.name) + '</b></div>' +
      '<div><span>보유수량</span><b>' + fmtNum(h.quantity, h.quantity % 1 ? 4 : 0) + '주</b></div>' +
      '<div><span>기존 평단가</span><b>' + fmtMoney(h.avgPrice, h.currency) + '</b></div>' +
      '<div><span>현재가</span><b>' + fmtMoney(price, h.currency) + '</b></div>' +
      '<div><span>현재 손익률</span><b class="loss">' + fmtRate(r.ratePct) + '</b></div>';

    setupCalcInputs(h, price);
    $('#modal-calc').hidden = false;
    runCalc();
  }

  function setupCalcInputs(h, price) {
    var input = $('#calc-input');
    var slider = $('#calc-slider');
    if (calcMode === 'price') {
      $('#calc-input-label').textContent = '목표 평단가 (' + h.currency + ')';
      // 유효 범위: 현재가 초과 ~ 기존 평단가 미만
      var lo = price, hi = h.avgPrice;
      slider.min = lo; slider.max = hi;
      slider.step = h.currency === 'USD' ? 0.01 : 1;
      var mid = (lo + hi) / 2;
      slider.value = mid;
      input.value = h.currency === 'USD' ? mid.toFixed(2) : Math.round(mid);
      input.step = slider.step;
    } else {
      $('#calc-input-label').textContent = '목표 손익률 (%)';
      var curRate = (price - h.avgPrice) / h.avgPrice * 100; // 음수
      slider.min = Math.ceil(curRate * 10) / 10 + 0.1;
      slider.max = -0.1;
      slider.step = 0.1;
      var midR = curRate / 2;
      slider.value = midR;
      input.value = midR.toFixed(1);
      input.step = 0.1;
    }
  }

  function runCalc() {
    var h = Store.getHoldingById(calcHoldingId);
    if (!h) return;
    var price = priceOf(h);
    var raw = parseFloat($('#calc-input').value);
    var errEl = $('#calc-error');
    var resEl = $('#calc-result');

    var targetAvg;
    if (calcMode === 'price') {
      targetAvg = raw;
    } else {
      if (isNaN(raw) || raw >= 0) {
        errEl.textContent = '목표 손익률은 0보다 작은 값(예: -5)을 입력하세요.';
        errEl.hidden = false; resEl.hidden = true; return;
      }
      targetAvg = Calc.targetAvgFromRate(price, raw); // 목표평단가 = 현재가 ÷ (1+목표손익률)
    }

    var sim = Calc.simulate(h.quantity, h.avgPrice, price, targetAvg);
    if (!sim.ok) {
      errEl.textContent = sim.error;
      errEl.hidden = false;
      resEl.hidden = true;
      return;
    }
    errEl.hidden = true;
    resEl.hidden = false;
    var qtyDigits = sim.addQty % 1 ? 2 : 0;
    $('#calc-add-qty').textContent = fmtNum(sim.addQty, qtyDigits) + '주';
    $('#calc-add-amount').textContent = fmtMoney(sim.addAmount, h.currency) + (h.currency === 'USD' ? ' (약 ' + fmtNum(Math.round(toKRW(sim.addAmount, 'USD'))) + '원)' : '');
    $('#calc-total-cost').textContent = fmtMoney(sim.totalCost, h.currency);
    $('#calc-new-avg').textContent = fmtMoney(sim.newAvg, h.currency);
    var nr = $('#calc-new-rate');
    nr.textContent = fmtRate(sim.newRatePct);
    nr.className = plClass(sim.newRatePct);

    Store.addCalcLog({ ticker: h.ticker, targetPrice: targetAvg, resultQuantity: sim.addQty, resultAmount: sim.addAmount });
  }

  /* ================= S05 모닝 브리핑 (F07) ================= */

  function renderBriefing() {
    var b = Store.state.briefing;
    $('#briefing-updated').textContent = b ? '마지막 갱신: ' + fmtTime(b.lastRefreshedAt) : '아직 갱신된 브리핑이 없습니다. 새로고침을 눌러주세요.';

    function fillTable(el, rows) {
      el.innerHTML = '';
      (rows || []).forEach(function (ix) {
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td class="idx-name">' + escapeHtml(ix.name) + '</td>' +
          '<td class="idx-value">' + fmtNum(ix.value, ix.digits) + '</td>' +
          '<td class="idx-change ' + plClass(ix.changePct) + '">' + fmtRate(ix.changePct) + '</td>';
        el.appendChild(tr);
      });
    }
    fillTable($('#briefing-indices'), b && b.indices);
    fillTable($('#briefing-indices-more'), b && b.more);

    // 보유종목 관련 뉴스 (전체 시장 뉴스와 분리 — F07). 실시간 모드에서는 Google News 비동기 조회
    var hw = $('#briefing-holding-news');
    if (!Store.state.holdings.length) {
      hw.innerHTML = '<div class="news-empty">보유 종목이 없습니다.</div>';
    } else {
      hw.innerHTML = '<div class="news-empty">뉴스 불러오는 중...</div>';
      var briefingReqId = ++detailNewsSeq;
      Promise.all(Store.state.holdings.slice(0, 5).map(function (h) {
        return Quotes.getNews(h).then(function (list) { return { h: h, n: list[0] }; });
      })).then(function (pairs) {
        if (briefingReqId !== detailNewsSeq) return;
        hw.innerHTML = '';
        pairs.forEach(function (p) {
          if (!p.n) return;
          var n = Object.assign({}, p.n, { source: p.h.name + ' · ' + p.n.source });
          hw.appendChild(renderNewsItem(n));
        });
      });
    }

    // 시장 전체 뉴스 — 실시간 모드에서는 국내 증시 시황 검색, 데모 모드에서는 샘플
    var mw = $('#briefing-market-news');
    mw.innerHTML = '<div class="news-empty">뉴스 불러오는 중...</div>';
    Quotes.getMarketNews().then(function (items) {
      mw.innerHTML = '';
      items.forEach(function (n) { mw.appendChild(renderNewsItem(n)); });
    });
  }

  /* ================= S06 설정 ================= */

  function renderSettings() {
    var s = Store.state.settings;
    $('#set-refresh-interval').value = String(s.autoRefreshMin);
    $('#set-demo-mode').checked = !!s.demoMode;
    $('#set-av-key').value = s.alphaVantageKey || '';
    $('#set-fx-rate').value = s.fxRate;
    $('#set-notify').checked = !!s.notify;
  }

  function applyAutoRefresh() {
    clearInterval(refreshTimer);
    var min = Store.state.settings.autoRefreshMin;
    if (min > 0) {
      refreshTimer = setInterval(function () { refreshAll(true); }, min * 60000);
    }
  }

  function bindSettings() {
    $('#set-refresh-interval').addEventListener('change', function () {
      Store.state.settings.autoRefreshMin = parseInt(this.value, 10);
      Store.save(); applyAutoRefresh();
    });
    $('#set-demo-mode').addEventListener('change', function () {
      Store.state.settings.demoMode = this.checked;
      Store.save();
      toast(this.checked ? '데모 시세 모드 켜짐' : '데모 시세 모드 꺼짐 — 실API 연동 전까지 시세가 갱신되지 않습니다.');
    });
    $('#set-av-key').addEventListener('change', function () {
      Store.state.settings.alphaVantageKey = this.value.trim();
      Store.save();
    });
    $('#set-fx-rate').addEventListener('change', function () {
      var v = parseFloat(this.value);
      if (v > 0) { Store.state.settings.fxRate = v; Store.save(); renderAll(); }
    });
    $('#set-notify').addEventListener('change', function () {
      Store.state.settings.notify = this.checked;
      Store.save();
      if (this.checked) toast('알림은 푸시 인프라(기획서 7장) 확정 후 동작합니다.');
    });

    $('#btn-backup').addEventListener('click', function () {
      var blob = new Blob([Store.exportJSON()], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'stockdesk-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $('#btn-restore').addEventListener('click', function () { $('#restore-file').click(); });
    $('#restore-file').addEventListener('change', function () {
      var file = this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          Store.importJSON(reader.result);
          renderAll(); renderSettings();
          toast('복원되었습니다.');
        } catch (e) {
          toast('복원 실패 — 올바른 백업 파일이 아닙니다.');
        }
      };
      reader.readAsText(file);
      this.value = '';
    });
    $('#btn-reset').addEventListener('click', function () {
      if (confirm('모든 종목·설정 데이터를 삭제하시겠습니까? 되돌릴 수 없습니다.')) Store.resetAll();
    });
  }

  /* ================= 모달 공통 ================= */

  function closeModals() {
    $$('.modal-backdrop').forEach(function (m) { m.hidden = true; });
    $('#form-ticker').disabled = false;
  }

  /* ================= 전체 렌더 ================= */

  function renderAll() {
    renderLastRefreshed();
    renderDashboard();
    if (currentScreen === 'detail') renderDetail();
    renderBriefing();
  }

  /* ================= 이벤트 바인딩 ================= */

  function bindEvents() {
    $('#btn-refresh').addEventListener('click', function () { refreshAll(false); });
    $('#btn-add').addEventListener('click', function () { openHoldingModal(null); });
    $('#btn-empty-add').addEventListener('click', function () { openHoldingModal(null); });

    // 하단 탭바
    $$('.tabbar-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        showScreen(b.dataset.screen);
        if (b.dataset.screen === 'settings') renderSettings();
        if (b.dataset.screen === 'briefing') renderBriefing();
        if (b.dataset.screen === 'dashboard') renderDashboard();
      });
    });

    // F09 시장 탭
    $$('#market-tabs .tab').forEach(function (t) {
      t.addEventListener('click', function () {
        currentMarket = t.dataset.market;
        $$('#market-tabs .tab').forEach(function (x) { x.classList.toggle('active', x === t); });
        renderDashboard();
      });
    });

    // 뒤로가기
    $$('[data-back]').forEach(function (b) {
      b.addEventListener('click', function () { showScreen('dashboard'); renderDashboard(); });
    });

    // 모달 닫기 (배경/취소 버튼)
    $$('[data-close-modal]').forEach(function (b) {
      b.addEventListener('click', closeModals);
    });
    $$('.modal-backdrop').forEach(function (m) {
      m.addEventListener('click', function (e) { if (e.target === m) closeModals(); });
    });

    // S01 폼
    $('#holding-form').addEventListener('submit', submitHoldingForm);
    $('#form-ticker').addEventListener('input', onTickerInput);
    $$('#form-market .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () { setFormMarket(b.dataset.value); });
    });

    // 액션시트
    $('#sheet-edit').addEventListener('click', function () { closeModals(); openHoldingModal(sheetHoldingId); });
    $('#sheet-delete').addEventListener('click', function () { closeModals(); confirmDelete(sheetHoldingId); });

    // S03 버튼
    $('#btn-detail-calc').addEventListener('click', function () { openCalc(detailHoldingId); });
    $('#btn-detail-edit').addEventListener('click', function () { openHoldingModal(detailHoldingId); });
    $('#btn-detail-delete').addEventListener('click', function () { confirmDelete(detailHoldingId); });

    // S04 계산기
    $$('#calc-mode .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        calcMode = b.dataset.value;
        $$('#calc-mode .seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
        var h = Store.getHoldingById(calcHoldingId);
        if (h) { setupCalcInputs(h, priceOf(h)); runCalc(); }
      });
    });
    $('#calc-input').addEventListener('input', function () {
      $('#calc-slider').value = this.value;
      runCalc();
    });
    $('#calc-slider').addEventListener('input', function () {
      var v = parseFloat(this.value);
      $('#calc-input').value = calcMode === 'rate' ? v.toFixed(1) : (v % 1 ? v.toFixed(2) : v);
      runCalc();
    });

    // 브리핑 더보기
    $('#btn-briefing-more').addEventListener('click', function () {
      var more = $('#briefing-indices-more');
      more.hidden = !more.hidden;
      this.textContent = more.hidden ? '더보기' : '접기';
    });

    // 앱 복귀 시 08:00 자동 갱신 체크 (F07 / 3.2)
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && Quotes.needsMorningRefresh()) refreshAll(true);
    });
  }

  bindSettings();

  /* ================= 초기화 (3.1 / 3.2 사용자 흐름) ================= */

  Store.load();
  bindEvents();
  renderSettings();
  applyAutoRefresh();
  showScreen('dashboard');

  if (!Store.state.holdings.length) {
    // 최초 온보딩: 종목 추가 모달 자동 오픈
    renderAll();
    setTimeout(function () { openHoldingModal(null); }, 300);
  } else if (Quotes.needsMorningRefresh()) {
    // 8시 경과 시 자동 새로고침, 이전이면 마지막 데이터 그대로 (3.2)
    renderAll();
    refreshAll(true);
  } else {
    renderAll();
  }
})();
