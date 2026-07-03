export const dynamic = 'force-dynamic';

const STORE_API = 'https://port-0-admichat-lzgmwhc4d9883c97.sel4.cloudtype.app/api/store?filterActive=true';

// 매장.html이 쓰는 매장 리스트 API 프록시 (10분 캐시)
let cache = { at: 0, data: null };

export async function GET() {
  if (cache.data && Date.now() - cache.at < 10 * 60 * 1000) {
    return Response.json(cache.data);
  }
  try {
    const res = await fetch(STORE_API, { cache: 'no-store' });
    const json = await res.json();
    const stores = (json.stores || [])
      .map((s) => ({ name: s.name, address: s.address || '', phone: s.phone || '' }))
      .filter((s) => s.name);
    cache = { at: Date.now(), data: stores };
    return Response.json(stores);
  } catch (e) {
    console.error('매장 API 실패:', e);
    return Response.json(cache.data || [], { status: cache.data ? 200 : 502 });
  }
}
