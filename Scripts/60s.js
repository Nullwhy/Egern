/**
 * 每日60秒读懂世界 — Egern 版
 *
 * 说明：
 * - 原 ddgksf2013/60s.js 面向 Surge/QX/Loon（Env + $done），Egern 无法直接运行
 * - 本脚本使用 Egern 原生 API：export default + ctx.http + ctx.notify + ctx.storage
 * - 数据源：https://60s-api.viki.moe/v2/60s（开源 60s API）
 *
 * 用法（模块 schedule 或主配置 scriptings）：
 *   cron: "15 8 * * *"
 *   timeout: 60
 *
 * 可选环境变量 env：
 *   API_URL   默认 https://60s-api.viki.moe/v2/60s
 *   MAX_NEWS  通知里最多展示几条新闻，默认 8
 *   OPEN_URL  点击通知打开的链接：image | link | api（默认 image）
 *   DEDUPE    true/false，同一天只通知一次，默认 true
 */

const DEFAULT_API = "https://60s-api.viki.moe/v2/60s";
const FALLBACK_APIS = [
  "https://60s-api.viki.moe/v2/60s",
  "https://60s.viki.moe/v2/60s",
];

function envStr(ctx, key, def = "") {
  const v = ctx.env && ctx.env[key];
  if (v === undefined || v === null || v === "") return def;
  return String(v);
}

function envBool(ctx, key, def = true) {
  const v = envStr(ctx, key, def ? "true" : "false").toLowerCase();
  return !["0", "false", "no", "off"].includes(v);
}

function envInt(ctx, key, def) {
  const n = parseInt(envStr(ctx, key, String(def)), 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

async function fetchJSON(ctx, url) {
  const res = await ctx.http.get(url, {
    timeout: 25,
    headers: {
      Accept: "application/json",
      "User-Agent": "Egern-60s/1.0",
    },
  });
  if (!res || res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res && res.status} ${url}`);
  }
  // body may already be object or string depending on runtime
  let data = res.body;
  if (typeof data === "string") {
    data = JSON.parse(data);
  } else if (data && typeof data.arrayBuffer === "function") {
    // Response-like
    data = await data.json();
  }
  return data;
}

async function load60s(ctx) {
  const primary = envStr(ctx, "API_URL", DEFAULT_API);
  const urls = [primary, ...FALLBACK_APIS.filter((u) => u !== primary)];
  let lastErr;
  for (const url of urls) {
    try {
      const j = await fetchJSON(ctx, url);
      if (j && (j.code === 200 || j.data)) return { json: j, url };
      lastErr = new Error(`bad payload from ${url}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("all API failed");
}

function buildBody(news, tip, maxNews) {
  const list = (news || []).slice(0, maxNews);
  const lines = list.map((item, i) => {
    const t = typeof item === "string" ? item : item.title || item.text || JSON.stringify(item);
    return `${i + 1}. ${t}`;
  });
  if (tip) lines.push("", `【微语】${tip}`);
  // iOS 通知 body 过长会被截断，控制体积
  let body = lines.join("\n");
  if (body.length > 900) body = body.slice(0, 897) + "...";
  return body;
}

export default async function (ctx) {
  const maxNews = envInt(ctx, "MAX_NEWS", 8);
  const dedupe = envBool(ctx, "DEDUPE", true);
  const openMode = envStr(ctx, "OPEN_URL", "image").toLowerCase();

  try {
    const { json } = await load60s(ctx);
    const data = json.data || {};
    const date = data.date || "";
    const news = data.news || [];
    const tip = data.tip || "";
    const image = data.image || data.cover || "";
    const link = data.link || image || "https://60s.viki.moe/";
    const dow = data.day_of_week || "";
    const lunar = data.lunar_date || "";

    if (dedupe && date) {
      const key = "60s_last_date";
      const last = await ctx.storage.get(key);
      if (last === date) {
        console.log(`[60s] skip duplicate ${date}`);
        return;
      }
      await ctx.storage.set(key, date);
    }

    const title = date
      ? `每日60秒 · ${date}${dow ? " " + dow : ""}`
      : "每日60秒读懂世界";
    const subtitle = lunar || tip || "";
    const body = buildBody(news, tip, maxNews);

    let openUrl = link;
    if (openMode === "image" && image) openUrl = image;
    else if (openMode === "api") openUrl = envStr(ctx, "API_URL", DEFAULT_API);
    else if (openMode === "link" && link) openUrl = link;

    await ctx.notify({
      title,
      subtitle: subtitle.slice(0, 80),
      body,
      // 部分版本支持 attachment / url，字段名以 Egern 文档为准
      url: openUrl,
      attachment: image || undefined,
      sound: true,
    });

    console.log(`[60s] ok ${date} news=${news.length}`);
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.log(`[60s] error ${msg}`);
    try {
      await ctx.notify({
        title: "每日60秒",
        subtitle: "获取失败",
        body: msg.slice(0, 200),
      });
    } catch (_) {}
  }
}
