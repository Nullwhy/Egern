/******************************
脚本名称: 每日60秒
Version : v1.1.0
更新时间: 2026-07-23
平台: Egern
功能: 每日60秒读懂世界（定时/手动通知）
脚本作者：
@Nullwhy 适配Egern（写法参考 Scripts/NodeSeek.js）
使用说明:
1. 模块 Rewrite/60s.yaml 或主配置添加 schedule / generic
2. 默认每天 08:15 推送；脚本列表可点「每日60秒-手动」试跑
环境变量 env:
- API_URL   默认 https://60s-api.viki.moe/v2/60s
- MAX_NEWS  通知最多展示条数，默认 8
- OPEN_URL  image | link | api，默认 image
- DEDUPE    true/false，同日只推一次，默认 true（手动脚本模块里为 false）
*******************************/

const SCRIPT_NAME = "每日60秒";
const STORE_KEY = "60s_last_date";
const DEFAULT_API = "https://60s-api.viki.moe/v2/60s";
const FALLBACK_APIS = [
  "https://60s-api.viki.moe/v2/60s",
  "https://60s.viki.moe/v2/60s"
];

// ========== 工具函数 ==========
function log(msg) {
  console.log(`[${SCRIPT_NAME}] ${msg}`);
}

// 与 NodeSeek 一致：调用 Egern 原生 $notification
function notify(title, subtitle, body) {
  console.log(`📢 ${title} - ${subtitle}: ${body}`);
  if (typeof $notification !== "undefined" && $notification.post) {
    $notification.post(title, subtitle, body);
  }
}

function getEnv(env, names, fallback = "") {
  for (const name of names) {
    const value = env && env[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return fallback;
}

function envBool(env, key, def) {
  const v = getEnv(env, [key], def ? "true" : "false").toLowerCase();
  return !["0", "false", "no", "off"].includes(v);
}

function envInt(env, key, def) {
  const n = parseInt(getEnv(env, [key], String(def)), 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function buildBody(news, tip, maxNews) {
  const list = Array.isArray(news) ? news.slice(0, maxNews) : [];
  const lines = list.map((item, i) => {
    const t =
      typeof item === "string"
        ? item
        : (item && (item.title || item.text)) || String(item);
    return `${i + 1}. ${t}`;
  });
  if (tip) {
    lines.push("");
    lines.push(`【微语】${tip}`);
  }
  let body = lines.join("\n");
  if (body.length > 900) body = body.slice(0, 897) + "...";
  return body || "暂无新闻";
}

async function fetchNews(ctx, url) {
  const response = await ctx.http.get(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Egern-60s/1.1.0"
    },
    timeout: 20000
  });

  const status = response.status;
  const body = await response.text();

  if (!(status >= 200 && status < 300)) {
    throw new Error(`HTTP ${status}`);
  }

  let json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    throw new Error("JSON 解析失败");
  }
  return json;
}

async function load60s(ctx, apiUrl) {
  const urls = [apiUrl].concat(FALLBACK_APIS.filter((u) => u !== apiUrl));
  let lastErr;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      log(`请求: ${url}`);
      const json = await fetchNews(ctx, url);
      if (json && (json.code === 200 || json.data)) {
        return json;
      }
      lastErr = new Error("返回数据异常");
    } catch (e) {
      lastErr = e;
      log(`请求失败: ${e.message || e}`);
    }
  }
  throw lastErr || new Error("全部接口失败");
}

// ========== 主逻辑 ==========
async function main(ctx) {
  const env = (ctx && ctx.env) || {};
  const apiUrl = getEnv(env, ["API_URL"], DEFAULT_API);
  const maxNews = envInt(env, "MAX_NEWS", 8);
  const dedupe = envBool(env, "DEDUPE", true);

  log("开始获取每日60秒");

  try {
    const json = await load60s(ctx, apiUrl);
    const data = json.data || {};
    const date = data.date || "";
    const news = data.news || [];
    const tip = data.tip || "";
    const image = data.image || data.cover || "";
    const link = data.link || "";
    const dow = data.day_of_week || "";
    const lunar = data.lunar_date || "";

    if (dedupe && date) {
      try {
        const last = await ctx.storage.get(STORE_KEY);
        if (last === date) {
          log(`今日已推送，跳过: ${date}`);
          notify(SCRIPT_NAME, "已跳过", `今日 ${date} 已推送过`);
          return;
        }
      } catch (e) {
        log(`读取去重标记失败: ${e.message || e}`);
      }
    }

    const title = date
      ? `${SCRIPT_NAME} · ${date}${dow ? " " + dow : ""}`
      : SCRIPT_NAME;
    const subtitle = lunar || tip || "读懂世界";
    const body = buildBody(news, tip, maxNews);

    log(`日期: ${date} 新闻: ${news.length}`);
    if (image) log(`图片: ${image}`);
    if (link) log(`原文: ${link}`);

    notify(title, subtitle, body);

    if (dedupe && date) {
      try {
        await ctx.storage.set(STORE_KEY, date);
      } catch (e) {
        log(`写入去重标记失败: ${e.message || e}`);
      }
    }

    log("推送完成");
  } catch (error) {
    log(`失败: ${error.message || error}`);
    notify(SCRIPT_NAME, "获取失败", String(error.message || error).slice(0, 200));
  }
}

// ========== 导出 ==========
export default main;
