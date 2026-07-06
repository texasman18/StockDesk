/* 네이버 금융 모바일 API 프록시 — 국내주식/국내ETF 시세, API 키 불필요.
   네이버 모바일 증권 페이지가 내부적으로 쓰는 비공식(undocumented) 엔드포인트를 사용한다.
   공식 지원 API가 아니므로 네이버가 구조를 바꾸거나 접근을 제한하면 동작하지 않을 수 있다 —
   1인 개인용 앱(기획서 1.2) 목적의 실용적 대안이며, 상업적/대량 트래픽 용도로는 부적합하다.
   더 안정적인 공식 API가 필요해지면 netlify/functions/kis-quote.js(한국투자증권 오픈API)로 교체하면 된다.

   호출: GET /.netlify/functions/naver-quote?tickers=005930,069500 */

function toNumber(s) {
  return parseFloat(String(s).replace(/,/g, ''));
}

async function fetchOne(ticker) {
  const res = await fetch('https://m.stock.naver.com/api/stock/' + encodeURIComponent(ticker) + '/basic', {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; StockDeskBot/1.0)' }
  });
  if (!res.ok) throw new Error('네이버 응답 실패 (' + res.status + ')');
  const data = await res.json();
  if (!data || !data.closePrice) throw new Error(ticker + ' 시세 없음 — 존재하지 않는 종목코드일 수 있습니다.');

  const current = toNumber(data.closePrice);
  const diff = toNumber(data.compareToPreviousClosePrice);
  const changeRate = toNumber(data.fluctuationsRatio);
  return {
    ticker: ticker,
    currentPrice: current,
    prevClose: current - (isNaN(diff) ? 0 : diff),
    changeRate: isNaN(changeRate) ? 0 : changeRate,
    timestamp: Date.now(),
    delayed: false
  };
}

exports.handler = async function (event) {
  const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*' };
  const raw = (event.queryStringParameters && event.queryStringParameters.tickers) || '';
  const tickers = raw.split(',').map(function (t) { return t.trim(); }).filter(Boolean);

  if (!tickers.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'tickers 쿼리 파라미터가 필요합니다. 예: ?tickers=005930,069500' }) };
  }

  const results = await Promise.all(tickers.map(function (t) {
    return fetchOne(t).catch(function (e) { return { ticker: t, error: e.message }; });
  }));

  return { statusCode: 200, headers, body: JSON.stringify({ results: results }) };
};
