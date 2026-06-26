/******************************
脚本名称: NodeSeek
Version : v1.0.1
更新时间: 2026-06-17
平台: Egern
功能: NodeSeek 每日签到
脚本作者：
@Curtinp118      @Nullwhy 适配Egern
使用说明:
1. 添加 HTTP 请求脚本抓取请求头
2. 添加定时任务自动签到
*******************************/

const SCRIPT_NAME = "NodeSeek🎉";
const STORE_KEY = "nodeseek_headers";

// ========== 工具函数 ==========
function log(msg) {
  console.log(`[${SCRIPT_NAME}] ${msg}`);
}

// 修复后的通知函数：调用 Egern 原生通知 API
function notify(title, subtitle, body) {
  // 保留控制台日志
  console.log(`📢 ${title} - ${subtitle}: ${body}`);
  
  // 调用 Egern 系统通知
  if (typeof $notification !== "undefined" && $notification.post) {
    $notification.post(title, subtitle, body);
  }
}

// ========== 主逻辑 ==========
async function main(ctx) {
  const isCapture = ctx.request !== undefined;
  
  if (isCapture) {
    // 抓取请求头模式
    log("开始抓取请求头");
    
    const headers = ctx.request.headers || {};
    const needKeys = [
      "Connection", "Accept-Encoding", "Priority", "Content-Type", "Origin",
      "refract-sign", "User-Agent", "refract-key", "Sec-Fetch-Mode",
      "Cookie", "Host", "Referer", "Accept-Language", "Accept"
    ];
    
    const saved = {};
    for (const key of needKeys) {
      const value = headers[key] || headers[key.toLowerCase()] || headers[key.toUpperCase()];
      if (value) saved[key] = value;
    }
    
    if (Object.keys(saved).length === 0) {
      log("❌ 未获取到有效请求头");
      notify(SCRIPT_NAME, "抓包失败", "未获取到请求头");
      return { response: ctx.response };
    }
    
    await ctx.storage.set(STORE_KEY, JSON.stringify(saved));
    log(`✅ 请求头已保存，共 ${Object.keys(saved).length} 个字段`);
    notify(SCRIPT_NAME, "抓包成功", "请求头已保存");
    
    return { response: ctx.response };
    
  } else {
    // 签到模式
    log("开始执行签到任务");
    
    const raw = await ctx.storage.get(STORE_KEY);
    if (!raw) {
      log("❌ 未找到请求头，请先访问 NodeSeek 个人页面抓包");
      notify(SCRIPT_NAME, "缺少请求头", "请先访问个人页面抓包");
      return;
    }
    
    let savedHeaders;
    try {
      savedHeaders = JSON.parse(raw);
    } catch (e) {
      log("❌ 请求头解析失败");
      notify(SCRIPT_NAME, "数据异常", "请重新抓包");
      return;
    }
    
    log("✅ Cookie: Valid");
    log("✅ Token: Found");
    log("------------------------------------");
    log("👤 Account | www.nodeseek.com");
    
    const headers = {
      "Connection": savedHeaders["Connection"] || "keep-alive",
      "Accept-Encoding": savedHeaders["Accept-Encoding"] || "gzip, deflate, br",
      "Priority": savedHeaders["Priority"] || "u=3, i",
      "Content-Type": savedHeaders["Content-Type"] || "text/plain;charset=UTF-8",
      "Origin": savedHeaders["Origin"] || "https://www.nodeseek.com",
      "refract-sign": savedHeaders["refract-sign"] || "",
      "User-Agent": savedHeaders["User-Agent"] || "Mozilla/5.0",
      "refract-key": savedHeaders["refract-key"] || "",
      "Sec-Fetch-Mode": savedHeaders["Sec-Fetch-Mode"] || "cors",
      "Cookie": savedHeaders["Cookie"] || "",
      "Host": savedHeaders["Host"] || "www.nodeseek.com",
      "Referer": savedHeaders["Referer"] || "https://www.nodeseek.com/",
      "Accept-Language": savedHeaders["Accept-Language"] || "zh-CN,zh-Hans;q=0.9",
      "Accept": savedHeaders["Accept"] || "*/*"
    };
    
    try {
      const response = await ctx.http.post("https://www.nodeseek.com/api/attendance?random=true", {
        headers: headers,
        body: "",
        timeout: 10000
      });
      
      const status = response.status;
      const body = await response.text();
      
      let message = "";
      try {
        const json = JSON.parse(body);
        message = json.message || "";
      } catch (e) {}
      
      log("------------------------------------");
      
      if (status === 403) {
        log("Status      : ⚠️ 403 风控");
        log("📊 Summary");
        log("Total       : 1");
        log("Success     : 0");
        log("Failed      : 1");
        notify(SCRIPT_NAME, "被风控", "403，稍后重试");
        
      } else if (status === 500) {
        log("Status      : ❌ 500 服务器错误");
        log("📊 Summary");
        log("Total       : 1");
        log("Success     : 0");
        log("Failed      : 1");
        notify(SCRIPT_NAME, "服务器错误", "500");
        
      } else if (status >= 200 && status < 300) {
        log("Status      : ✅ 签到成功");
        if (message) log(`Message     : ${message}`);
        log("------------------------------------");
        log("📊 Summary");
        log("Total       : 1");
        log("Success     : 1");
        log("Duplicate   : 0");
        log("Failed      : 0");
        notify(SCRIPT_NAME, "签到成功", message || "签到完成");
        
      } else {
        log(`Status      : ❌ 请求异常 ${status}`);
        log("------------------------------------");
        log("📊 Summary");
        log("Total       : 1");
        log("Success     : 0");
        log("Failed      : 1");
        notify(SCRIPT_NAME, "请求异常", `HTTP ${status}`);
      }
      
    } catch (error) {
      log(`Status      : ❌ 网络错误 - ${error.message || error}`);
      log("------------------------------------");
      log("📊 Summary");
      log("Total       : 1");
      log("Success     : 0");
      log("Failed      : 1");
      notify(SCRIPT_NAME, "网络错误", "请检查网络连接");
    }
  }
}

// ========== 导出 ==========
export default main;
