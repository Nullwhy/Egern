/******************************
脚本名称: 每日60S
Version : v1.2.7
更新时间: 2026-07-23
平台: Egern
功能: 每日60秒读懂世界（定时通知）
脚本作者: @Nullwhy
使用说明:
1. 模块 Rewrite/Day60s.module
2. TOKEN 填 ALAPI 用早报文字；点击 image 用 viki 可预览 https 海报
环境变量:
- TOKEN / ALAPI_TOKEN  ALAPI Token；留空用免费 viki
- MAX_NEWS  默认 4（0=全部）
- OPEN_URL  image | none
- DEDUPE    默认 false
*******************************/

const SCRIPT_NAME = "每日60S";
const TITLE_MAIN = "每日60S · 读懂世界 💭";
const SCRIPT_AUTHOR = "@Nullwhy";
const SCRIPT_VERSION = "v1.2.7";
const SCRIPT_UPDATED = "2026-07-23";
const STORE_KEY = "60s_last_date";
const DEFAULT_API = "https://60s-api.viki.moe/v2/60s";
const FALLBACK_APIS = ["https://60s.viki.moe/v2/60s"];
const ALAPI_URL = "https://v2.alapi.cn/api/zaobao";
const DEFAULT_MAX_NEWS = 4;

function log(msg) {
  console.log("[" + SCRIPT_NAME + "] " + msg);
}

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
      if (openUrl && /^https?:\/\//i.test(openUrl)) {
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

function stripLeadingIndex(text) {
  return String(text || "")
    .replace(/^\s*\d+\s*[\.．、:：]\s*/u, "")
    .replace(/^\s*[\.．、]\s*/u, "")
    .trim();
}

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
    var s =
      typeof item === "string"
        ? item
        : (item && (item.title || item.text)) || String(item);
    s = stripLeadingIndex(s);
    return i + 1 + ". " + s;
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

function resolveOpenUrl(mode, image) {
  const m = (mode || "image").toLowerCase();
  if (m === "none" || m === "off" || m === "false") return "";
  const u = (image || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) return "";
  if (/file\.alapi\.cn/i.test(u)) return "";
  if (/wsrv\.nl|images\.weserv\.nl/i.test(u)) return "";
  return u;
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

function normalizePayload(json, source) {
  const root = json && json.data !== undefined ? json.data : json;
  const data = root || {};
  var news = data.news || data.list || [];
  if (typeof news === "string") {
    news = news.split(/\n+/).filter(Boolean);
  }
  news = (Array.isArray(news) ? news : []).map(function (x) {
    return typeof x === "string" ? stripLeadingIndex(x) : x;
  });
  return {
    date: data.date || data.today || "",
    news: news,
    tip: stripWeiyuPrefix(data.tip || data.weiyu || data.wei_yu || ""),
    image: data.image || data.head_image || data.cover || data.headImage || "",
    dow: data.day_of_week || data.week || "",
    lunar: data.lunar_date || data.lunar || "",
    source: source || ""
  };
}

function buildAlapiUrl(token) {
  return ALAPI_URL + "?token=" + encodeURIComponent(token) + "&format=json";
}

async function fetchPreviewPosterUrl(ctx) {
  const urls = [DEFAULT_API].concat(FALLBACK_APIS);
  for (var i = 0; i < urls.length; i++) {
    try {
      const json = await fetchJSON(ctx, urls[i]);
      const n = normalizePayload(json, "viki");
      const img = resolveOpenUrl("image", n.image);
      if (img) return img;
    } catch (e) {
      log("预览海报失败: " + (e && e.message ? e.message : e));
    }
  }
  return "";
}

async function loadNews(ctx, env) {
  const token = getEnv(env, ["TOKEN", "ALAPI_TOKEN", "ALAPI_KEY"], "");
  const customUrl = getEnv(env, ["API_URL"], "");

  if (customUrl) {
    log("使用自定义 API_URL");
    const json = await fetchJSON(ctx, customUrl);
    return normalizePayload(json, "custom");
  }

  if (token) {
    log("使用 ALAPI 每日早报（文字）");
    const json = await fetchJSON(ctx, buildAlapiUrl(token));
    if (json && (json.code === 200 || json.success === true || json.data)) {
      if (json.code && json.code !== 200 && !json.data) {
        throw new Error(json.message || "ALAPI 错误 code=" + json.code);
      }
      return normalizePayload(json, "alapi");
    }
    throw new Error((json && json.message) || "ALAPI 返回异常");
  }

  const urls = [DEFAULT_API].concat(FALLBACK_APIS);
  var lastErr;
  for (var i = 0; i < urls.length; i++) {
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

    var openUrl = resolveOpenUrl(openMode, image);
    if (openMode === "image" && !openUrl) {
      log("数据源海报不可预览，改用 viki 海报作点击目标");
      openUrl = await fetchPreviewPosterUrl(ctx);
    }

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
    else if (openMode === "image") log("无可用预览图，点击将只打开 Egern");

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
