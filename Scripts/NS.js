/******************************
脚本名称: NodeSeek (多账号版)
Version : v2.1.0
更新时间: 2026-09-05
平台: Egern
功能: 定时签到 
脚本作者: @Nullwhy

使用说明:
1. 开启模块「Cookie」开关；
2. 在浏览器/客户端中逐个登录不同账号，并访问/刷新个人信息页（触发 /api/account/getInfo/）；
3. 脚本会自动识别用户名并追加入库，弹窗提示保存的账号名称及总数；
4. 全部账号捕获完成后，关闭「Cookie」开关；
5. 定时任务触发时。
*******************************/

const SCRIPT_NAME = "NodeSeek🎉";
const STORE_KEY_ACCOUNTS = "nodeseek_accounts_list";
const ATTEND_BASE = "https://www.nodeseek.com/api/attendance";
const INTERVAL_TIME = 13 * 1000; 

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

function attendUrl(env) {
  const fixed = envTrue(env, "FIXED_LEGS");
  return ATTEND_BASE + "?random=" + (fixed ? "false" : "true");
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function captureHeaders(ctx) {
  if (!envTrue((ctx && ctx.env) || {}, "ENABLE_CAPTURE")) {
    log("Cookie 捕获开关未开启，跳过");
    return { response: ctx.response };
  }

  const reqHeaders = pickHeaders((ctx.request && ctx.request.headers) || {});
  if (!reqHeaders.Cookie) {
    notify("Cookie 捕获失败", "未识别到有效 Cookie");
    return { response: ctx.response };
  }

  // 从接口响应体中解析用户名
  let accountName = "";
  try {
    if (ctx.response && ctx.response.body) {
      const resData = typeof ctx.response.body === "string" ? JSON.parse(ctx.response.body) : ctx.response.body;
      if (resData && resData.username) {
        accountName = resData.username;
      } else if (resData && resData.data && resData.data.username) {
        accountName = resData.data.username;
      }
    }
  } catch (e) {
    log("解析响应用户名失败: " + e.message);
  }

  // 兜底方案：取 Cookie 字符串计算 Hash 唯一标识
  if (!accountName) {
    const cookieStr = reqHeaders.Cookie;
    let hash = 0;
    for (let i = 0; i < cookieStr.length; i++) {
      hash = (hash << 5) - hash + cookieStr.charCodeAt(i);
      hash |= 0;
    }
    accountName = "Account_" + Math.abs(hash).toString(16).substring(0, 6);
  }

  let accounts = [];
  const rawStore = await ctx.storage.get(STORE_KEY_ACCOUNTS);
  if (rawStore) {
    try {
      accounts = JSON.parse(rawStore);
    } catch (e) {
      accounts = [];
    }
  }

  const index = accounts.findIndex((acc) => acc.name === accountName);
  if (index !== -1) {
    accounts[index].headers = reqHeaders;
    accounts[index].updatedAt = new Date().toLocaleString();
    log(`更新账号 [${accountName}] 的请求头信息`);
  } else {
    accounts.push({
      name: accountName,
      headers: reqHeaders,
      updatedAt: new Date().toLocaleString()
    });
    log(`新增账号 [${accountName}] 的请求头信息`);
  }

  await ctx.storage.set(STORE_KEY_ACCOUNTS, JSON.stringify(accounts));
  notify("Cookie 捕获成功", `账号：[${accountName}]\n当前已保存 ${accounts.length} 个账号`);

  return { response: ctx.response };
}

async function doCheckIn(ctx) {
  const env = (ctx && ctx.env) || {};
  const fixed = envTrue(env, "FIXED_LEGS");
  const url = attendUrl(env);

  const rawStore = await ctx.storage.get(STORE_KEY_ACCOUNTS);
  if (!rawStore) {
    notify("签到失败", "未找到任何保存的账号数据，请先开启 Cookie 捕获");
    return;
  }

  let accounts = [];
  try {
    accounts = JSON.parse(rawStore);
  } catch (e) {
    notify("数据异常", "账号存储数据格式错误，请重新捕获 Cookie");
  }

  if (accounts.length === 0) {
    notify("签到失败", "账号列表为空，请先捕获账号");
    return;
  }

  log(`开始批量签到任务，共 ${accounts.length} 个账号（${fixed ? "固定鸡腿" : "随机鸡腿"}），间隔 13 秒`);

  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    log(`正在处理第 ${i + 1}/${accounts.length} 个账号: [${acc.name}]`);

    try {
      const response = await ctx.http.post(url, {
        headers: buildAttendHeaders(acc.headers),
        body: "",
        timeout: 10000
      });

      const status = response.status;
      const text = await response.text();
      let message = "";
      try {
        message = (JSON.parse(text) || {}).message || "";
      } catch (e) {}

      if (status === 403) {
        results.push(`❌ [${acc.name}]: 403 被风控`);
      } else if (status === 500) {
        results.push(`❌ [${acc.name}]: 500 服务器错误`);
      } else if (status >= 200 && status < 300) {
        results.push(`✅ [${acc.name}]: ${message || "签到成功"}`);
      } else {
        results.push(`⚠️ [${acc.name}]: HTTP ${status}`);
      }
    } catch (error) {
      results.push(`❌ [${acc.name}]: 网络错误`);
      log(`账号 [${acc.name}] 请求异常: ` + (error && error.message ? error.message : String(error)));
    }

    if (i < accounts.length - 1) {
      log(`等待 13 秒后执行下一个账号签到...`);
      await delay(INTERVAL_TIME);
    }
  }

  const modeTag = fixed ? "固定" : "随机";
  notify(`批量签到完成 (${modeTag})`, results.join("\n"));
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
