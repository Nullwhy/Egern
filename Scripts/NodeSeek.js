/******************************
脚本名称: NodeSeek
Version : v1.0.4
更新时间: 2026-07-23
平台: Egern
功能: NodeSeek 每日签到
脚本作者: @Curtinp118 / @Nullwhy
使用说明:
1. 模块打开「Cookie」后访问个人页保存请求头
2. 成功后关闭「Cookie」
3. 定时或手动运行签到
*******************************/

const SCRIPT_NAME = "NodeSeek🎉";
const STORE_KEY = "nodeseek_headers";
const ATTEND_URL = "https://www.nodeseek.com/api/attendance?random=true";

const HEADER_KEYS = [
  "Connection",
  "Accept-Encoding",
  "Priority",
  "Content-Type",
  "Origin",
  "refract-sign",
  "User-Agent",
  "refract-key",
  "Sec-Fetch-Mode",
  "Cookie",
  "Host",
  "Referer",
  "Accept-Language",
  "Accept"
];

function log(msg) {
  console.log("[" + SCRIPT_NAME + "] " + msg);
}

function envBool(env, key, def) {
  if (!env || env[key] === undefined || env[key] === null || String(env[key]).trim() === "") {
    return !!def;
  }
  const v = String(env[key]).trim().toLowerCase();
  if (["1", "true", "yes", "on"].indexOf(v) !== -1) return true;
  if (["0", "false", "no", "off"].indexOf(v) !== -1) return false;
  return !!def;
}

function notify(title, subtitle, body) {
  console.log("📢 " + title + " - " + subtitle + ": " + body);
  if (typeof $notification !== "undefined" && $notification.post) {
    $notification.post(title, subtitle, body);
  }
}

function pickHeaders(src) {
  const saved = {};
  for (let i = 0; i < HEADER_KEYS.length; i++) {
    const key = HEADER_KEYS[i];
    const value =
      src[key] || src[key.toLowerCase()] || src[key.toUpperCase()];
    if (value) saved[key] = value;
  }
  return saved;
}

function buildAttendHeaders(saved) {
  return {
    Connection: saved.Connection || "keep-alive",
    "Accept-Encoding": saved["Accept-Encoding"] || "gzip, deflate, br",
    Priority: saved.Priority || "u=3, i",
    "Content-Type": saved["Content-Type"] || "text/plain;charset=UTF-8",
    Origin: saved.Origin || "https://www.nodeseek.com",
    "refract-sign": saved["refract-sign"] || "",
    "User-Agent": saved["User-Agent"] || "Mozilla/5.0",
    "refract-key": saved["refract-key"] || "",
    "Sec-Fetch-Mode": saved["Sec-Fetch-Mode"] || "cors",
    Cookie: saved.Cookie || "",
    Host: saved.Host || "www.nodeseek.com",
    Referer: saved.Referer || "https://www.nodeseek.com/",
    "Accept-Language": saved["Accept-Language"] || "zh-CN,zh-Hans;q=0.9",
    Accept: saved.Accept || "*/*"
  };
}

async function captureHeaders(ctx) {
  const env = (ctx && ctx.env) || {};
  if (!envBool(env, "ENABLE_CAPTURE", false) && !envBool(env, "CAPTURE", false)) {
    log("Cookie 开关已关闭，跳过");
    return { response: ctx.response };
  }

  log("开始保存 Cookie/请求头");
  const saved = pickHeaders(ctx.request.headers || {});
  if (Object.keys(saved).length === 0) {
    log("未获取到有效请求头");
    notify(SCRIPT_NAME, "Cookie 失败", "未获取到请求头");
    return { response: ctx.response };
  }

  await ctx.storage.set(STORE_KEY, JSON.stringify(saved));
  log("请求头已保存，共 " + Object.keys(saved).length + " 个字段");
  notify(SCRIPT_NAME, "Cookie 成功", "请求头已保存，请关闭模块「Cookie」开关");
  return { response: ctx.response };
}

async function doCheckIn(ctx) {
  log("开始执行签到任务");

  const raw = await ctx.storage.get(STORE_KEY);
  if (!raw) {
    log("未找到请求头");
    notify(SCRIPT_NAME, "缺少请求头", "请先打开 Cookie 并访问个人页面");
    return;
  }

  let savedHeaders;
  try {
    savedHeaders = JSON.parse(raw);
  } catch (e) {
    log("请求头解析失败");
    notify(SCRIPT_NAME, "数据异常", "请重新打开 Cookie 并访问个人页面");
    return;
  }

  try {
    const response = await ctx.http.post(ATTEND_URL, {
      headers: buildAttendHeaders(savedHeaders),
      body: "",
      timeout: 10000
    });

    const status = response.status;
    const body = await response.text();
    let message = "";
    try {
      message = (JSON.parse(body) || {}).message || "";
    } catch (e) {}

    if (status === 403) {
      log("签到失败: 403 风控");
      notify(SCRIPT_NAME, "被风控", "403，稍后重试");
    } else if (status === 500) {
      log("签到失败: 500");
      notify(SCRIPT_NAME, "服务器错误", "500");
    } else if (status >= 200 && status < 300) {
      log("签到成功" + (message ? ": " + message : ""));
      notify(SCRIPT_NAME, "签到成功", message || "签到完成");
    } else {
      log("签到异常 HTTP " + status);
      notify(SCRIPT_NAME, "请求异常", "HTTP " + status);
    }
  } catch (error) {
    log("网络错误: " + (error && error.message ? error.message : error));
    notify(SCRIPT_NAME, "网络错误", "请检查网络连接");
  }
}

async function main(ctx) {
  if (ctx && ctx.request !== undefined) {
    return await captureHeaders(ctx);
  }
  await doCheckIn(ctx);
}

export default main;
