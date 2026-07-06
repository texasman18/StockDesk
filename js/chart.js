/* F06 당일 분봉 라인 차트 (canvas, 전일 종가 기준선 포함) — 외부 라이브러리 없음 */

function drawIntradayChart(canvas, data, currency) {
  var dpr = window.devicePixelRatio || 1;
  var cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
  var cssH = 220;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  var series = data.series;
  if (!series || series.length < 2) return;

  var padL = 8, padR = 56, padT = 12, padB = 22;
  var w = cssW - padL - padR, h = cssH - padT - padB;

  var prices = series.map(function (p) { return p.price; });
  var min = Math.min.apply(null, prices.concat([data.prevClose]));
  var max = Math.max.apply(null, prices.concat([data.prevClose]));
  var span = (max - min) || 1;
  min -= span * 0.08; max += span * 0.08; span = max - min;

  function x(i) { return padL + (i / (series.length - 1)) * w; }
  function y(p) { return padT + (1 - (p - min) / span) * h; }

  var css = getComputedStyle(document.documentElement);
  var gainColor = (css.getPropertyValue('--gain') || '#d32f2f').trim();
  var lossColor = (css.getPropertyValue('--loss') || '#1565c0').trim();
  var lineColor = (css.getPropertyValue('--line') || '#e3e6ea').trim();
  var mutedColor = (css.getPropertyValue('--muted') || '#6b7280').trim();

  var last = series[series.length - 1].price;
  var mainColor = last >= data.prevClose ? gainColor : lossColor;

  // 가격 그리드 3줄 + 우측 라벨
  ctx.font = '10px -apple-system, sans-serif';
  ctx.fillStyle = mutedColor;
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1;
  for (var g = 0; g <= 2; g++) {
    var gp = min + span * (g / 2);
    var gy = y(gp);
    ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + w, gy); ctx.stroke();
    ctx.fillText(currency === 'USD' ? gp.toFixed(2) : Math.round(gp).toLocaleString('ko-KR'), padL + w + 6, gy + 3);
  }

  // 전일 종가 기준선 (점선)
  var pcY = y(data.prevClose);
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = mutedColor;
  ctx.beginPath(); ctx.moveTo(padL, pcY); ctx.lineTo(padL + w, pcY); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = mutedColor;
  ctx.fillText('전일종가', padL + 2, pcY - 4);

  // 기준선 대비 영역 채우기
  ctx.beginPath();
  ctx.moveTo(x(0), pcY);
  series.forEach(function (p, i) { ctx.lineTo(x(i), y(p.price)); });
  ctx.lineTo(x(series.length - 1), pcY);
  ctx.closePath();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = mainColor;
  ctx.fill();
  ctx.globalAlpha = 1;

  // 가격 라인
  ctx.beginPath();
  series.forEach(function (p, i) { i === 0 ? ctx.moveTo(x(i), y(p.price)) : ctx.lineTo(x(i), y(p.price)); });
  ctx.strokeStyle = mainColor;
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // 현재가 점 + 라벨
  var lx = x(series.length - 1), ly = y(last);
  ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2); ctx.fillStyle = mainColor; ctx.fill();
  ctx.fillStyle = mainColor;
  ctx.font = 'bold 10px -apple-system, sans-serif';
  ctx.fillText(currency === 'USD' ? last.toFixed(2) : Math.round(last).toLocaleString('ko-KR'), Math.min(lx + 6, padL + w + 4), ly + 3);

  // 시간축 라벨 (시작/중간/끝)
  ctx.fillStyle = mutedColor;
  ctx.font = '10px -apple-system, sans-serif';
  var idxs = [0, Math.floor((series.length - 1) / 2), series.length - 1];
  idxs.forEach(function (i, k) {
    var tx = x(i);
    if (k === 2) tx -= 28;
    else if (k === 1) tx -= 14;
    ctx.fillText(series[i].time, tx, cssH - 6);
  });
}
