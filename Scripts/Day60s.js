/******************************
脚本名称: 每日60S
Version : v1.1.24
更新时间: 2026-07-23
平台: Egern
功能: 每日60秒读懂世界（定时通知）
脚本作者: @Nullwhy
使用说明:
1. 模块 Rewrite/Day60s.module
2. MULTI_NOTIFY=true 时拆成多条通知显示更多新闻（默认关闭，只发 1 条）
3. OPEN_URL 默认 none
环境变量 env:
- API_URL      默认 https://60s-api.viki.moe/v2/60s
- MAX_NEWS     单条默认 5；0=全部（多条通知开启时建议 0）
- MULTI_NOTIFY true=多条通知，false=单条（默认 false）
- CHUNK_SIZE   多条模式下每条条数，默认 5
- OPEN_URL     image=打开海报 | none=不跳转（默认 image）
- ALLOW_REPEAT 允许同日多次，默认 false（即同日只推一次）
- DEDUPE       兼容旧参数；不填则默认只推一次
*******************************/

const SCRIPT_NAME = "每日60S";
const TITLE_MAIN = "每日60S · 读懂世界 💭";
const SCRIPT_AUTHOR = "@Nullwhy";
const SCRIPT_VERSION = "v1.1.24";
const SCRIPT_UPDATED = "2026-07-23";
const STORE_KEY = "60s_last_date";
const DEFAULT_API = "https://60s-api.viki.moe/v2/60s";
const FALLBACK_APIS = ["https://60s.viki.moe/v2/60s"];
const DEFAULT_MAX_NEWS = 5;
const DEFAULT_CHUNK_SIZE = 5;

function log(msg) {
  console.log("[" + SCRIPT_NAME + "] " + msg);
}

function notifyWithCtx(ctx, title, subtitle, body, openUrl) {
  console.log("📢 " + title + " - " + subtitle + ": " + body);
  if (openUrl) console.log("🔗 " + openUrl);

  const payload = {
    title: title,
    subtitle: subtitle,
    body: body,
    sound: true
  };
  if (openUrl && /^https?:\/\//i.test(String(openUrl))) {
    payload.action = { type: "openUrl", url: String(openUrl) };
  }

  if (ctx && typeof ctx.notify === "function") {
    try {
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

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
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
  // 未设置或空字符串时用 def（首次添加模块时 Toggle 可能未写入 env）
  if (!env || env[key] === undefined || env[key] === null || String(env[key]).trim() === "") {
    return !!def;
  }
  const v = String(env[key]).trim().toLowerCase();
  if (["1", "true", "yes", "on", "开启"].indexOf(v) !== -1) return true;
  if (["0", "false", "no", "off", "关闭"].indexOf(v) !== -1) return false;
  return !!def;
}

/**
 * 同日只推一次：默认 true
 * 模块 UI 使用「允许同日多次」ALLOW_REPEAT（Toggle 默认关 = 不允许多次 = 只推一次）
 * 兼容旧参数 DEDUPE
 */
function resolveDedupe(env) {
  env = env || {};
  // 显式 DEDUPE 优先（含空则走默认）
  if (env.DEDUPE !== undefined && env.DEDUPE !== null && String(env.DEDUPE).trim() !== "") {
    return envBool(env, "DEDUPE", true);
  }
  // 允许同日多次：默认 false → 同日只推一次
  if (
    env.ALLOW_REPEAT !== undefined &&
    env.ALLOW_REPEAT !== null &&
    String(env.ALLOW_REPEAT).trim() !== ""
  ) {
    return !envBool(env, "ALLOW_REPEAT", false);
  }
  return true;
}


function envInt(env, key, def) {
  const n = parseInt(getEnv(env, [key], String(def)), 10);
  return Number.isFinite(n) ? n : def;
}

function stripLeadingIndex(text) {
  return String(text || "")
    .replace(/^\s*\d+\s*[\.．、:：]\s*/u, "")
    .trim();
}

function chunkArray(arr, size) {
  const out = [];
  const s = size > 0 ? size : arr.length || 1;
  for (let i = 0; i < arr.length; i += s) {
    out.push(arr.slice(i, i + s));
  }
  return out.length ? out : [[]];
}

function buildBodyChunk(newsChunk, startIndex, tip) {
  const lines = (newsChunk || []).map(function (item, i) {
    var s =
      typeof item === "string"
        ? item
        : (item && (item.title || item.text)) || String(item);
    s = stripLeadingIndex(s);
    return startIndex + i + 1 + ". " + s;
  });
  if (tip) {
    lines.push("");
    lines.push(
      "【微语】" +
        String(tip)
          .replace(/^\s*【\s*微语\s*】\s*/u, "")
          .trim()
    );
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

function normalizeHttpsImageUrl(url) {
  if (!url) return "";
  var u = String(url).trim();
  if (!u) return "";
  if (u.indexOf("//") === 0) u = "https:" + u;
  if (!/^https?:\/\//i.test(u)) {
    if (/^[a-z0-9.-]+\//i.test(u)) u = "https://" + u;
    else return "";
  }
  u = u.replace(/^http:\/\//i, "https://");
  if (/file\.alapi\.cn/i.test(u)) return "";
  if (/wsrv\.nl|images\.weserv\.nl/i.test(u)) return "";
  if (/^data:/i.test(u)) return "";
  return u;
}

function resolveOpenUrl(mode, image) {
  const m = (mode || "none").toLowerCase();
  if (m === "none" || m === "off" || m === "false") return "";
  return normalizeHttpsImageUrl(image);
}

function vikiPosterByDate(date) {
  const d = String(date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
  return (
    "https://cdn.jsdmirror.com/gh/vikiboss/60s-static-host@main/static/images/" +
    d +
    ".png"
  );
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
  const seen = {};
  const urls = [];
  [apiUrl].concat(FALLBACK_APIS).forEach(function (u) {
    if (u && !seen[u]) {
      seen[u] = true;
      urls.push(u);
    }
  });
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
  const maxNews = envInt(env, "MAX_NEWS", DEFAULT_MAX_NEWS);
  const multiNotify = envBool(env, "MULTI_NOTIFY", false);
  const chunkSize = Math.max(1, envInt(env, "CHUNK_SIZE", DEFAULT_CHUNK_SIZE));
  const dedupe = resolveDedupe(env);
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
    const json = await load60s(ctx, apiUrl);
    const data = json.data || {};
    const date = data.date || "";
    var news = data.news || [];
    const tip = data.tip || "";
    const image = data.image || data.cover || "";
    const dow = data.day_of_week || "";
    const lunar = data.lunar_date || "";

    if (maxNews > 0) news = news.slice(0, maxNews);

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

    var openUrl = "";
    if (openMode === "image") {
      openUrl = resolveOpenUrl("image", image);
      if (!openUrl) openUrl = resolveOpenUrl("image", vikiPosterByDate(date));
    }

    // MULTI_NOTIFY=true：拆多条；默认 false 只发一条（系统可能截断长正文）
    var effectiveChunk = multiNotify ? chunkSize : news.length || 1;
    if (!multiNotify) effectiveChunk = news.length || 1;
    const chunks = multiNotify
      ? chunkArray(news, chunkSize)
      : [news.slice()];
    const total = chunks.length;
    log(
      "新闻 " +
        news.length +
        " 条，" +
        (multiNotify
          ? "多条通知模式，共 " + total + " 条（每条最多 " + chunkSize + "）"
          : "单条通知模式")
    );

    for (var i = 0; i < total; i++) {
      const startIndex = multiNotify ? i * chunkSize : 0;
      const isLast = i === total - 1;
      const partBody = buildBodyChunk(
        chunks[i],
        startIndex,
        isLast ? tip : ""
      );
      const partTitle =
        total > 1 ? TITLE_MAIN + " (" + (i + 1) + "/" + total + ")" : TITLE_MAIN;
      const partOpen = isLast ? openUrl : "";

      log("发送通知 " + (i + 1) + "/" + total);
      await notifyWithCtx(ctx, partTitle, subtitle, partBody, partOpen);
      if (!isLast) await sleep(500);
    }

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
