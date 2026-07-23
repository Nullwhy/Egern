/******************************
脚本名称: 每日60S
Version : v1.1.18
更新时间: 2026-07-23
平台: Egern
功能: 每日60秒读懂世界（定时通知）
脚本作者: @Nullwhy
使用说明:
1. 模块 Rewrite/Day60s.module 或主配置添加 schedule
2. 默认每天 08:15 推送
3. OPEN_URL=image 时点击通知打开 viki 海报 https 链接
环境变量 env:
- API_URL   默认 https://60s-api.viki.moe/v2/60s
- MAX_NEWS  新闻条数，默认 4（0=全部）
- OPEN_URL  image | none，默认 image
- DEDUPE    true/false，同日只推一次，默认 false
*******************************/

const SCRIPT_NAME = "每日60S";
const TITLE_MAIN = "每日60S · 读懂世界 💭";
const SCRIPT_AUTHOR = "@Nullwhy";
const SCRIPT_VERSION = "v1.1.18";
const SCRIPT_UPDATED = "2026-07-23";
const STORE_KEY = "60s_last_date";
const DEFAULT_API = "https://60s-api.viki.moe/v2/60s";
const FALLBACK_APIS = ["https://60s.viki.moe/v2/60s"];
const DEFAULT_MAX_NEWS = 4;

function log(msg) {
  console.log("[" + SCRIPT_NAME + "] " + msg);
}

/**
 * 仅用官方 ctx.notify + action.openUrl
 * url 必须是 http(s)，否则系统会只打开 Egern
 */
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
    payload.action = {
      type: "openUrl",
      url: String(openUrl)
    };
  }

  if (ctx && typeof ctx.notify === "function") {
    try {
      return ctx.notify(payload);
    } catch (e) {
      log("ctx.notify 失败: " + (e && e.message ? e.message : e));
    }
  }

  // 无 ctx.notify 时尽量带 open-url（部分运行时支持）
  if (typeof $notification !== "undefined" && $notification.post) {
    try {
      if (openUrl && /^https?:\/\//i.test(String(openUrl))) {
        $notification.post(title, subtitle, body, {
          "open-url": String(openUrl),
          openUrl: String(openUrl),
          url: String(openUrl)
        });
      } else {
        $notification.post(title, subtitle, body);
      }
    } catch (e1) {
      try {
        $notification.post(title, subtitle, body);
      } catch (_) {}
    }
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

function buildBody(news, tip, maxNews) {
  const all = Array.isArray(news) ? news : [];
  const list = maxNews > 0 ? all.slice(0, maxNews) : all.slice();
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

/** 规范成可打开的 https 图片 URL */
function normalizeHttpsImageUrl(url) {
  if (!url) return "";
  var u = String(url).trim();
  if (!u) return "";
  // 协议相对
  if (u.indexOf("//") === 0) u = "https:" + u;
  // 缺协议
  if (!/^https?:\/\//i.test(u)) {
    if (/^[a-z0-9.-]+\//i.test(u)) u = "https://" + u;
    else return "";
  }
  // 强制 https，减少 ATS/拦截问题
  u = u.replace(/^http:\/\//i, "https://");
  // 排除已知不可用跳转
  if (/file\.alapi\.cn/i.test(u)) return "";
  if (/wsrv\.nl|images\.weserv\.nl/i.test(u)) return "";
  if (/^data:/i.test(u)) return "";
  return u;
}

function resolveOpenUrl(mode, image) {
  const m = (mode || "image").toLowerCase();
  if (m === "none" || m === "off" || m === "false") return "";
  return normalizeHttpsImageUrl(image);
}

/** 当日 viki 海报兜底（形如 .../static/images/YYYY-MM-DD.png） */
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
    const json = await load60s(ctx, apiUrl);
    const data = json.data || {};
    const date = data.date || "";
    const news = data.news || [];
    const tip = data.tip || "";
    const image = data.image || data.cover || "";
    const dow = data.day_of_week || "";
    const lunar = data.lunar_date || "";

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

    // 点击目标：优先接口 image，其次按日期拼 viki 海报 CDN
    var openUrl = "";
    if (openMode === "image") {
      openUrl = resolveOpenUrl("image", image);
      if (!openUrl) {
        openUrl = resolveOpenUrl("image", vikiPosterByDate(date));
        if (openUrl) log("使用日期拼装海报: " + openUrl);
      }
    }

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
    else if (openMode === "image") log("无可用 https 海报，点击将只打开 Egern");

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
