/******************************
脚本名称: NodeSeek 签到
Version : v1.1.0
更新时间: 2026-07-24
平台: Egern
功能: 定时/手动签到
说明:
- Cookie 由 NodeSeek.js 写入 storage: nodeseek_headers
- 自定义时间：读 env.HOUR / env.MINUTE（模块参数传入）
- schedule 使用高频 cron，由脚本判断是否到达设定时刻（绕过模块 cron 参数不生效）
*******************************/

const SCRIPT_NAME = "NodeSeek🎉";
const STORE_KEY = "nodeseek_headers";
const ATTEND_URL = "https://www.nodeseek.com/api/attendance?random=true";
const FIRE_KEY_PREFIX = "nodeseek_fired_";

function log(msg) {
  console.log("[" + SCRIPT_NAME + "] " + msg);
}

function notify(title, subtitle, body) {
  console.log("📢 " + title + " - " + subtitle + ": " + body);
  if (typeof $notification !== "undefined" && $notification.post) {
    $notification.post(title, subtitle, body);
  }
}

function getEnv(env, names, fallback) {
  if (fallback === undefined) fallback = "";
  for (var i = 0; i < names.length; i++) {
    var value = env && env[names[i]];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return fallback;
}

function pad2(n) {
  n = String(n);
  return n.length >= 2 ? n : ("0" + n).slice(-2);
}

function parseHourMinute(env) {
  var h = parseInt(getEnv(env, ["HOUR", "hour"], "10"), 10);
  var m = parseInt(getEnv(env, ["MINUTE", "minute"], "0"), 10);
  if (!Number.isFinite(h) || h < 0 || h > 23) h = 10;
  if (!Number.isFinite(m) || m < 0 || m > 59) m = 0;
  return { hour: h, minute: m };
}

function localDateKey(d) {
  return (
    d.getFullYear() +
    "-" +
    pad2(d.getMonth() + 1) +
    "-" +
    pad2(d.getDate())
  );
}

/**
 * 是否应在本轮 schedule 执行签到
 * - FORCE=true / 手动：始终执行
 * - 否则：当前本地时分 == 设定时分，且今日未因定时触发过
 */
async function shouldRunNow(ctx, env) {
  var force = getEnv(env, ["FORCE", "force", "MANUAL"], "");
  if (["1", "true", "yes", "on"].indexOf(String(force).toLowerCase()) !== -1) {
    log("FORCE/手动，跳过时间门控");
    return true;
  }

  // generic 手动：无 cron 上下文时也直接跑（部分环境）
  // 若 env 带 RUN_ALWAYS
  if (["1", "true"].indexOf(getEnv(env, ["RUN_ALWAYS"], "").toLowerCase()) !== -1) {
    return true;
  }

  var t = parseHourMinute(env);
  var now = new Date();
  var nh = now.getHours();
  var nm = now.getMinutes();
  log(
    "时间门控 设定=" +
      pad2(t.hour) +
      ":" +
      pad2(t.minute) +
      " 现在=" +
      pad2(nh) +
      ":" +
      pad2(nm)
  );

  if (nh !== t.hour || nm !== t.minute) {
    log("未到设定时刻，本轮跳过");
    return false;
  }

  var day = localDateKey(now);
  var fireKey = FIRE_KEY_PREFIX + day;
  try {
    var fired = await ctx.storage.get(fireKey);
    if (fired === "1" || fired === "true") {
      log("今日定时已执行过，跳过");
      return false;
    }
  } catch (e) {
    log("读取 fireKey 失败: " + (e && e.message ? e.message : e));
  }

  try {
    await ctx.storage.set(fireKey, "1");
  } catch (e) {
    log("写入 fireKey 失败: " + (e && e.message ? e.message : e));
  }
  return true;
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

async function doCheckIn(ctx) {
  log("开始签到");
  const raw = await ctx.storage.get(STORE_KEY);
  if (!raw) {
    log("未找到请求头");
    notify(SCRIPT_NAME, "缺少请求头", "请先打开 Cookie 并访问个人页面");
    return;
  }

  var savedHeaders;
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
    var message = "";
    try {
      message = (JSON.parse(body) || {}).message || "";
    } catch (e) {}

    if (status === 403) {
      log("签到失败: 403");
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
  const env = (ctx && ctx.env) || {};
  log("CheckIn v1.1.0 启动");

  var ok = await shouldRunNow(ctx, env);
  if (!ok) return;

  await doCheckIn(ctx);
}

export default main;
