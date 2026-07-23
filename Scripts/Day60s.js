/******************************
脚本名称: 每日60S
Version : v1.2.4
更新时间: 2026-07-23
平台: Egern
功能: 每日60秒读懂世界（定时通知）
脚本作者: @Nullwhy
使用说明:
1. 模块 Rewrite/Day60s.module
2. 默认用免费 viki 接口；若申请了 ALAPI「每日早报」，在模块参数填 TOKEN 即可
环境变量 env:
- TOKEN / ALAPI_TOKEN  ALAPI 控制台 Token（填写后走 alapi 早报）
- API_URL   自定义完整 URL（可选；一般不用填）
- MAX_NEWS  新闻条数，默认 4（0=全部）
- OPEN_URL  image | none，默认 image
- DEDUPE    true/false，同日只推一次，默认 false
*******************************/

const SCRIPT_NAME = "每日60S";
const TITLE_MAIN = "每日60S · 读懂世界 💭";
const SCRIPT_AUTHOR = "@Nullwhy";
const SCRIPT_VERSION = "v1.2.4";
const SCRIPT_UPDATED = "2026-07-23";
const STORE_KEY = "60s_last_date";
const DEFAULT_API = "https://60s-api.viki.moe/v2/60s";
const FALLBACK_APIS = ["https://60s.viki.moe/v2/60s"];
const ALAPI_URL = "https://v2.alapi.cn/api/zaobao";
const DEFAULT_MAX_NEWS = 4;

function log(msg) {
  console.log("[" + SCRIPT_NAME + "] " + msg);
}

/**
 * 通知 + 点击跳转（action.openUrl）
 * 说明：通知由 Egern 发出，iOS 仍可能短暂激活 App，无法彻底禁止。
 */
function notifyWithCtx(ctx, title, subtitle, body, openUrl) {
  console.log("📢 " + title + " - " + subtitle + ": " + body);
  if (openUrl) console.log("🔗 " + openUrl);

  if (ctx && typeof ctx.notify === "function") {
    try {
      const payload = {
        title: title,
        subtitle: subtitle,
        body: body,
        sound: true
      };
      if (openUrl) {
        payload.action = { type: "openUrl", url: openUrl };
      }
      return ctx.notify(payload);
    } catch (e) {
      log("ctx.notify 失败: " + (e && e.message ? e.message : e));
    }
  }

  if (typeof $notification !== "undefined" && $notification.post) {
    try {
      $notification.post(title, subtitle, body);
    } catch (_) {}
  }
}

function getEnv(env, names, fallback) {
  if (fallback === undefined) fallback = "";
  for (let i = 0; i < names.length; i++) {
    const value = env && env[names[i]];
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
  const n = parseInt(getEnv(env, [key], String(def)), 10);
  return Number.isFinite(n) ? n : def;
}

/** 去掉接口自带的序号：1、 1. 1． 等 */
function stripLeadingIndex(text) {
  return String(text || "")
    .replace(/^\s*\d+\s*[\.．、:：]\s*/u, "")
    .replace(/^\s*[\.．、]\s*/u, "")
    .trim();
}

/** 去掉重复的【微语】前缀 */
function stripWeiyuPrefix(text) {
  return String(text || "")
    .replace(/^\s*【\s*微语\s*】\s*/u, "")
    .replace(/^\s*微语\s*[:：]\s*/u, "")
    .trim();
}

function buildBody(news, tip, maxNews) {
  const all = Array.isArray(news) ? news : [];
  const list = maxNews > 0 ? all.slice(0, maxNews) : all.slice();
  const lines = list.map(function (item, i) {
    let t =
      typeof item === "string"
        ? item
        : (item && (item.title || item.text)) || String(item);
    t = stripLeadingIndex(t);
    return i + 1 + ". " + t;
  });
  const tipClean = stripWeiyuPrefix(tip);
  if (tipClean) {
    lines.push("");
    lines.push("【微语】" + tipClean);
  }
  return lines.join("\n") || "暂无新闻";
}

function buildSubtitle(lunar, date, dow) {
  const left = [];
  if (date) left.push(date);
  if (dow) left.push(dow);
  const leftStr = left.join("  ");
  if (leftStr && lunar) return leftStr + "  ·  " + lunar;
  if (leftStr) return leftStr;
  if (lunar) return lunar;
  return "读懂世界";
}

/**
 * image 模式点击目标：
 * - 有 TOKEN：打开 ALAPI 官方 format=image（你已验证可预览）
 * - 无 TOKEN：仅使用非 file.alapi.cn 的可预览直链
 * 不再使用 wsrv / data: HTML（前者 403，后者易不被 openUrl 支持）
 */
function resolveOpenUrl(mode, image, token) {
  const m = (mode || "image").toLowerCase();
  if (m === "none" || m === "off" || m === "false") return "";

  const tok = (token || "").trim();
  if (tok) {
    return (
      ALAPI_URL +
      "?token=" +
      encodeURIComponent(tok) +
      "&format=image"
    );
  }

  const u = (image || "").trim();
  if (!u) return "";
  if (/file\.alapi\.cn/i.test(u)) return "";
  if (/wsrv\.nl|images\.weserv\.nl/i.test(u)) return "";
  if (/^data:/i.test(u)) return "";
  return u;
}




/** 统一不同接口字段 → { date, news, tip, image, dow, lunar } */
function normalizePayload(json, source) {
  const root = json && json.data !== undefined ? json.data : json;
  const data = root || {};
  let news = data.news || data.list || [];
  if (typeof news === "string") {
    news = news.split(/\n+/).filter(Boolean);
  }
  const tip = stripWeiyuPrefix(data.tip || data.weiyu || data.wei_yu || "");
  const image = data.image || data.head_image || data.cover || data.headImage || "";
  const date = data.date || data.today || "";
  const dow = data.day_of_week || data.week || "";
  const lunar = data.lunar_date || data.lunar || "";
  return {
    date: date,
    news: (Array.isArray(news) ? news : []).map(function (x) {
    return typeof x === "string" ? stripLeadingIndex(x) : x;
  }),
    tip: tip,
    image: image,
    dow: dow,
    lunar: lunar,
    source: source || ""
  };
}

async function fetchJSON(ctx, url) {
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

function buildAlapiUrl(token) {
  return (
    ALAPI_URL +
    "?token=" +
    encodeURIComponent(token) +
    "&format=json"
  );
}

async function loadNews(ctx, env) {
  const customUrl = getEnv(env, ["API_URL"], "");

  // 1) 用户自定义完整 URL（可自带 token 查询参数）
  if (customUrl) {
    log("使用自定义 API_URL");
    const json = await fetchJSON(ctx, customUrl);
    return normalizePayload(json, "custom");
  }

  // 2) ALAPI 每日早报（控制台 Token）
  if (token) {
    const url = buildAlapiUrl(token);
    log("使用 ALAPI 每日早报");
    const json = await fetchJSON(ctx, url);
    // ALAPI: { code:200, data:{ date, news, weiyu, image, head_image } }
    if (json && (json.code === 200 || json.success === true || json.data)) {
      if (json.code && json.code !== 200 && !json.data) {
        throw new Error(json.message || "ALAPI 错误 code=" + json.code);
      }
      return normalizePayload(json, "alapi");
    }
    throw new Error((json && json.message) || "ALAPI 返回异常");
  }

  // 3) 默认免费 viki 接口
  const urls = [DEFAULT_API].concat(FALLBACK_APIS);
  let lastErr;
  for (let i = 0; i < urls.length; i++) {
    try {
      log("使用免费接口: " + urls[i]);
      const json = await fetchJSON(ctx, urls[i]);
      if (json && (json.code === 200 || json.data)) {
        return normalizePayload(json, "viki");
      }
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
  const maxNews = envMaxNews(env, "MAX_NEWS", DEFAULT_MAX_NEWS);
  const dedupe = envBool(env, "DEDUPE", false);
  const openMode = getEnv(env, ["OPEN_URL"], "image");
  const token = getEnv(env, ["TOKEN", "ALAPI_TOKEN", "ALAPI_KEY"], "");

  log(
    "开始获取 " +
      SCRIPT_NAME +
      " | " +
      SCRIPT_VERSION +
      " | " +
      SCRIPT_AUTHOR +
      " | " +
      SCRIPT_UPDATED
  );

  try {
    const data = await loadNews(ctx, env);
    const date = data.date || "";
    const news = data.news || [];
    const tip = data.tip || "";
    const image = data.image || "";
    const dow = data.dow || "";
    const lunar = data.lunar || "";

    if (dedupe && date) {
      try {
        const last = await ctx.storage.get(STORE_KEY);
        if (last === date) {
          log("今日已推送，跳过: " + date);
          await notifyWithCtx(
            ctx,
            TITLE_MAIN,
            "已跳过",
            "今日 " + date + " 已推送过",
            ""
          );
          return;
        }
      } catch (e) {
        log("读取去重标记失败: " + (e && e.message ? e.message : e));
      }
    }

    const subtitle = buildSubtitle(lunar, date, dow);
    const body = buildBody(news, tip, maxNews);
    const openUrl = resolveOpenUrl(openMode, image, token);

    log("数据源: " + (data.source || "unknown"));
    log("标题: " + TITLE_MAIN);
    log("副标题: " + subtitle);
    log(
      "日期: " +
        date +
        " 展示: " +
        (maxNews > 0 ? Math.min(maxNews, news.length) : news.length) +
        "/" +
        news.length
    );
    if (openUrl) log("点击跳转: " + openUrl);

    await notifyWithCtx(ctx, TITLE_MAIN, subtitle, body, openUrl);

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
