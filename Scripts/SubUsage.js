/******************************
脚本名称: Sub Usage
Version : v1.0.0
更新时间: 2026-07-07
平台: Egern
功能: 机场流量用量监控
脚本作者：
部分代码参考@Harley_Luv0214    @Nullwhy
使用说明:
## 单订阅配置
只显示一个订阅时，推荐使用这组参数：
URL=你的订阅链接
NAME=显示名称
RESET=1
PROTOCOL=VLESS
REFRESH_MINUTES=15
### 参数含义
| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `URL` | 订阅链接，用来读取流量信息。 |
| `NAME` | 小组件里显示的机场/订阅名称，不填默认 `Sub 1`。 |
| `RESET` | 每月几号重置流量，例如 `1` 表示每月 1 号。脚本无法自动识别重置日。 |
| `PROTOCOL` | 仅作为显示标签，例如 `VLESS`、`Trojan`、`Mixed`，不影响订阅解析。 |
| `REFRESH_MINUTES` | 否 | 小组件刷新间隔，单位分钟，默认 `15`。 |
## 多订阅配置
最多支持 3 个订阅。
### 多订阅参数含义
| 参数 | 说明 |
| --- | --- |
| `URL1` / `URL2` / `URL3` | 第 1/2/3 个订阅链接。 |
| `NAME1` / `NAME2` / `NAME3` | 第 1/2/3 个显示名称。 |
| `RESET1` / `RESET2` / `RESET3` | 第 1/2/3 个每月重置日。 |
| `PROTOCOL1` / `PROTOCOL2` / `PROTOCOL3` | 第 1/2/3 个显示标签。 |
| `SHOW` | 控制显示哪些订阅，例如 `SHOW=1,3` 只显示第 1 和第 3 个。 |
| `REFRESH_MINUTES` | 刷新间隔，默认 `15` 分钟。 |

## SHOW 显示规则
例如 `SHOW=1,3` 表示只显示第 1 和第 3 个订阅。
不填 `SHOW` 时默认按顺序显示：
| 小组件尺寸 | 默认显示数量 |
| --- | --- |
| 小号 | 1 个订阅 |
| 中号 | 最多 2 个订阅 |
| 大号 | 最多 3 个订阅 |
*******************************/
const DEFAULT_REFRESH_MINUTES = 15;
const MAX_ACCOUNTS = 3;

export default async function (ctx = {}) {
  const family = normalizeFamily(ctx.widgetFamily);
  const refreshAfter = new Date(Date.now() + refreshMinutes(ctx) * 60 * 1000).toISOString();
  const accounts = collectAccounts(ctx, MAX_ACCOUNTS).slice(0, limitForFamily(family));

  if (!accounts.length) {
    return renderEmpty(family, refreshAfter);
  }

  const results = await Promise.all(accounts.map((account) => loadTraffic(ctx, account)));

  if (family === "accessoryInline") {
    return {
      type: "widget",
      children: [{ type: "text", text: inlineText(results) }],
    };
  }

  if (family === "accessoryCircular") {
    const item = results[0];
    return {
      type: "widget",
      padding: 4,
      children: [
        { type: "spacer" },
        { type: "text", text: percent(item.used, item.total), font: { size: "title2", weight: "bold" }, textAlign: "center" },
        { type: "text", text: item.name || "Traffic", font: { size: "caption2", weight: "medium" }, textAlign: "center", opacity: 0.7, maxLines: 1 },
        { type: "spacer" },
      ],
    };
  }

  if (family === "accessoryRectangular") {
    return renderAccessoryRectangular(results);
  }

  return renderWidget(family, results, refreshAfter);
}

function normalizeFamily(value) {
  return String(value || "systemMedium");
}

function limitForFamily(family) {
  if (family === "systemSmall" || family.startsWith("accessory")) return 1;
  if (family === "systemMedium") return 2;
  return 3;
}

function refreshMinutes(ctx) {
  const env = ctx.env || {};
  const raw = envValue(env, ["REFRESH_MINUTES", "refreshMinutes", "refresh"]);
  const value = Number(raw || DEFAULT_REFRESH_MINUTES);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_REFRESH_MINUTES;
}

function collectAccounts(ctx, max) {
  const env = ctx.env || {};
  const accounts = [];
  const accents = ["#46D66B", "#7A84E8", "#58A6FF"];
  const symbols = [
    "sf-symbol:server.rack",
    "sf-symbol:point.3.connected.trianglepath.dotted",
    "sf-symbol:network",
  ];

  const singleUrl = envText(env, ["URL", "url"]);
  if (singleUrl) {
    accounts.push({
      slot: 1,
      name: envText(env, ["NAME", "name"]) || "Sub 1",
      url: singleUrl,
      protocol: envText(env, ["PROTOCOL", "protocol"]) || "Mixed",
      resetDay: parseResetDay(envText(env, ["RESET", "reset"])),
      accent: envText(env, ["ACCENT", "accent"]) || accents[0],
      symbol: symbols[0],
    });
  }

  for (let i = 1; i <= max; i++) {
    const url = envText(env, [`URL${i}`, `url${i}`]);
    if (!url || accounts.some((item) => item.url === url)) continue;
    accounts.push({
      slot: i,
      name: envText(env, [`NAME${i}`, `name${i}`]) || `Sub ${i}`,
      url,
      protocol: envText(env, [`PROTOCOL${i}`, `protocol${i}`]) || "Mixed",
      resetDay: parseResetDay(envText(env, [`RESET${i}`, `reset${i}`])),
      accent: envText(env, [`ACCENT${i}`, `accent${i}`]) || accents[i - 1] || accents[0],
      symbol: symbols[i - 1] || symbols[2],
    });
  }


  const show = envText(env, ["SHOW", "show"]);
  if (show) {
    const picked = show
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((key) => findAccount(accounts, key))
      .filter(Boolean);
    if (picked.length) return picked.slice(0, max);
  }

  return accounts.slice(0, max);
}

function envText(env, keys) {
  const value = envValue(env, keys);
  return String(value == null ? "" : value).trim();
}

function envValue(env, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(env, key)) return env[key];
  }
  return "";
}

function parseResetDay(value) {
  const day = parseInt(value || "", 10);
  return day >= 1 && day <= 31 ? day : null;
}

function findAccount(list, key) {
  const index = Number(key);
  if (Number.isInteger(index) && index >= 1 && list[index - 1]) return list[index - 1];
  return list.find((item) => item.name === key);
}

async function loadTraffic(ctx, account) {
  const empty = {
    ...account,
    upload: 0,
    download: 0,
    used: 0,
    total: 0,
    remain: 0,
    todayUsed: 0,
    hourlyUsage: [],
    expire: 0,
    ok: false,
    cached: false,
    fetchedAt: Date.now(),
    error: "No data",
  };

  try {
    const info = await fetchSubscriptionInfo(ctx, account.url);
    const upload = Number(info.upload || 0);
    const download = Number(info.download || 0);
    const total = Number(info.total || 0);
    const used = upload + download;
    const history = updateUsageHistory(ctx, account, used);
    const data = {
      ...empty,
      upload,
      download,
      used,
      total,
      remain: Math.max(total - used, 0),
      todayUsed: history.todayUsed,
      hourlyUsage: history.hourlyUsage,
      expire: Number(info.expire || 0),
      ok: total > 0,
      cached: false,
      fetchedAt: Date.now(),
      error: "",
    };

    writeJSON(ctx, storageKey(account, "cache"), cacheShape(data));
    return data;
  } catch (error) {
    const cached = readJSON(ctx, storageKey(account, "cache"), null);
    if (cached) {
      return {
        ...empty,
        ...cached,
        cached: true,
        fetchedAt: cached.fetchedAt || Date.now(),
        error: shortError(error),
      };
    }

    return {
      ...empty,
      error: shortError(error),
    };
  }
}

async function fetchSubscriptionInfo(ctx, url) {
  const variants = buildUrlVariants(url);
  const userAgents = [
    { "User-Agent": "Quantumult%20X/1.5.2" },
    { "User-Agent": "clash-verge-rev/2.3.1", Accept: "application/x-yaml,text/plain,*/*" },
    { "User-Agent": "mihomo/1.19.3", Accept: "application/x-yaml,text/plain,*/*" },
  ];

  for (const method of ["head", "get"]) {
    for (const target of variants) {
      for (const headers of userAgents) {
        try {
          const response = await httpRequest(ctx, method, target, headers);
          const raw = headerValue(response && response.headers, "subscription-userinfo");
          const info = parseSubscriptionHeader(raw);
          if (info && info.total) return info;
        } catch (_) {}
      }
    }
  }

  throw new Error("Missing subscription-userinfo header");
}

async function httpRequest(ctx, method, url, headers) {
  if (!ctx.http) throw new Error("ctx.http is not available");
  const fn = ctx.http[method] || ctx.http.get;
  if (typeof fn !== "function") throw new Error(`ctx.http.${method} is not available`);
  return await fn.call(ctx.http, url, { headers, timeout: 9000 });
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") {
    return headers.get(name) || headers.get(name.toLowerCase()) || headers.get(name.toUpperCase()) || "";
  }
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return String(headers[key] || "");
  }
  return "";
}

function parseSubscriptionHeader(header) {
  if (!header) return null;
  const pairs = String(header).match(/\w+=[\d.eE+-]+/g) || [];
  if (!pairs.length) return null;
  return Object.fromEntries(
    pairs.map((pair) => {
      const [key, value] = pair.split("=");
      return [key.toLowerCase(), Number(value)];
    })
  );
}

function buildUrlVariants(url) {
  const seen = new Set();
  const variants = [];
  const add = (item) => {
    if (item && !seen.has(item)) {
      seen.add(item);
      variants.push(item);
    }
  };

  add(url);
  add(withParam(url, "flag", "clash"));
  add(withParam(url, "flag", "meta"));
  add(withParam(url, "target", "clash"));
  return variants;
}

function withParam(url, key, value) {
  return `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

function renderWidget(family, results, refreshAfter) {
  const compact = family === "systemMedium";
  const compactMulti = compact && results.length >= 2;
  const small = family === "systemSmall";
  const dense = !small && results.length >= 3;
  const palette = makePalette(results[0] && results[0].accent);

  if (small) {
    const item = results[0];
    return {
      type: "widget",
      backgroundGradient: palette.backgroundGradient,
      padding: [13, 13, 12, 13],
      gap: 0,
      refreshAfter,
      children: [
        renderHeader([item], palette, { small: true, compact: true }),
        spacer(6),
        divider(palette),
        spacer(7),
        renderTrafficSection(item, palette, { small: true, compact: true }),
      ],
    };
  }

  return {
    type: "widget",
    backgroundGradient: palette.backgroundGradient,
    padding: compact ? [12, 15, 11, 15] : [16, 18, 14, 18],
    gap: 0,
    refreshAfter,
    children: [
      renderHeader(results, palette, { compact, compactMulti, dense }),
      spacer(compactMulti ? 3 : compact ? 5 : dense ? 7 : 9),
      divider(palette),
      spacer(compactMulti ? 3 : compact ? 5 : dense ? 7 : 9),
      ...interleaveSections(results, palette, { compact, compactMulti, dense }),
      ...(family === "systemLarge" || family === "systemExtraLarge" ? [{ type: "spacer" }, renderFooter(results, palette)] : []),
    ],
  };
}

function interleaveSections(results, palette, options) {
  const out = [];
  results.forEach((item, index) => {
    out.push(renderTrafficSection(item, palette, { ...options, index, count: results.length }));
    if (index < results.length - 1) {
      const sectionGap = options.compactMulti ? 2 : options.compact ? 4 : options.dense ? 6 : 8;
      out.push(spacer(sectionGap), divider(palette), spacer(sectionGap));
    }
  });
  return out;
}

function renderHeader(results, palette, options = {}) {
  return {
    type: "stack",
    direction: "row",
    alignItems: "center",
    gap: options.compact ? 6 : 8,
    children: [
      {
        type: "image",
        src: "sf-symbol:waveform.path.ecg",
        width: options.compact ? 13 : 15,
        height: options.compact ? 13 : 15,
        color: palette.accent,
      },
      {
        type: "text",
        text: options.small ? "Sub" : "Sub Usage",
        font: { size: options.small ? 16 : options.compact ? 15 : 17, weight: "semibold" },
        textColor: palette.text,
        maxLines: 1,
      },
      { type: "spacer" },
      {
        type: "text",
        text: timeText(newestResult(results).fetchedAt),
        font: roundedFont(options.compact ? 10 : 12, "semibold"),
        textColor: palette.dim,
        maxLines: 1,
      },
    ],
  };
}

function renderTrafficSection(data, palette, options = {}) {
  const profile = sectionProfile(options);
  const accent = data.ok ? data.accent || palette.accent : palette.warning;
  const protocol = data.protocol || "Mixed";
  const meta = options.small
    ? protocol
    : options.compact
      ? `${protocol} · ${data.expire ? `Exp ${dateText(data.expire)}` : data.cached ? "Cached" : statusText(data)}`
      : `${protocol} / ${data.expire ? `Expires ${dateText(data.expire)}` : data.cached ? "Cached" : statusText(data)}`;

  return {
    type: "stack",
    direction: "column",
    gap: 0,
    children: [
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 6,
        children: [
          {
            type: "image",
            src: data.symbol || "sf-symbol:network",
            width: profile.icon,
            height: profile.icon,
            color: accent,
          },
          {
            type: "text",
            text: data.name || "Proxy",
            font: { size: profile.nameSize, weight: "semibold" },
            textColor: palette.text,
            maxLines: 1,
            minScale: options.small ? 0.55 : 0.72,
          },
          { type: "spacer" },
          {
            type: "text",
            text: percent(data.used, data.total),
            font: roundedFont(profile.percentSize, "bold"),
            textColor: accent,
            maxLines: 1,
          },


        ],
      },
      spacer(profile.gapAfterHead),
      renderHourlyBars(data.hourlyUsage, accent, palette, profile.meterHeight, 24),
      spacer(profile.gapAfterBars),
      renderProgress(ratio(data.remain, data.total), accent, palette, profile.progressHeight),
      spacer(profile.gapAfterProgress),
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        children: [
          {
            type: "text",
            text: `${formatBytes(data.used)} / ${formatBytes(data.total)}`,
            font: roundedFont(profile.metaSize, "semibold"),
            textColor: accent,
            maxLines: 1,
          },
          ...(options.small
            ? []
            : [
                { type: "spacer" },
                {
                  type: "text",
                  text: meta,
                  font: roundedFont(profile.metaSize, "semibold"),
                  textColor: data.ok ? palette.dim : palette.warning,
                  maxLines: 1,
                  minScale: 0.7,
                },
              ]),
        ],
      },
    ],
  };
}

function sectionProfile(options) {
  if (options.small) {
    return {
      icon: 17,
      nameSize: 15,
      percentSize: 13,
      valueSize: 9,
      metaSize: 9,
      meterHeight: 10,
      progressHeight: 5,
      gapAfterHead: 7,
      gapAfterBars: 1,
      gapAfterProgress: 4,
    };
  }

  if (options.compact) {
    if (options.compactMulti) {
      return {
        icon: 15,
        nameSize: 14,
        percentSize: 12,
        valueSize: 9,
        metaSize: 9,
        meterHeight: 8,
        progressHeight: 3,
        gapAfterHead: 4,
        gapAfterBars: 1,
        gapAfterProgress: 2,
      };
    }
    return {
      icon: 17,
      nameSize: 16,
      percentSize: 14,
      valueSize: 10,
      metaSize: 10,
      meterHeight: 12,
      progressHeight: 4,
      gapAfterHead: 10,
      gapAfterBars: 3,
      gapAfterProgress: 3,
    };
  }

  if (options.dense) {
    return {
      icon: 18,
      nameSize: 17,
      percentSize: 15,
      valueSize: 11,
      metaSize: 11,
      meterHeight: 14,
      progressHeight: 5,
      gapAfterHead: 9,
      gapAfterBars: 2,
      gapAfterProgress: 4,
    };
  }

  return {
    icon: 19,
    nameSize: 18,
    percentSize: 16,
    valueSize: 12,
    metaSize: 12,
    meterHeight: 18,
    progressHeight: 5,
    gapAfterHead: 10,
    gapAfterBars: 2,
    gapAfterProgress: 5,
  };
}

function renderHourlyBars(values, accent, palette, height, count) {
  const bars = normalizeBars(values, count);
  const max = Math.max(...bars, 1);

  return {
    type: "stack",
    direction: "row",
    alignItems: "end",
    gap: 3,
    height,
    children: bars.map((value) => {
      const active = Number(value || 0) > 0;
      const barHeight = active ? Math.max(6, Math.round(6 + (Number(value) / max) * (height - 6))) : 1;
      return {
        type: "stack",
        flex: 1,
        height: barHeight,
        backgroundColor: active ? accent : "#00000000",
        borderRadius: active ? 3 : 0,
        children: [],
      };
    }),
  };
}

function renderProgress(value, accent, palette, height) {
  const filled = Math.max(Math.round(Math.min(Math.max(value, 0), 1) * 100), 1);
  const empty = Math.max(100 - filled, 1);

  return {
    type: "stack",
    direction: "row",
    alignItems: "center",
    gap: 0,
    children: [
      { type: "stack", flex: filled, height, backgroundColor: accent, borderRadius: 99, children: [] },
      { type: "stack", flex: empty, height, backgroundColor: palette.track, borderRadius: 99, children: [] },
    ],
  };
}

function renderFooter(results, palette) {
  const total = results.reduce(
    (sum, item) => {
      sum.used += item.used || 0;
      sum.total += item.total || 0;
      return sum;
    },
    { used: 0, total: 0 }
  );

  return {
    type: "stack",
    direction: "row",
    alignItems: "center",
    children: [
      { type: "spacer" },
      {
        type: "text",
        text: `Used ${formatBytes(total.used)} / ${formatBytes(total.total)}`,
        font: roundedFont(11, "semibold"),
        textColor: palette.dim,
        maxLines: 1,
        minScale: 0.72,
      },
    ],
  };
}

function renderAccessoryRectangular(results) {
  const item = results[0];
  return {
    type: "widget",
    gap: 2,
    children: [
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 4,
        children: [
          { type: "image", src: item.symbol || "sf-symbol:network", width: 11, height: 11 },
          { type: "text", text: item.name || "Traffic", font: { size: "headline", weight: "bold" }, maxLines: 1 },
        ],
      },
      { type: "text", text: `${percent(item.used, item.total)}  ${formatBytes(item.used)} / ${formatBytes(item.total)}`, font: roundedFont(11, "semibold") },
      { type: "text", text: `${item.expire ? dateText(item.expire) : statusText(item)}`, font: roundedFont(11, "semibold"), opacity: 0.7 },
    ],
  };
}

function renderEmpty(family, refreshAfter) {
  const palette = makePalette("#7A84E8");
  if (family.startsWith("accessory")) {
    return { type: "widget", children: [{ type: "text", text: "Configure URL" }] };
  }

  return {
    type: "widget",
    padding: 16,
    gap: 10,
    backgroundGradient: palette.backgroundGradient,
    refreshAfter,
    children: [
      renderHeader([{ fetchedAt: Date.now() }], palette),
      { type: "spacer" },
      {
        type: "text",
        text: "Configure URL in Env",
        font: { size: "caption1", weight: "medium" },
        textColor: palette.warning,
        textAlign: "center",
      },
      { type: "spacer" },
    ],
  };
}

function makePalette(accent) {
  const accentColor = accent || "#7A84E8";
  return {
    accent: adaptiveColor(accentColor, accentColor),
    text: adaptiveColor("#111111", "#F3F6FB"),
    dim: adaptiveColor("#6E6E73", "#8C95A8"),
    divider: adaptiveColor("#D1D1D6", "#2C2C2E"),
    track: adaptiveColor("#E5E5EA", "#1C1C1E"),
    barIdle: adaptiveColor("#D1D1D666", "#3A3A3C66"),
    warning: adaptiveColor("#D92D20", "#FF6B6B"),
    backgroundGradient: {
      type: "linear",
      colors: [
        adaptiveColor("#FFFFFFFF", "#000000FF"),
        adaptiveColor("#FFFFFFFF", "#000000FF"),
        adaptiveColor("#FFFFFFFF", "#000000FF"),
      ],
      stops: [0, 0.55, 1],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 },
    },
  };
}

function adaptiveColor(light, dark) {
  return { light, dark };
}

function roundedFont(size, weight = "semibold") {
  return { size, weight, design: "rounded" };
}

function divider(palette) {
  return {
    type: "stack",
    direction: "row",
    height: 1,
    backgroundColor: palette.divider,
    children: [],
  };
}

function spacer(length) {
  return { type: "spacer", length };
}

function updateUsageHistory(ctx, account, used) {
  const now = new Date();
  const dailyKey = storageKey(account, "daily");
  const hourlyKey = storageKey(account, "hourly");
  const today = todayKey(now);
  const hour = hourKey(now);
  const cycle = cycleKey(now, account.resetDay);

  const daily = readJSON(ctx, dailyKey, null);
  const nextDaily =
    !daily || daily.date !== today || daily.cycle !== cycle || Number(daily.baselineUsed || 0) > used
      ? { date: today, cycle, baselineUsed: used }
      : daily;

  const todayUsed = Math.max(used - Number(nextDaily.baselineUsed || 0), 0);
  nextDaily.cycle = cycle;
  nextDaily.lastUsed = used;
  nextDaily.updatedAt = Date.now();
  writeJSON(ctx, dailyKey, nextDaily);

  let hourly = readJSON(ctx, hourlyKey, { hours: [], cycle });
  if (!hourly || !Array.isArray(hourly.hours)) hourly = { hours: [], cycle };
  if (hourly.cycle !== cycle) hourly = { hours: [], cycle };

  const last = hourly.hours[hourly.hours.length - 1];
  if (last && Number(last.lastUsed || 0) > used) hourly = { hours: [], cycle };

  let current = hourly.hours.find((item) => item.key === hour);
  if (!current) {
    const previous = hourly.hours[hourly.hours.length - 1];
    const startUsed = previous ? Number(previous.lastUsed || used) : used;
    current = { key: hour, startUsed, lastUsed: used, delta: Math.max(used - startUsed, 0) };
    hourly.hours.push(current);
  } else {
    current.lastUsed = used;
    current.delta = Math.max(used - Number(current.startUsed || used), 0);
  }

  hourly.hours = hourly.hours.filter((item) => item && item.key).slice(-48);
  const byHour = {};
  hourly.hours.forEach((item) => {
    byHour[item.key] = Number(item.delta || 0);
  });

  hourly.cycle = cycle;
  hourly.updatedAt = Date.now();
  writeJSON(ctx, hourlyKey, hourly);

  return {
    todayUsed,
    hourlyUsage: lastHourKeys(24).map((key) => byHour[key] || 0),
  };
}

function readJSON(ctx, key, fallback) {
  try {
    const storage = ctx.storage || ctx.store || ctx.cache;
    if (!storage) return fallback;
    if (typeof storage.getJSON === "function") {
      const value = storage.getJSON(key);
      return value == null ? fallback : value;
    }
    const raw = readStore(storage, key);
    if (!raw) return fallback;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (_) {
    return fallback;
  }
}

function writeJSON(ctx, key, value) {
  try {
    const storage = ctx.storage || ctx.store || ctx.cache;
    if (!storage) return;
    if (typeof storage.setJSON === "function") {
      storage.setJSON(key, value);
      return;
    }
    writeStore(storage, key, JSON.stringify(value));
  } catch (_) {}
}

function readStore(storage, key) {
  if (typeof storage.getItem === "function") return storage.getItem(key);
  if (typeof storage.get === "function") return storage.get(key);
  if (typeof storage.read === "function") return storage.read(key);
  return null;
}

function writeStore(storage, key, value) {
  if (typeof storage.setItem === "function") storage.setItem(key, value);
  else if (typeof storage.set === "function") storage.set(key, value);
  else if (typeof storage.write === "function") storage.write(value, key);
}

function storageKey(account, type) {
  return `modern.subtraffic.${type}.${account.slot || encodeURIComponent(account.name || "default")}`;
}

function cacheShape(data) {
  return {
    name: data.name,
    protocol: data.protocol,
    resetDay: data.resetDay,
    accent: data.accent,
    symbol: data.symbol,
    upload: data.upload,
    download: data.download,
    used: data.used,
    total: data.total,
    remain: data.remain,
    todayUsed: data.todayUsed,
    hourlyUsage: data.hourlyUsage,
    expire: data.expire,
    ok: data.ok,
    fetchedAt: data.fetchedAt,
  };
}

function normalizeBars(values, count) {
  const bars = Array.isArray(values) ? values.slice(-count).map((item) => Number(item || 0)) : [];
  while (bars.length < count) bars.unshift(0);
  return bars;
}

function newestResult(results) {
  const items = results.filter(Boolean);
  if (!items.length) return { fetchedAt: Date.now() };
  return items.reduce((latest, item) => (Number(item.fetchedAt || 0) > Number(latest.fetchedAt || 0) ? item : latest), items[0]);
}

function ratio(a, b) {
  if (!b) return 0;
  return Math.min(Math.max(a / b, 0), 1);
}

function percent(a, b) {
  if (!b) return "0%";
  return `${Math.round(ratio(a, b) * 100)}%`;
}

function statusText(data) {
  if (!data || !data.error) return "Live";
  return data.error.length > 18 ? `${data.error.slice(0, 18)}...` : data.error;
}

function shortError(error) {
  return String(error && error.message ? error.message : error);
}

function inlineText(results) {
  const item = results[0];
  if (!item) return "Traffic";
  return `${item.name} ${percent(item.used, item.total)} ${formatBytes(item.used)}/${formatBytes(item.total)}`;
}


function formatBytes(bytes) {
  const value = Number(bytes || 0);
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let n = value;
  let index = 0;
  while (n >= 1024 && index < units.length - 1) {
    n /= 1024;
    index++;
  }
  const digits = n >= 100 || index === 0 ? 0 : n >= 10 ? 1 : 2;
  return `${n.toFixed(digits)}${units[index]}`;
}

function dateText(expire) {
  if (!expire) return "no expiry";
  const d = new Date(expire > 1e12 ? expire : expire * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function timeText(timestamp) {
  const d = new Date(timestamp || Date.now());
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function todayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function cycleKey(date, resetDay) {
  if (!resetDay) return "calendar";
  const day = date.getDate();
  let year = date.getFullYear();
  let month = date.getMonth() + 1;
  if (day < resetDay) {
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(resetDay).padStart(2, "0")}`;
}

function hourKey(date) {
  return `${todayKey(date)}-${String(date.getHours()).padStart(2, "0")}`;
}

function lastHourKeys(count) {
  const keys = [];
  const now = new Date();
  now.setMinutes(0, 0, 0);
  for (let i = count - 1; i >= 0; i--) {
    keys.push(hourKey(new Date(now.getTime() - i * 3600000)));
  }
  return keys;
}
