/******************************
脚本名称: NodeSeek
Version : v1.1.2
更新时间: 2026-07-24
平台: Egern
功能: Cookie 捕获 + 每日签到
脚本作者: @Curtinp118 / @Nullwhy
使用说明:
1. 模块打开「Cookie」后访问个人页保存请求头
2. 成功后关闭「Cookie」
3. 定时由 Template Arguments 的 MINUTE / HOUR 控制
4. 「固定鸡腿」关=随机，开=固定 5 鸡腿
*******************************/

const SCRIPT_NAME = "NodeSeek🎉";
const STORE_KEY = "nodeseek_headers";
const ATTEND_BASE = "https://www.nodeseek.com/api/attendance";

// 捕获时按此列表挑字段；签到时用同表默认值补全
const DEFAULT_HEADERS = {
  Connection: "keep-alive",
  "Accept-Encoding": "gzip, deflate, br",
  Priority: "u=3, i",
  "Content-Type": "text/plain;charset=UTF-8",
  Origin: "https://www.nodeseek.com",
  "refract-sign": "",
  "User-Agent": "Mozilla/5.0",
  "refract-key": "",
  "Sec-Fetch-Mode": "cors",
  Cookie: "",
  Host: "www.nodeseek.com",
  Referer: "https://www.nodeseek.com/",
  "Accept-Language": "zh-CN,zh-Hans;q=0.9",
  Accept: "*/*"
};

const HEADER_KEYS = Object.keys(DEFAULT_HEADERS);

function log(msg) {
  console.log("[" + SCRIPT_NAME + "] " + msg);
}

function notify(subtitle, body) {
  log(subtitle + ": " + body);
  if (typeof $notification !== "undefined" && $notification.post) {
    $notification.post(SCRIPT_NAME, subtitle, body);
  }
}

function envTrue(env, key) {
  if (!env || env[key] == null || String(env[key]).trim() === "") return false;
  return ["1", "true", "yes", "on"].indexOf(String(env[key]).trim().toLowerCase()) !== -1;
}

function headerValue(src, key) {
  return src[key] || src[key.toLowerCase()] || src[key.toUpperCase()] || "";
}

function pickHeaders(src) {
  const saved = {};
  for (let i = 0; i < HEADER_KEYS.length; i++) {
    const key = HEADER_KEYS[i];
    const value = headerValue(src || {}, key);
    if (value) saved[key] = value;
  }
  return saved;
}

function buildAttendHeaders(saved) {
  const headers = {};
  for (let i = 0; i < HEADER_KEYS.length; i++) {
    const key = HEADER_KEYS[i];
    headers[key] = (saved && saved[key]) || DEFAULT_HEADERS[key];
  }
  return headers;
}

// 关=随机 random=true；开=固定 random=false
function attendUrl(env) {
  const fixed = envTrue(env, "FIXED_LEGS");
  return ATTEND_BASE + "?random=" + (fixed ? "false" : "true");
}

async function captureHeaders(ctx) {
  if (!envTrue((ctx && ctx.env) || {}, "ENABLE_CAPTURE")) {
    log("Cookie 开关已关闭，跳过");
    return { response: ctx.response };
  }

  const saved = pickHeaders((ctx.request && ctx.request.headers) || {});
  if (Object.keys(saved).length === 0) {
    notify("Cookie 失败", "未获取到请求头");
    return { response: ctx.response };
  }

  await ctx.storage.set(STORE_KEY, JSON.stringify(saved));
  log("请求头已保存，共 " + Object.keys(saved).length + " 个字段");
  notify("Cookie 成功", "请求头已保存，请关闭模块「Cookie」开关");
  return { response: ctx.response };
}

async function doCheckIn(ctx) {
  const env = (ctx && ctx.env) || {};
  const fixed = envTrue(env, "FIXED_LEGS");
  const url = attendUrl(env);
  log("开始执行签到任务（" + (fixed ? "固定鸡腿" : "随机鸡腿") + "）");

  const raw = await ctx.storage.get(STORE_KEY);
  if (!raw) {
    notify("缺少请求头", "请先打开 Cookie 并访问个人页面");
    return;
  }

  let saved;
  try {
    saved = JSON.parse(raw);
  } catch (e) {
    notify("数据异常", "请重新打开 Cookie 并访问个人页面");
    return;
  }

  try {
    const response = await ctx.http.post(url, {
      headers: buildAttendHeaders(saved),
      body: "",
      timeout: 10000
    });
    const status = response.status;
    const text = await response.text();
    let message = "";
    try {
      message = (JSON.parse(text) || {}).message || "";
    } catch (e) {}

    const modeTag = fixed ? "固定" : "随机";
    if (status === 403) {
      notify("被风控", "403，稍后重试");
    } else if (status === 500) {
      notify("服务器错误", "500");
    } else if (status >= 200 && status < 300) {
      notify("签到成功（" + modeTag + "）", message || "签到完成");
    } else {
      notify("请求异常", "HTTP " + status);
    }
  } catch (error) {
    notify("网络错误", "请检查网络连接");
    log(error && error.message ? error.message : String(error));
  }
}

async function main(ctx) {
  const env = (ctx && ctx.env) || {};
  if (String(env.MODE || "").toLowerCase() === "checkin") {
    await doCheckIn(ctx);
    return;
  }
  if (ctx && ctx.request && (ctx.request.url || ctx.request.headers)) {
    return await captureHeaders(ctx);
  }
  await doCheckIn(ctx);
}

export default main;
