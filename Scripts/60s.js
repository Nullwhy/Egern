/******************************
脚本名称: 每日60秒
Version : v1.0.1
更新时间: 2026-07-23
平台: Egern
功能: 每日60秒读懂世界（定时/手动通知）
说明:
- 原 ddgksf2013/60s.js 为 Surge/QX 风格，不能直接在 Egern 运行
- 本脚本按仓库内 Sinopec/NetUnlock 等写法适配 Egern ctx API
- 数据源: https://60s-api.viki.moe/v2/60s
环境变量 env:
- API_URL   默认 https://60s-api.viki.moe/v2/60s
- MAX_NEWS  通知最多展示条数，默认 8
- OPEN_URL  image | link | api，默认 image
- DEDUPE    true/false，同日只推一次，默认 true（手动调试可设 false）
*******************************/

const DEFAULT_API = 'https://60s-api.viki.moe/v2/60s';
const FALLBACK_APIS = [
  'https://60s-api.viki.moe/v2/60s',
  'https://60s.viki.moe/v2/60s'
];

const getEnv = (env, names, fallback = '') => {
  for (const name of names) {
    const value = env?.[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return fallback;
};

const envBool = (env, key, def = true) => {
  const v = getEnv(env, [key], def ? 'true' : 'false').toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(v);
};

const envInt = (env, key, def) => {
  const n = parseInt(getEnv(env, [key], String(def)), 10);
  return Number.isFinite(n) && n > 0 ? n : def;
};

async function readJSONResponse(resp) {
  if (!resp) throw new Error('empty response');
  // 与仓库内其它 Egern 脚本一致：优先 text() / json()
  if (typeof resp.json === 'function') {
    try {
      return await resp.json();
    } catch (_) {}
  }
  if (typeof resp.text === 'function') {
    const t = await resp.text();
    if (!t) throw new Error('empty body');
    return JSON.parse(t);
  }
  if (typeof resp.body === 'string') {
    return JSON.parse(resp.body);
  }
  if (resp.body && typeof resp.body === 'object') {
    return resp.body;
  }
  throw new Error('unsupported response body');
}

async function fetchJSON(ctx, url) {
  const resp = await ctx.http.get(url, {
    timeout: 20000,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Egern-60s/1.0.1'
    }
  });
  const status = resp?.status ?? resp?.statusCode;
  if (status && (status < 200 || status >= 300)) {
    throw new Error(`HTTP ${status}`);
  }
  return readJSONResponse(resp);
}

async function load60s(ctx, apiUrl) {
  const urls = [apiUrl, ...FALLBACK_APIS.filter((u) => u !== apiUrl)];
  let lastErr;
  for (const url of urls) {
    try {
      const json = await fetchJSON(ctx, url);
      if (json && (json.code === 200 || json.data)) {
        return json;
      }
      lastErr = new Error('bad payload');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('all API failed');
}

function buildBody(news, tip, maxNews) {
  const list = Array.isArray(news) ? news.slice(0, maxNews) : [];
  const lines = list.map((item, i) => {
    const t =
      typeof item === 'string'
        ? item
        : item?.title || item?.text || JSON.stringify(item);
    return `${i + 1}. ${t}`;
  });
  if (tip) {
    lines.push('');
    lines.push(`【微语】${tip}`);
  }
  let body = lines.join('\n');
  if (body.length > 900) body = body.slice(0, 897) + '...';
  return body || '暂无新闻';
}

export default async function (ctx) {
  const env = ctx.env || {};
  const apiUrl = getEnv(env, ['API_URL'], DEFAULT_API);
  const maxNews = envInt(env, 'MAX_NEWS', 8);
  const dedupe = envBool(env, 'DEDUPE', true);
  const openMode = getEnv(env, ['OPEN_URL'], 'image').toLowerCase();

  try {
    const json = await load60s(ctx, apiUrl);
    const data = json.data || {};
    const date = data.date || '';
    const news = data.news || [];
    const tip = data.tip || '';
    const image = data.image || data.cover || '';
    const link = data.link || image || 'https://60s.viki.moe/';
    const dow = data.day_of_week || '';
    const lunar = data.lunar_date || '';

    if (dedupe && date && ctx.storage) {
      const key = '60s_last_date';
      try {
        const last = await ctx.storage.get(key);
        if (last === date) {
          console.log('[60s] skip duplicate ' + date);
          return;
        }
        await ctx.storage.set(key, date);
      } catch (e) {
        console.log('[60s] storage warn ' + (e && e.message));
      }
    }

    const title = date
      ? `每日60秒 · ${date}${dow ? ' ' + dow : ''}`
      : '每日60秒读懂世界';
    const subtitle = (lunar || tip || '').slice(0, 80);
    const body = buildBody(news, tip, maxNews);

    let openUrl = link;
    if (openMode === 'image' && image) openUrl = image;
    else if (openMode === 'api') openUrl = apiUrl;
    else if (openMode === 'link' && link) openUrl = link;

    // 通知字段尽量保守，避免未知字段导致运行失败
    const notifyOpts = {
      title,
      subtitle,
      body
    };
    if (openUrl) notifyOpts.url = openUrl;
    if (image) notifyOpts.attachment = image;

    if (typeof ctx.notify === 'function') {
      await ctx.notify(notifyOpts);
    } else {
      console.log('[60s] notify unavailable');
      console.log(title);
      console.log(body);
    }
    console.log(`[60s] ok date=${date} news=${news.length}`);
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.log('[60s] error ' + msg);
    try {
      if (typeof ctx.notify === 'function') {
        await ctx.notify({
          title: '每日60秒',
          subtitle: '获取失败',
          body: msg.slice(0, 200)
        });
      }
    } catch (_) {}
  }
}
