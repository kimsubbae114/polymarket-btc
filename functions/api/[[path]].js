// Proxy: /api/<key>/<path>?query  ->  https://<host>/<path>?query  (allowlist only)
const HOSTS = {
  gamma: 'gamma-api.polymarket.com',
  clob: 'clob.polymarket.com',
  kalshi: 'api.elections.kalshi.com',
  binance: 'api.binance.com',
};
export async function onRequestGet({ request, params }) {
  const [key, ...rest] = params.path || [];
  const host = HOSTS[key];
  if (!host) return new Response('unknown upstream', { status: 404 });
  const u = new URL(request.url);
  const target = `https://${host}/${rest.join('/')}${u.search}`;
  const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
  const body = await r.text();
  return new Response(body, {
    status: r.status,
    headers: {
      'content-type': r.headers.get('content-type') || 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=15',
    },
  });
}
