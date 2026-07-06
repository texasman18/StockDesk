/* Google News RSS 프록시 — Netlify Function
   API 키가 필요 없는 공개 RSS 피드를 서버에서 가져와 CORS 없이 JSON으로 변환한다.
   (브라우저에서 news.google.com을 직접 fetch하면 CORS에 막히므로 프록시가 필요할 뿐, 별도 키 발급은 불필요)

   호출 방법:
     GET /.netlify/functions/news?q=삼성전자&limit=3
     GET /.netlify/functions/news?q=NVIDIA&limit=3&hl=en-US&gl=US&ceid=US:en */

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function stripCdata(s) {
  var m = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(s.trim());
  return m ? m[1] : s;
}

function extractTag(block, tag) {
  var re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>');
  var m = re.exec(block);
  return m ? stripCdata(m[1]).trim() : '';
}

function parseItems(xml) {
  var items = [];
  var itemRe = /<item>([\s\S]*?)<\/item>/g;
  var m;
  while ((m = itemRe.exec(xml))) {
    var block = m[1];
    var title = extractTag(block, 'title');
    var link = extractTag(block, 'link');
    var pubDate = extractTag(block, 'pubDate');
    var sourceTag = extractTag(block, 'source');
    var headline = title, source = sourceTag;
    if (!source && title) {
      var idx = title.lastIndexOf(' - ');
      if (idx > -1) { headline = title.slice(0, idx); source = title.slice(idx + 3); }
    }
    items.push({
      headline: decodeEntities(headline),
      source: decodeEntities(source || '뉴스'),
      publishedAt: pubDate ? Date.parse(pubDate) : null,
      url: decodeEntities(link)
    });
  }
  return items;
}

exports.handler = async function (event) {
  const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*' };
  const params = event.queryStringParameters || {};
  const q = (params.q || '').trim();
  const limit = Math.min(parseInt(params.limit, 10) || 3, 10);
  const hl = params.hl || 'ko';
  const gl = params.gl || 'KR';
  const ceid = params.ceid || 'KR:ko';

  if (!q) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'q 쿼리 파라미터가 필요합니다.' }) };
  }

  try {
    const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) +
      '&hl=' + encodeURIComponent(hl) + '&gl=' + encodeURIComponent(gl) + '&ceid=' + encodeURIComponent(ceid);
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; StockDeskBot/1.0)' } });
    if (!res.ok) throw new Error('Google News 응답 실패 (' + res.status + ')');
    const xml = await res.text();
    const items = parseItems(xml).slice(0, limit);
    return { statusCode: 200, headers, body: JSON.stringify({ items: items }) };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: e.message }) };
  }
};
