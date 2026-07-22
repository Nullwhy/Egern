/******************************
脚本名称: Day60s
Version : v1.1.8
更新时间: 2026-07-23
平台: Egern
功能: 每日60秒读懂世界（定时通知）
脚本作者: @Nullwhy
通知排版:
- 主标题: 每日60S
- 副标题: 阳历日期  星期  ·  阴历
- 正文: 1..N 新闻 + 【微语】
使用说明:
1. 模块 Rewrite/Day60s.yaml 或主配置添加 schedule
2. 默认每天 08:15 推送
环境变量 env:
- API_URL   默认 https://60s-api.viki.moe/v2/60s
- MAX_NEWS  新闻条数，默认 4（0=全部）
- OPEN_URL  image | none，默认 image
- DEDUPE    true/false，同日只推一次，默认 false
*******************************/

const SCRIPT_NAME = "Day60s";
const TITLE_MAIN = "每日60S";
const SCRIPT_AUTHOR = "@Nullwhy";
const SCRIPT_VERSION = "v1.1.8";
const SCRIPT_UPDATED = "2026-07-23";
const STORE_KEY = "60s_last_date";
const DEFAULT_API = "https://60s-api.viki.moe/v2/60s";
const FALLBACK_APIS = [
  "https://60s-api.viki.moe/v2/60s",
  "https://60s.viki.moe/v2/60s"
];
const DEFAULT_MAX_NEWS = 4;

function log(msg) {
  console.log(`[${SCRIPT_NAME}] ${msg}`);
}

/** 通知 + 点击跳转（Options.url / Open Link） */
function notifyWithCtx(ctx, title, subtitle, body, openUrl) {
  console.log(`📢 ${title} - ${subtitle}: ${body}`);
  if (openUrl) console.log(`🔗 ${openUrl}`);

  // 1) $notification.post 第四参 { url }（你之前成功时详情里有 Options.url）
  if (typeof $notification !== "undefined" && $notification.post) {
    try {
      if (openUrl) {
        $notification.post(title, subtitle, body, { url: openUrl });
        return;
      }
      $notification.post(title, subtitle, body);
      return;
    } catch (e1) {
      try {
        if (openUrl) {
          $notification.post(title, subtitle, body, openUrl);
          return;
        }
      } catch (e2) {
        try {
          $notification.post(title, subtitle, body);
          return;
        } catch (_) {}
      }
    }
  }

  // 2) ctx.notify 回退
  if (ctx && typeof ctx.notify === "function") {
    try {
      const payload = { title: title, subtitle: subtitle, body: body };
      if (openUrl) {
        payload.url = openUrl;
        payload.open_url = openUrl;
        payload.openUrl = openUrl;
      }
      return ctx.notify(payload);
    } catch (e) {
      log("ctx.notify 失败: " + (e && e.message ? e.message : e));
    }
  }
}

function getEnv(env, names, fallback) {
  if (fallback === undefined) fallback = "";
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const value = env && env[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return fallback;
}

function envBool(env, key, def) {
  const v = getEnv(env, [key], def ? "true" : "false").toLowerCase();
  return ["0", "false", "no", "off"].indexOf(v) === -1;
}

function envMaxNews(env, key, def) {
  const raw = getEnv(env, [key], String(def));
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return n;
}

function buildBody(news, tip, maxNews) {
  const all = Array.isArray(news) ? news : [];
  const list = maxNews && maxNews > 0 ? all.slice(0, maxNews) : all.slice();
  const lines = list.map(function (item, i) {
    const t =
      typeof item === "string"
        ? item
        : (item && (item.title || item.text)) || String(item);
    return i + 1 + ". " + t;
  });
  if (tip) {
    lines.push("");
    lines.push("【微语】" + tip);
  }
  return lines.join("\n") || "暂无新闻";
}

// 副标题：阳历  星期  ·  阴历
// 例：2026-07-23  星期三  ·  丙午年六月初十
function buildSubtitle(lunar, date, dow) {
  // 2026-07-23  星期三  ·  丙午年六月初十
  const left = [];
  if (date) left.push(date);
  if (dow) left.push(dow);
  const leftStr = left.join("  ");
  if (leftStr && lunar) return leftStr + "  ·  " + lunar;
  if (leftStr) return leftStr;
  if (lunar) return lunar;
  return "读懂世界";
}

function resolveOpenUrl(mode, image, link, apiUrl) {
  const m = (mode || "image").toLowerCase();
  // 仅支持 image / none（兼容旧值 link、api 时：link→原文，其余默认海报）
  if (m === "none" || m === "off" || m === "false") return "";
  if (m === "link" && link) return link; // 旧参数兼容，模块 UI 已去掉
  if (m === "api") return ""; // 已移除，忽略
  if (image) return image;
  if (link) return link;
  return "";
}

async function fetchNews(ctx, url) {
  const response = await ctx.http.get(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Egern-60s/" + SCRIPT_VERSION
    },
    timeout: 20000
  });
  const status = response.status;
  const body = await response.text();
  if (!(status >= 200 && status < 300)) throw new Error("HTTP " + status);
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new Error("JSON 解析失败");
  }
}

async function load60s(ctx, apiUrl) {
  const urls = [apiUrl].concat(FALLBACK_APIS.filter(function (u) { return u !== apiUrl; }));
  let lastErr;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      log("请求: " + url);
      const json = await fetchNews(ctx, url);
      if (json && (json.code === 200 || json.data)) return json;
      lastErr = new Error("返回数据异常");
    } catch (e) {
      lastErr = e;
      log("请求失败: " + (e && e.message ? e.message : e));
    }
  }
  throw lastErr || new Error("全部接口失败");
}

async function main(ctx) {
  const env = (ctx && ctx.env) || {};
  const apiUrl = getEnv(env, ["API_URL"], DEFAULT_API);
  const maxNews = envMaxNews(env, "MAX_NEWS", DEFAULT_MAX_NEWS);
  const dedupe = envBool(env, "DEDUPE", false);
  const openMode = getEnv(env, ["OPEN_URL"], "image");

  log("开始获取 " + SCRIPT_NAME + " | " + SCRIPT_VERSION + " | " + SCRIPT_AUTHOR + " | " + SCRIPT_UPDATED);

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
          log("今日已推送，跳过: " + date);
          await notifyWithCtx(ctx, TITLE_MAIN, "已跳过", "今日 " + date + " 已推送过", "");
          return;
        }
      } catch (e) {
        log("读取去重标记失败: " + (e && e.message ? e.message : e));
      }
    }

    const title = TITLE_MAIN;
    const subtitle = buildSubtitle(lunar, date, dow);
    const body = buildBody(news, tip, maxNews);
    const openUrl = resolveOpenUrl(openMode, image, link, apiUrl);

    log("标题: " + title);
    log("副标题: " + subtitle);
    log("日期: " + date + " 展示: " + (maxNews > 0 ? Math.min(maxNews, news.length) : news.length) + "/" + news.length);
    if (openUrl) log("点击跳转: " + openUrl);

    await notifyWithCtx(ctx, title, subtitle, body, openUrl);

    if (dedupe && date) {
      try {
        await ctx.storage.set(STORE_KEY, date);
      } catch (e) {
        log("写入去重标记失败: " + (e && e.message ? e.message : e));
      }
    }

    log("推送完成");
  } catch (error) {
    log("失败: " + (error && error.message ? error.message : error));
    await notifyWithCtx(
      ctx,
      TITLE_MAIN,
      "获取失败",
      String(error && error.message ? error.message : error).slice(0, 200),
      ""
    );
  }
}

export default main;
