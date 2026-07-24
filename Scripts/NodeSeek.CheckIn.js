/******************************
脚本名称: NodeSeek 签到
Version : v1.2.0
更新时间: 2026-07-24
平台: Egern
功能: 定时签到（由 schedule 到点调用一次）
说明: 请求头由 NodeSeek.js（Cookie）写入 storage key: nodeseek_headers
*******************************/

const SCRIPT_NAME = "NodeSeek🎉";
const STORE_KEY = "nodeseek_headers";
const ATTEND_URL = "https://www.nodeseek.com/api/attendance?random=true";

function log(msg) {
  console.log("[" + SCRIPT_NAME + "] " + msg);
}

function notify(title, subtitle, body) {
  console.log("📢 " + title + " - " + subtitle + ": " + body);
  if (typeof $notification !== "undefined" && $notification.post) {
    $notification.post(title, subtitle, body);
  }
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

async function main(ctx) {
  log("签到开始");

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

export default main;
