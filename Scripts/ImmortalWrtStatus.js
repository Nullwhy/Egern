/**
 * ====================================================================
 * 🖥️ Server Monitor Widget Pro (统一 UI 版 - 仪表盘进度条)
 * ====================================================================
 * 
 * 📋 环境变量说明
 * ─────────────────────────────────────────────────────────────────────
 * 【必填项】
 *   SERVER_HOST        服务器 IP 或域名（IPv4/IPv6 均可）
 *                      示例: 123.45.67.89 或 example.com
 * 
 * 【SSH 连接 - 密码认证】
 *   SERVER_PORT        SSH 端口，默认 22
 *   SERVER_USER        SSH 用户名，默认 root
 *   SERVER_PASSWORD    SSH 密码（与 SERVER_KEY 二选一）
 * 
 * 【SSH 连接 - 密钥认证】
 *   SERVER_KEY         SSH 私钥内容（PKCS#1 格式）
 *                      支持两种格式：
 *                      1. 完整格式（含 -----BEGIN RSA PRIVATE KEY----- 等）
 *                      2. 已去掉换行的纯 Base64 字符串（会自动补全格式）
 *                      注意：与 SERVER_PASSWORD 二选一，私钥优先级更高
 * 
 * 【显示设置】
 *   WIDGET_NAME        小组件显示名称，默认 'My Node'
 *                      如未设置则显示服务器 hostname
 *   MASK_IP            是否掩码 IP 地址，默认 true
 *                      IPv4 显示为: 123.45.*.*
 *                      IPv6 显示为: 2001:db8:****:****
 * 
 * 【流量统计 - 通用配置】
 *   TRAFFIC_LIMIT      月流量限额（单位 GB），默认 2000
 *                      用于计算流量使用百分比
 *   RESET_DAY          流量重置日期（每月几号），默认 1
 *                      用于显示下次重置时间
 * 
 * 【ImmortalWrt WAN 流量】
 *   WAN_INTERFACE      WAN 网口名（可选），如 pppoe-wan、wan、eth1
 *                      留空时自动识别默认路由网口；多拨/策略路由建议显式填写
 *   流量仅统计 WAN，避免 LAN 内部转发被重复计入；未安装 vnstat 时为开机累计值
 *   如需按自然月准确统计，可在 ImmortalWrt 安装并启用 vnstat：
 *     opkg update && opkg install vnstat2 luci-app-vnstat
 * 
 * ─────────────────────────────────────────────────────────────────────
 * 💡 配置示例
 * ─────────────────────────────────────────────────────────────────────
 * 【密钥认证】
 *   SERVER_HOST=example.com
 *   SERVER_PORT=22
 *   SERVER_USER=root
 *   SERVER_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----"
 *   WIDGET_NAME=我的节点
 *   TRAFFIC_LIMIT=2500
 *   RESET_DAY=12
 * 
 * 【密钥认证 - 压缩格式】
 *   SERVER_KEY="MIIEpAIBAAKCAQ..."（纯 Base64，会自动补全格式）
 * 
 * 【PPPoE 示例】
 *   SERVER_HOST=192.168.1.1
 *   SERVER_PASSWORD=你的路由器 SSH 密码
 *   WAN_INTERFACE=pppoe-wan
 * 
 * 【禁用 IP 掩码】
 *   MASK_IP=false
 * ─────────────────────────────────────────────────────────────────────
 */
export default async function (ctx) {
  const env = ctx.env || {}; 
  
  const SERVER_CONFIG = {
    widgetName: env.WIDGET_NAME || 'My Node',
    host: env.SERVER_HOST || '',
    port: Number(env.SERVER_PORT) || 22,
    username: env.SERVER_USER || 'root',
    password: env.SERVER_PASSWORD || '',
    privateKey: env.SERVER_KEY || '', 
    maskIp: env.MASK_IP !== undefined ? String(env.MASK_IP) === 'true' : true,
    
    trafficLimitGB: Number(env.TRAFFIC_LIMIT) || 2000,
    resetDay: Number(env.RESET_DAY) || 1,
    // 留空时自动识别默认路由对应的 WAN 网口；PPPoE 常见为 pppoe-wan
    wanInterface: /^[A-Za-z0-9_.:-]+$/.test(env.WAN_INTERFACE || '') ? env.WAN_INTERFACE : ''
  };

  const C = {
    bg: { light: '#FFFFFF', dark: '#121212' },       
    barBg: { light: '#0000001A', dark: '#FFFFFF22' },
    text: { light: '#1C1C1E', dark: '#FFFFFF' },     
    dim: { light: '#8E8E93', dark: '#8E8E93' },      
    cpu: { light: '#007AFF', dark: '#0A84FF' },      
    mem: { light: '#AF52DE', dark: '#BF5AF2' },      
    disk: { light: '#FF9500', dark: '#FF9F0A' },     
    netRx: { light: '#34C759', dark: '#30D158' },    
    netTx: { light: '#5856D6', dark: '#5E5CE6' },    
    error: { light: '#FF3B30', dark: '#FF453A' },
  };

  const maskIP = (ip) => {
    if (!ip || !SERVER_CONFIG.maskIp) return ip;
    if (ip.includes('.')) {
      const parts = ip.split('.');
      if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
    } else if (ip.includes(':')) {
      const parts = ip.split(':');
      if (parts.length > 2) return `${parts[0]}:${parts[1]}:****:****`;
    }
    return ip;
  };

  const getTrafficColor = (pct) => {
    if (pct >= 85) return { light: '#FF3B30', dark: '#FF453A' }; 
    if (pct >= 60) return { light: '#FF9500', dark: '#FF9F0A' }; 
    return { light: '#34C759', dark: '#30D158' };                
  };

  const fmtBytes = (b) => {
    if (b >= 1024 ** 4) return (b / 1024 ** 4).toFixed(2) + 'T';
    if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(2) + 'G';
    if (b >= 1024 ** 2) return (b / 1024 ** 2).toFixed(1) + 'M';
    if (b >= 1024)      return (b / 1024).toFixed(0) + 'K';
    return Math.round(b) + 'B';
  };

  const getNextResetDate = (resetDay) => {
    const now = new Date();
    let y = now.getFullYear(), m = now.getMonth();
    if (now.getDate() >= resetDay) m += 1; 
    if (m > 11) { m = 0; y += 1; }
    return `${m + 1}月${resetDay}日 00:00`;
  };

  let d;
  try {
    const { host, port, username, password, privateKey, widgetName, trafficLimitGB, resetDay, wanInterface } = SERVER_CONFIG;
    if (!host) throw new Error('未配置 SERVER_HOST 环境变量');

    let finalKey = privateKey;
    if (privateKey && typeof privateKey === 'string') {
        const raw = privateKey.trim();
        const headerMatch = raw.match(/-----BEGIN [A-Z ]+-----/);
        const footerMatch = raw.match(/-----END [A-Z ]+-----/);
        if (headerMatch && footerMatch) {
            const header = headerMatch[0];
            const footer = footerMatch[0];
            let body = raw.substring(raw.indexOf(header) + header.length, raw.indexOf(footer));
            body = body.replace(/\s+/g, '');
            const lines = body.match(/.{1,64}/g) || [];
            finalKey = `${header}\n${lines.join('\n')}\n${footer}`;
        } else {
            finalKey = raw.replace(/\\n/g, '\n');
        }
    }


    const session = await ctx.ssh.connect({
      host, port: Number(port || 22), username,
      ...(finalKey ? { privateKey: finalKey } : { password }),
      timeout: 8000,
    });

    const SEP = '<<SEP>>';
    // BusyBox/OpenWrt：内存应扣除 SReclaimable；磁盘以可写 overlay 为准。
    // 流量只取 WAN，避免将 LAN 内部转发流量计入套餐。
    const wanIfExpr = wanInterface
      ? `printf '%s' '${wanInterface}'`
      : "ip route show default 2>/dev/null | awk 'NR==1{print $5}'";
    const cmds = [
      'hostname 2>/dev/null || cat /proc/sys/kernel/hostname',
      'cat /proc/loadavg',
      'cat /proc/uptime',
      'head -1 /proc/stat',
      "awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}END{print t,a}' /proc/meminfo",
      // BusyBox df 不支持 GNU 的 -B1，统一转换其 1K-block 输出为字节。
      "df -k 2>/dev/null | awk '$6==\"/overlay\"{print $2*1024, $3*1024, $5; found=1; exit} END{if(!found) exit 1}' || df -k / | awk 'NR==2{print $2*1024, $3*1024, $5}'",
      'grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 1',
      `${wanIfExpr} | xargs -r -I{} awk -F: -v iface='{}' '{name=$1; gsub(/[[:space:]]/, \"\", name); if(name==iface) {data=$2; gsub(/^[[:space:]]+/, \"\", data); split(data, values, /[[:space:]]+/); print values[1], values[9]; found=1}} END{if(!found) print \"0 0\"}' /proc/net/dev`,
      'vnstat --json -m 1 2>/dev/null || echo ""',
      wanIfExpr,
    ];
    const { stdout } = await session.exec(cmds.join(` && echo '${SEP}' && `));
    await session.close();

    const p = stdout.split(SEP).map(s => s.trim());
    const hostname = widgetName !== 'My Node' ? widgetName : (p[0] || 'Server');
    const load = (p[1] || '0 0 0').split(' ').slice(0, 3);
    const upSec = parseFloat((p[2] || '0').split(' ')[0]);
    const upDays = Math.floor(upSec / 86400);
    const upHours = Math.floor((upSec % 86400) / 3600);
    const upMins = Math.floor((upSec % 3600) / 60);
    const uptime = upDays > 0 ? `${upDays}天 ${upHours}小时` : `${upHours}小时 ${upMins}分`;

    const cpuNums = (p[3] || '').replace(/^cpu\s+/, '').split(/\s+/).map(Number);
    const cpuTotal = cpuNums.reduce((a, b) => a + b, 0);
    const cpuIdle = cpuNums[3] || 0;
    const prevCpu = ctx.storage.getJSON('_cpu');
    let cpuPct = 0;
    if (prevCpu && cpuTotal > prevCpu.t) {
      cpuPct = Math.round(((cpuTotal - prevCpu.t - (cpuIdle - prevCpu.i)) / (cpuTotal - prevCpu.t)) * 100);
    }
    ctx.storage.setJSON('_cpu', { t: cpuTotal, i: cpuIdle });
    cpuPct = Math.max(0, Math.min(100, cpuPct));
    
    const memKB = (p[4] || '0 0').split(' ').map(Number);
    const memTotal = memKB[0] * 1024 || 1;
    const memAvailable = memKB[1] * 1024 || 0;
    const memUsed = Math.max(0, memTotal - memAvailable);
    const memPct = Math.min(100, Math.round((memUsed / memTotal) * 100));

    const df = (p[5] || '').split(/\s+/);
    const diskTotal = Number(df[1]) || 1, diskUsed = Number(df[2]) || 0;
    const diskPct = parseInt(df[4]) || 0;
    const cores = parseInt(p[6]) || 1;

    const ipInfo = maskIP(host);

    const nn = (p[7] || '0 0').split(' ');
    const netRx = Number(nn[0]) || 0, netTx = Number(nn[1]) || 0;
    const detectedWan = p[9] || wanInterface || 'WAN';
    ctx.storage.setJSON('_net', { rx: netRx, tx: netTx, ts: Date.now() });

    // 流量统计：优先 vnstat（按月），回退到 /proc/net/dev（开机累计）
    let tfRx = 0, tfTx = 0, tfUsed = 0, tfTotal = 1, tfPct = 0, tfReset = '';
    let tfSource = '累计';

    if (p[8]) {
      try {
        const vn = JSON.parse(p[8]);
        const iface = vn.interfaces && vn.interfaces[0];
        const monthArr = iface && iface.traffic && iface.traffic.month;
        if (monthArr && monthArr[0]) {
          tfRx = Number(monthArr[0].rx) || 0;
          tfTx = Number(monthArr[0].tx) || 0;
          tfSource = 'vnstat';
        }
      } catch (e) { /* vnstat 解析失败，回退 */ }
    }

    if (tfSource === '累计') {
      tfRx = netRx;
      tfTx = netTx;
    }

    tfUsed = tfRx + tfTx;
    tfTotal = trafficLimitGB * (1024 ** 3);
    tfPct = Math.min((tfUsed / tfTotal) * 100, 100) || 0;
    tfReset = getNextResetDate(resetDay);

    const dNow = new Date();
    const timeStr = `${String(dNow.getHours()).padStart(2, '0')}:${String(dNow.getMinutes()).padStart(2, '0')}:${String(dNow.getSeconds()).padStart(2, '0')}`;

    d = {
      hostname, uptime, load, cpuPct, cores,
      memTotal, memUsed, memPct, diskTotal, diskUsed, diskPct,
      netRx, netTx,
      tfRx, tfTx, tfUsed, tfTotal, tfPct, tfReset, timeStr, ipInfo, tfSource, detectedWan
    };
  } catch (e) {
    d = { error: String(e.message || e) };
  }

  const bar = (pct, color, h = 6) => {
    const segCount = 24; 
    const activeCount = Math.round((Math.max(0, Math.min(100, pct)) / 100) * segCount);
    return {
      type: 'stack', direction: 'row', height: h, gap: 1.5, 
      children: Array.from({ length: segCount }).map((_, i) => {
        const isActive = i < activeCount;
        const op = isActive ? (0.4 + 0.6 * (i / Math.max(activeCount - 1, 1))) : 1;
        return { type: 'stack', flex: 1, height: h, borderRadius: 1, backgroundColor: isActive ? color : C.barBg, opacity: op };
      })
    };
  };

  const divider = { type: 'stack', height: 1, backgroundColor: C.barBg, children: [{ type: 'spacer' }] };

  const header = () => ({
    type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [
      { type: 'image', src: 'sf-symbol:server.rack', color: C.text, width: 14, height: 14 },
      { type: 'text', text: d.hostname, font: { size: 'headline', weight: 'bold' }, textColor: C.text, maxLines: 1, minScale: 0.6 },
      { type: 'spacer' },
      { type: 'text', text: d.uptime, font: { size: 10, weight: 'medium' }, textColor: C.dim, maxLines: 1, minScale: 0.8 },
    ],
  });

  const footer = {
    type: 'stack', direction: 'row', alignItems: 'center', children: [
      { type: 'image', src: 'sf-symbol:arrow.triangle.2.circlepath', color: C.dim, width: 9, height: 9 },
      { type: 'text', text: ` 刷新于 ${d.timeStr}`, font: { size: 9, weight: 'medium' }, textColor: C.dim },
      { type: 'spacer' },
      { type: 'image', src: 'sf-symbol:calendar', color: C.dim, width: 9, height: 9 },
      { type: 'text', text: ` 流量重置: ${d.tfReset}`, font: { size: 9, family: 'Menlo' }, textColor: C.dim },
    ],
  };

  if (d.error) {
    return {
      type: 'widget', padding: [14, 16], gap: 8, backgroundColor: C.bg,
      children: [
        { type: 'text', text: '⚠️ Connection Failed', font: { size: 'headline', weight: 'bold' }, textColor: C.error },
        { type: 'text', text: d.error, font: { size: 'caption1' }, textColor: C.dim, maxLines: 3 },
      ],
    };
  }

  if (ctx.widgetFamily === 'systemSmall') {
    return {
      type: 'widget', backgroundColor: C.bg, padding: [12, 16], gap: 5, 
      children: [
        { type: 'stack', direction: 'column', gap: 1, children: [
          { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [
            { type: 'image', src: 'sf-symbol:server.rack', color: C.text, width: 12, height: 12 },
            { type: 'text', text: d.hostname, font: { size: 'subheadline', weight: 'bold' }, textColor: C.text, maxLines: 1 },
          ]},
          { type: 'text', text: d.ipInfo, font: { size: 9, family: 'Menlo', weight: 'bold' }, textColor: C.text },
        ]},
        { type: 'spacer', length: 2 },
        ...[
          { ic: 'cpu', lb: 'CPU', pt: d.cpuPct, v: `${d.cpuPct}%`, c: C.cpu },
          { ic: 'memorychip', lb: 'MEM', pt: d.memPct, v: `${d.memPct}%`, c: C.mem },
          { ic: 'antenna.radiowaves.left.and.right', lb: 'TRAF', pt: d.tfPct, v: `${d.tfPct.toFixed(0)}%`, c: getTrafficColor(d.tfPct) }
        ].map(i => ({
          type: 'stack', direction: 'column', gap: 3, children: [
            { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [
              { type: 'image', src: `sf-symbol:${i.ic}`, color: i.c, width: 10, height: 10 },
              { type: 'text', text: i.lb, font: { size: 10, weight: 'bold' }, textColor: C.text },
              { type: 'spacer' },
              { type: 'text', text: i.v, font: { size: 10, weight: 'heavy', family: 'Menlo' }, textColor: i.c },
            ]},
            bar(i.pt, i.c, 5),
          ]
        }))
      ],
    };
  }

  if (ctx.widgetFamily === 'systemMedium') {
    return {
      type: 'widget', backgroundColor: C.bg, padding: [12, 16], 
      children: [
        header(),
        { type: 'spacer' },
        { type: 'stack', direction: 'column', gap: 6, children: [
          { type: 'stack', direction: 'column', gap: 3, children: [
            { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [
              { type: 'image', src: 'sf-symbol:cpu', color: C.cpu, width: 11, height: 11 },
              { type: 'text', text: `CPU ${d.cores}C`, font: { size: 11, weight: 'bold' }, textColor: C.text },
              { type: 'text', text: `${d.cpuPct}%`, font: { size: 11, weight: 'heavy', family: 'Menlo' }, textColor: C.cpu },
              { type: 'text', text: ` ${d.load[0]}`, font: { size: 10, family: 'Menlo' }, textColor: C.dim },
              { type: 'spacer' },
              { type: 'image', src: 'sf-symbol:network', color: C.text, width: 10, height: 10 },
              { type: 'text', text: d.ipInfo, font: { size: 10, family: 'Menlo', weight: 'bold' }, textColor: C.text },
            ]},
            bar(d.cpuPct, C.cpu, 6),
          ]},
          { type: 'stack', direction: 'column', gap: 3, children: [
            { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [
              { type: 'image', src: 'sf-symbol:memorychip', color: C.mem, width: 11, height: 11 },
              { type: 'text', text: 'MEM', font: { size: 11, weight: 'bold' }, textColor: C.text },
              { type: 'text', text: `${d.memPct}%`, font: { size: 11, weight: 'heavy', family: 'Menlo' }, textColor: C.mem },
              { type: 'spacer' },
              { type: 'text', text: `${fmtBytes(d.memUsed)} / ${fmtBytes(d.memTotal)}`, font: { size: 10, family: 'Menlo', weight: 'medium' }, textColor: C.dim },
            ]},
            bar(d.memPct, C.mem, 6),
          ]},
          { type: 'stack', direction: 'column', gap: 3, children: [
            { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [
              { type: 'image', src: 'sf-symbol:internaldrive', color: C.disk, width: 11, height: 11 },
              { type: 'text', text: 'DSK', font: { size: 11, weight: 'bold' }, textColor: C.text },
              { type: 'text', text: `${d.diskPct}%`, font: { size: 11, weight: 'heavy', family: 'Menlo' }, textColor: C.disk },
              { type: 'spacer' },
              { type: 'text', text: `${fmtBytes(d.diskUsed)} / ${fmtBytes(d.diskTotal)}`, font: { size: 10, family: 'Menlo', weight: 'medium' }, textColor: C.dim },
            ]},
            bar(d.diskPct, C.disk, 6),
          ]},
          { type: 'stack', direction: 'column', gap: 3, children: [
            { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [
              { type: 'image', src: 'sf-symbol:antenna.radiowaves.left.and.right', color: getTrafficColor(d.tfPct), width: 11, height: 11 },
              { type: 'text', text: 'TRAF', font: { size: 11, weight: 'bold' }, textColor: C.text },
              { type: 'text', text: `${d.tfPct.toFixed(1)}%`, font: { size: 11, weight: 'heavy', family: 'Menlo' }, textColor: getTrafficColor(d.tfPct) },
              { type: 'spacer' },
              { type: 'text', text: `↓${fmtBytes(d.tfRx)} ↑${fmtBytes(d.tfTx)} / ${fmtBytes(d.tfTotal)}`, font: { size: 10, family: 'Menlo', weight: 'medium' }, textColor: C.dim },
            ]},
            bar(d.tfPct, getTrafficColor(d.tfPct), 6),
          ]},
        ]},
        { type: 'spacer' },
        footer,
      ],
    };
  }

  return {
    type: 'widget', backgroundColor: C.bg, padding: [14, 16], gap: 8, 
    children: [
      header(),
      divider,
      { type: 'stack', direction: 'row', alignItems: 'center', gap: 6, children: [
        { type: 'image', src: 'sf-symbol:cpu', color: C.cpu, width: 14, height: 14 },
        { type: 'text', text: `CPU ${d.cores}C`, font: { size: 12, weight: 'bold' }, textColor: C.text },
        { type: 'text', text: `${d.cpuPct}%`, font: { size: 12, weight: 'heavy', family: 'Menlo' }, textColor: C.cpu },
        { type: 'text', text: ` ${d.load[0]}`, font: { size: 11, family: 'Menlo' }, textColor: C.dim },
        { type: 'spacer' },
        { type: 'image', src: 'sf-symbol:network', color: C.text, width: 11, height: 11 },
        { type: 'text', text: d.ipInfo, font: { size: 11, family: 'Menlo', weight: 'bold' }, textColor: C.text },
      ]},
      bar(d.cpuPct, C.cpu, 7),
      divider,
      { type: 'stack', direction: 'row', alignItems: 'center', gap: 6, children: [
        { type: 'image', src: 'sf-symbol:memorychip', color: C.mem, width: 14, height: 14 },
        { type: 'text', text: 'MEMORY', font: { size: 12, weight: 'bold' }, textColor: C.text },
        { type: 'text', text: `${d.memPct}%`, font: { size: 12, weight: 'heavy', family: 'Menlo' }, textColor: C.mem },
        { type: 'spacer' },
        { type: 'text', text: `${fmtBytes(d.memUsed)} / ${fmtBytes(d.memTotal)}`, font: { size: 11, family: 'Menlo', weight: 'medium' }, textColor: C.dim },
      ]},
      bar(d.memPct, C.mem, 7),
      divider,
      { type: 'stack', direction: 'row', alignItems: 'center', gap: 6, children: [
        { type: 'image', src: 'sf-symbol:internaldrive', color: C.disk, width: 14, height: 14 },
        { type: 'text', text: 'STORAGE', font: { size: 12, weight: 'bold' }, textColor: C.text },
        { type: 'text', text: `${d.diskPct}%`, font: { size: 12, weight: 'heavy', family: 'Menlo' }, textColor: C.disk },
        { type: 'spacer' },
        { type: 'text', text: `${fmtBytes(d.diskUsed)} / ${fmtBytes(d.diskTotal)}`, font: { size: 11, family: 'Menlo', weight: 'medium' }, textColor: C.dim },
      ]},
      bar(d.diskPct, C.disk, 7),
      divider,
      { type: 'stack', direction: 'row', alignItems: 'center', gap: 6, children: [
        { type: 'image', src: 'sf-symbol:antenna.radiowaves.left.and.right', color: getTrafficColor(d.tfPct), width: 14, height: 14 },
        { type: 'text', text: 'TRAFFIC', font: { size: 12, weight: 'bold' }, textColor: C.text },
        { type: 'text', text: `${d.tfPct.toFixed(1)}%`, font: { size: 12, weight: 'heavy', family: 'Menlo' }, textColor: getTrafficColor(d.tfPct) },
        { type: 'spacer' },
        { type: 'text', text: `↓ ${fmtBytes(d.tfRx)}  ↑ ${fmtBytes(d.tfTx)}  /  ${fmtBytes(d.tfTotal)}`, font: { size: 11, family: 'Menlo', weight: 'medium' }, textColor: C.dim },
      ]},
      bar(d.tfPct, getTrafficColor(d.tfPct), 7),
      { type: 'spacer' },
      footer,
    ],
  };
}
