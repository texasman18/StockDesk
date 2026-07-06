/* 한국투자증권(KIS) 오픈API 프록시 — Netlify Function
   App Key/Secret은 이 서버 환경변수에만 보관되며 브라우저에는 절대 노출되지 않는다.

   필요한 Netlify 환경변수 (Site settings → Environment variables):
     KIS_APP_KEY     한투 개발자센터에서 발급받은 App Key
     KIS_APP_SECRET  한투 개발자센터에서 발급받은 App Secret
     KIS_ENV         "real"(실전, 기본값) 또는 "virtual"(모의투자)

   호출 방법: GET /.netlify/functions/kis-quote?tickers=005930,000660 */

let cachedToken = null; // { token, expiresAt } — 같은 warm 인스턴스 안에서만 재사용, 매 호출마다 토큰을 새로 받지 않기 위함

function baseUrl() {
  return process.env.KIS_ENV === 'virtual'
    ? 'https://openapivts.koreainvestment.com:29443'
    : 'https://openapi.koreainvestment.com:9443';
}

async function getToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.token;
  const res = await fetch(baseUrl() + '/oauth2/tokenP', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET
    })
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error('KIS 토큰 발급 실패: ' + (data.error_description || res.status));
  }
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ? data.expires_in * 1000 : 23 * 3600 * 1000)
  };
  return cachedToken.token;
}

async function fetchQuote(ticker, token) {
  const url = new URL(baseUrl() + '/uapi/domestic-stock/v1/quotations/inquire-price');
  url.searchParams.set('FID_COND_MRKT_DIV_CODE', 'J'); // 주식/ETF/ETN 공통
  url.searchParams.set('FID_INPUT_ISCD', ticker);
  const res = await fetch(url, {
    headers: {
      authorization: 'Bearer ' + token,
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
      tr_id: 'FHKST01010100',
      custtype: 'P'
    }
  });
  const data = await res.json();
  const o = data.output;
  if (!res.ok || !o || !o.stck_prpr) {
    throw new Error(data.msg1 || ('시세 조회 실패 (' + res.status + ')'));
  }
  const current = parseFloat(o.stck_prpr);
  const changeRate = parseFloat(o.prdy_ctrt);
  const prevClose = !isNaN(changeRate) && (1 + changeRate / 100) !== 0
    ? current / (1 + changeRate / 100)
    : current;
  return {
    ticker: ticker,
    currentPrice: current,
    changeRate: isNaN(changeRate) ? 0 : changeRate,
    prevClose: prevClose,
    timestamp: Date.now(),
    delayed: false
  };
}

exports.handler = async function (event) {
  const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*' };

  if (!process.env.KIS_APP_KEY || !process.env.KIS_APP_SECRET) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'KIS_APP_KEY / KIS_APP_SECRET 환경변수가 설정되지 않았습니다.' }) };
  }

  const raw = (event.queryStringParameters && event.queryStringParameters.tickers) || '';
  const tickers = raw.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  if (!tickers.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'tickers 쿼리 파라미터가 필요합니다. 예: ?tickers=005930,000660' }) };
  }

  try {
    const token = await getToken();
    const results = [];
    // KIS 초당 호출 제한을 피하기 위해 순차 호출
    for (const ticker of tickers) {
      try {
        results.push(await fetchQuote(ticker, token));
      } catch (e) {
        results.push({ ticker: ticker, error: e.message });
      }
    }
    return { statusCode: 200, headers, body: JSON.stringify({ results: results }) };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: e.message }) };
  }
};
