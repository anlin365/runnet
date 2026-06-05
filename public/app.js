const searchForm = document.getElementById("search-form");
const searchButton = document.getElementById("search-button");
const syncItraButton = document.getElementById("sync-itra-button");
const searchStatus = document.getElementById("search-status");
const searchResults = document.getElementById("search-results");
const savedStatus = document.getElementById("saved-status");
const savedRunners = document.getElementById("saved-runners");
const runnerCardTemplate = document.getElementById("runner-card-template");
const compareForm = document.getElementById("compare-form");
const compareLeft = document.getElementById("compare-left");
const compareRight = document.getElementById("compare-right");
const compareStatus = document.getElementById("compare-status");
const compareContent = document.getElementById("compare-content");
const compareMetrics = document.getElementById("compare-metrics");
const compareTrendChart = document.getElementById("compare-trend-chart");
const radarChart = document.getElementById("radar-chart");
const raceForm = document.getElementById("race-form");
const raceStatus = document.getElementById("race-status");
const raceResults = document.getElementById("race-results");
const aiForm = document.getElementById("ai-form");
const aiRunner = document.getElementById("ai-runner");
const aiStatus = document.getElementById("ai-status");
const aiContent = document.getElementById("ai-content");
const aiLevel = document.getElementById("ai-level");
const aiRaces = document.getElementById("ai-races");
const aiTraining = document.getElementById("ai-training");
const detailEmpty = document.getElementById("detail-empty");
const detailContent = document.getElementById("detail-content");
const detailAvatar = document.getElementById("detail-avatar");
const detailCountry = document.getElementById("detail-country");
const detailName = document.getElementById("detail-name");
const detailMeta = document.getElementById("detail-meta");
const detailStats = document.getElementById("detail-stats");
const detailSummary = document.getElementById("detail-summary");
const detailRecommendation = document.getElementById("detail-recommendation");
const trendChart = document.getElementById("trend-chart");

const overviewRunnerCount = document.getElementById("overview-runner-count");
const overviewRaceCount = document.getElementById("overview-race-count");
const overviewAveragePi = document.getElementById("overview-average-pi");
const overviewTopRunner = document.getElementById("overview-top-runner");

const state = {
  searchResults: [],
  savedRunners: [],
  selectedRunner: null,
};

function setStatus(element, message, type = "muted") {
  element.textContent = message;
  element.className = `status-box ${type}`;
}

function createTag(text) {
  const span = document.createElement("span");
  span.className = "tag";
  span.textContent = text;
  return span;
}

function createEmptyState(message) {
  const div = document.createElement("div");
  div.className = "empty-state";
  div.textContent = message;
  return div;
}

function formatRunnerMeta(runner) {
  return [runner.nationality, runner.gender, runner.ageGroup].filter(Boolean).join(" / ");
}

function getSavedRunnerIds() {
  return new Set(state.savedRunners.map((runner) => runner.runnerId));
}

function buildStatCard(label, value, hint = "") {
  const card = document.createElement("div");
  card.className = "mini-stat";
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  const valueNode = document.createElement("strong");
  valueNode.textContent = value;
  card.append(labelNode, valueNode);

  if (hint) {
    const hintNode = document.createElement("p");
    hintNode.textContent = hint;
    card.append(hintNode);
  }

  return card;
}

function sourceLabel(source) {
  return source === "itra_recent_races" ? "ITRA字段" : "平台估算";
}

function renderAbilityProfile(container, abilityProfile = []) {
  container.innerHTML = "";

  if (!abilityProfile.length) {
    container.appendChild(createEmptyState("暂无能力画像数据。"));
    return;
  }

  abilityProfile.forEach((item) => {
    const row = document.createElement("div");
    row.className = "ability-row";

    const head = document.createElement("div");
    head.className = "ability-head";
    const label = document.createElement("span");
    label.textContent = item.label;
    const value = document.createElement("strong");
    value.textContent = `${item.value}/100`;
    head.append(label, value);

    const track = document.createElement("div");
    track.className = "ability-track";
    const bar = document.createElement("span");
    bar.style.width = `${Math.max(0, Math.min(100, Number(item.value || 0)))}%`;
    track.appendChild(bar);

    const source = document.createElement("p");
    source.className = "source-note";
    source.textContent = sourceLabel(item.source);

    row.append(head, track, source);
    container.appendChild(row);
  });
}

function renderRaceHistory(container, raceHistory = []) {
  container.innerHTML = "";

  if (!raceHistory.length) {
    container.appendChild(createEmptyState("暂无历史比赛记录。"));
    return;
  }

  raceHistory.forEach((race) => {
    const item = document.createElement("article");
    item.className = "history-race";

    const top = document.createElement("div");
    top.className = "history-race-top";
    const name = document.createElement("h4");
    name.textContent = race.name;
    const source = document.createElement("span");
    source.className = "source-pill";
    source.textContent = sourceLabel(race.source);
    top.append(name, source);

    const meta = document.createElement("p");
    meta.className = "race-meta";
    meta.textContent = `${race.date} / ${race.distanceKm} km / D+ ${race.elevationGain} m`;

    const metrics = document.createElement("div");
    metrics.className = "race-detail-grid";
    [
      ["成绩", race.resultTime],
      ["配速", race.pace],
      ["总排名", race.overallRank],
      ["组别排名", race.categoryRank],
      ["ITRA分", race.itraScore],
      ["分数变化", race.scoreChange > 0 ? `+${race.scoreChange}` : race.scoreChange],
    ].forEach(([label, value]) => {
      const metric = document.createElement("div");
      metric.className = "race-detail-metric";
      const metricLabel = document.createElement("span");
      metricLabel.textContent = label;
      const metricValue = document.createElement("strong");
      metricValue.textContent = value ?? "暂无";
      metric.append(metricLabel, metricValue);
      metrics.appendChild(metric);
    });

    const detail = document.createElement("p");
    detail.className = "source-note";
    detail.textContent = `${race.details?.terrain || "Trail"} / 完赛率 ${race.details?.finishRate || "暂无"}。${race.details?.note || ""}`;

    item.append(top, meta, metrics, detail);
    container.appendChild(item);
  });
}

function renderDataSources(container, dataSources = {}) {
  container.innerHTML = "";

  const groups = [
    ["ITRA来源", dataSources.itra || []],
    ["平台估算", dataSources.estimated || []],
  ];

  groups.forEach(([title, items]) => {
    const block = document.createElement("div");
    block.className = "source-block";
    const heading = document.createElement("h4");
    heading.textContent = title;
    const list = document.createElement("div");
    list.className = "source-tags";
    items.forEach((item) => list.appendChild(createTag(item)));
    block.append(heading, list);
    container.appendChild(block);
  });

  (dataSources.notes || []).forEach((note) => {
    const item = document.createElement("p");
    item.className = "source-note";
    item.textContent = note;
    container.appendChild(item);
  });
}

function ensureDetailSupplement() {
  let supplement = document.getElementById("detail-supplement");
  if (supplement) {
    return supplement;
  }

  supplement = document.createElement("div");
  supplement.id = "detail-supplement";
  supplement.className = "detail-supplement";

  const ability = document.createElement("article");
  ability.className = "detail-section";
  ability.innerHTML = "<div class=\"chart-head\"><h3>能力画像</h3><span>短/中/长距离、爬升与稳定性</span></div><div id=\"ability-profile\" class=\"ability-profile\"></div>";

  const history = document.createElement("article");
  history.className = "detail-section wide";
  history.innerHTML = "<div class=\"chart-head\"><h3>历史比赛与单场详情</h3><span>成绩、排名、配速、ITRA分</span></div><div id=\"race-history\" class=\"history-list\"></div>";

  const sources = document.createElement("article");
  sources.className = "detail-section wide";
  sources.innerHTML = "<div class=\"chart-head\"><h3>数据来源标识</h3><span>区分ITRA字段与平台估算</span></div><div id=\"data-sources\" class=\"source-grid\"></div>";

  supplement.append(ability, history, sources);
  detailContent.appendChild(supplement);
  return supplement;
}

function renderLineChart(svg, seriesCollection, colors) {
  const width = 520;
  const height = 240;
  const padding = 28;
  const allValues = seriesCollection.flatMap((series) => series.points.map((point) => point.value));

  svg.innerHTML = "";
  if (!allValues.length) {
    return;
  }

  const minValue = Math.min(...allValues) - 10;
  const maxValue = Math.max(...allValues) + 10;
  const steps = Math.max(seriesCollection[0]?.points.length || 0, 2);

  for (let i = 0; i < 4; i += 1) {
    const y = padding + ((height - padding * 2) / 3) * i;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(padding));
    line.setAttribute("x2", String(width - padding));
    line.setAttribute("y1", String(y));
    line.setAttribute("y2", String(y));
    line.setAttribute("class", "chart-grid-line");
    svg.appendChild(line);
  }

  seriesCollection.forEach((series, index) => {
    const color = colors[index] || "#56f0ff";
    const points = series.points.map((point, pointIndex) => {
      const x = padding + ((width - padding * 2) / (steps - 1)) * pointIndex;
      const ratio = (point.value - minValue) / Math.max(maxValue - minValue, 1);
      const y = height - padding - ratio * (height - padding * 2);
      return { x, y, label: point.label, value: point.value };
    });

    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", color);
    polyline.setAttribute("stroke-width", "4");
    polyline.setAttribute("stroke-linecap", "round");
    polyline.setAttribute("stroke-linejoin", "round");
    polyline.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
    svg.appendChild(polyline);

    points.forEach((point) => {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(point.x));
      circle.setAttribute("cy", String(point.y));
      circle.setAttribute("r", "4.5");
      circle.setAttribute("fill", color);
      svg.appendChild(circle);
    });

    points.forEach((point) => {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", String(point.x));
      label.setAttribute("y", String(height - 8));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("class", "chart-axis-label");
      label.textContent = point.label;
      svg.appendChild(label);
    });
  });
}

function renderRadarChart(svg, leftSeries, rightSeries) {
  svg.innerHTML = "";
  const width = 420;
  const height = 320;
  const centerX = width / 2;
  const centerY = height / 2 + 8;
  const radius = 108;
  const axes = leftSeries.length;

  if (!axes) {
    return;
  }

  const createPolygonPoints = (ratio) => leftSeries.map((_, index) => {
    const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / axes;
    const x = centerX + Math.cos(angle) * radius * ratio;
    const y = centerY + Math.sin(angle) * radius * ratio;
    return `${x},${y}`;
  }).join(" ");

  [0.25, 0.5, 0.75, 1].forEach((ratio) => {
    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polygon.setAttribute("points", createPolygonPoints(ratio));
    polygon.setAttribute("class", "radar-grid");
    svg.appendChild(polygon);
  });

  leftSeries.forEach((item, index) => {
    const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / axes;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;

    const axis = document.createElementNS("http://www.w3.org/2000/svg", "line");
    axis.setAttribute("x1", String(centerX));
    axis.setAttribute("y1", String(centerY));
    axis.setAttribute("x2", String(x));
    axis.setAttribute("y2", String(y));
    axis.setAttribute("class", "radar-axis");
    svg.appendChild(axis);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", String(centerX + Math.cos(angle) * (radius + 22)));
    label.setAttribute("y", String(centerY + Math.sin(angle) * (radius + 22)));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("class", "chart-axis-label");
    label.textContent = item.label;
    svg.appendChild(label);
  });

  [
    { series: leftSeries, stroke: "#56f0ff", fill: "rgba(86,240,255,0.22)" },
    { series: rightSeries, stroke: "#ff7a59", fill: "rgba(255,122,89,0.18)" },
  ].forEach((entry) => {
    const points = entry.series.map((item, index) => {
      const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / axes;
      const scale = Math.max(0, Math.min(1, Number(item.value || 0) / 100));
      const x = centerX + Math.cos(angle) * radius * scale;
      const y = centerY + Math.sin(angle) * radius * scale;
      return `${x},${y}`;
    }).join(" ");

    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polygon.setAttribute("points", points);
    polygon.setAttribute("stroke", entry.stroke);
    polygon.setAttribute("fill", entry.fill);
    polygon.setAttribute("stroke-width", "3");
    svg.appendChild(polygon);
  });
}

function renderRunnerDetail(runner) {
  state.selectedRunner = runner;
  detailEmpty.classList.add("hidden");
  detailContent.classList.remove("hidden");

  detailAvatar.src = runner.profilePicUrl || "https://itra.run/images/member-pics/default.jpg";
  detailCountry.textContent = runner.nationality || "国家待确认";
  detailName.textContent = runner.fullName;
  detailMeta.textContent = formatRunnerMeta(runner) || "基础标签待补充";

  detailStats.innerHTML = "";
  [
    ["ITRA PI", runner.performanceIndex || "暂无", runner.performanceLevel || ""],
    ["UTMB Index", runner.analytics?.utmbIndex || "暂无", "估算值"],
    ["国家排名", runner.analytics?.countryRanking || "暂无", "阶段估算"],
    ["世界排名", runner.analytics?.worldRanking || "暂无", "阶段估算"],
    ["完赛统计", runner.analytics?.finishCount || "暂无", "近年样本推演"],
    ["估算配速", `${runner.analytics?.avgPace || "5.5"} min/km`, "平台推演"],
  ].forEach(([label, value, hint]) => {
    detailStats.appendChild(buildStatCard(label, String(value), hint));
  });

  detailSummary.textContent = `${runner.analytics?.summary?.scoreBand || "待评估"}。${runner.analytics?.summary?.trend || ""}`;
  detailRecommendation.textContent = runner.analytics?.summary?.recommendation || "";
  ensureDetailSupplement();
  renderAbilityProfile(document.getElementById("ability-profile"), runner.analytics?.abilityProfile || []);
  renderRaceHistory(document.getElementById("race-history"), runner.analytics?.raceHistory || []);
  renderDataSources(document.getElementById("data-sources"), runner.analytics?.dataSources || {});

  renderLineChart(
    trendChart,
    [{ points: runner.analytics?.trendSeries || [] }],
    ["#56f0ff"],
  );
}

function buildRunnerCard(runner) {
  const fragment = runnerCardTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".runner-card");
  const runnerName = fragment.querySelector(".runner-name");
  const runnerMeta = fragment.querySelector(".runner-meta");
  const runnerPi = fragment.querySelector(".runner-pi");
  const runnerTags = fragment.querySelector(".runner-tags");
  const raceList = fragment.querySelector(".race-list");
  const saveButton = fragment.querySelector(".save-button");
  const inspectButton = fragment.querySelector(".inspect-button");

  const savedRunnerIds = getSavedRunnerIds();

  runnerName.textContent = runner.fullName;
  runnerMeta.textContent = formatRunnerMeta(runner) || "暂无基础标签";
  runnerPi.textContent = runner.performanceIndex ? `PI ${runner.performanceIndex}` : "PI 暂无";

  [
    runner.performanceLevel && `等级 ${runner.performanceLevel}`,
    runner.analytics?.utmbIndex && `UTMB ${runner.analytics.utmbIndex}`,
    runner.analytics?.summary?.scoreBand && runner.analytics.summary.scoreBand,
  ]
    .filter(Boolean)
    .forEach((tag) => runnerTags.appendChild(createTag(tag)));

  (runner.recentRaces.length ? runner.recentRaces.slice(0, 3) : ["暂无最近比赛摘要"]).forEach((race) => {
    const item = document.createElement("li");
    item.textContent = race;
    raceList.appendChild(item);
  });

  inspectButton.addEventListener("click", () => {
    renderRunnerDetail(runner);
    document.getElementById("detail-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  if (savedRunnerIds.has(runner.runnerId)) {
    saveButton.textContent = "已保存";
    saveButton.classList.add("saved");
    saveButton.disabled = true;
  }

  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    saveButton.textContent = "保存中...";

    try {
      const response = await fetch("/api/runners", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(runner),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "保存失败");
      }

      saveButton.textContent = "已保存";
      saveButton.classList.add("saved");
      setStatus(searchStatus, `已保存 ${runner.fullName} 到本地候选库。`, "success");
      await Promise.all([loadSavedRunners(), loadOverview()]);
    } catch (error) {
      saveButton.disabled = false;
      saveButton.textContent = "保存到本地";
      setStatus(searchStatus, error.message, "error");
    }
  });

  return card;
}

function buildSavedCard(runner) {
  const card = document.createElement("article");
  card.className = "saved-card";

  const top = document.createElement("div");
  top.className = "saved-card-top";

  const left = document.createElement("div");
  const name = document.createElement("h3");
  name.className = "saved-name";
  name.textContent = runner.fullName;
  const meta = document.createElement("p");
  meta.className = "saved-meta";
  meta.textContent = formatRunnerMeta(runner) || "暂无基础标签";
  left.append(name, meta);

  const pi = document.createElement("span");
  pi.className = "saved-pi";
  pi.textContent = runner.performanceIndex ? `PI ${runner.performanceIndex}` : "PI 暂无";
  top.append(left, pi);

  const tags = document.createElement("div");
  tags.className = "saved-tags";
  [
    runner.performanceLevel && `等级 ${runner.performanceLevel}`,
    runner.analytics?.utmbIndex && `UTMB ${runner.analytics.utmbIndex}`,
    runner.savedAt && `保存于 ${new Date(runner.savedAt).toLocaleString()}`,
  ]
    .filter(Boolean)
    .forEach((tag) => tags.appendChild(createTag(tag)));

  const actions = document.createElement("div");
  actions.className = "saved-actions";

  const inspect = document.createElement("button");
  inspect.className = "ghost-button";
  inspect.type = "button";
  inspect.textContent = "查看分析";
  inspect.addEventListener("click", () => renderRunnerDetail(runner));

  const link = document.createElement("a");
  link.className = "ghost-link";
  link.href = runner.profileUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "打开 ITRA 页面";

  actions.append(inspect, link);
  card.append(top, tags, actions);
  return card;
}

function populateRunnerSelectors() {
  const selects = [compareLeft, compareRight, aiRunner];
  selects.forEach((select) => {
    select.innerHTML = "";
  });

  if (!state.savedRunners.length) {
    selects.forEach((select) => {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "暂无已保存跑者";
      select.appendChild(option);
    });
    return;
  }

  state.savedRunners.forEach((runner, index) => {
    selects.forEach((select) => {
      const option = document.createElement("option");
      option.value = String(runner.runnerId);
      option.textContent = `${runner.fullName} / PI ${runner.performanceIndex || "暂无"}`;
      select.appendChild(option);
    });

    if (index === 0) {
      aiRunner.value = String(runner.runnerId);
    }
  });

  compareLeft.value = state.savedRunners[0] ? String(state.savedRunners[0].runnerId) : "";
  compareRight.value = state.savedRunners[1]
    ? String(state.savedRunners[1].runnerId)
    : String(state.savedRunners[0]?.runnerId || "");
}

async function loadSavedRunners() {
  const response = await fetch("/api/runners");
  const payload = await response.json();
  state.savedRunners = payload.items || [];

  savedRunners.innerHTML = "";
  state.savedRunners.forEach((runner) => {
    savedRunners.appendChild(buildSavedCard(runner));
  });

  if (!state.savedRunners.length) {
    savedRunners.appendChild(createEmptyState("还没有保存任何跑者。先在搜索模块里挑一个加入本地库。"));
  }

  populateRunnerSelectors();
  setStatus(savedStatus, `本地候选库共 ${state.savedRunners.length} 位跑者。`, "muted");
  setStatus(
    compareStatus,
    state.savedRunners.length >= 2 ? "可以开始双人对比。" : "请先保存至少两位跑者。",
    "muted",
  );
  setStatus(
    aiStatus,
    state.savedRunners.length ? "请选择一位已保存跑者生成分析。" : "请先保存至少一位跑者。",
    "muted",
  );
}

async function loadOverview() {
  const response = await fetch("/api/overview");
  const payload = await response.json();
  overviewRunnerCount.textContent = payload.runnerCount || 0;
  overviewRaceCount.textContent = payload.raceCount || 0;
  overviewAveragePi.textContent = payload.averagePi || 0;
  overviewTopRunner.textContent = payload.topRunner?.fullName || "待建立";
}

function renderRaceCard(race) {
  const card = document.createElement("article");
  card.className = "race-card";

  const top = document.createElement("div");
  top.className = "race-card-top";
  const name = document.createElement("h3");
  name.textContent = race.name;
  const popularity = document.createElement("span");
  popularity.className = "race-pill";
  popularity.textContent = `热度 ${race.popularity}`;
  top.append(name, popularity);

  const meta = document.createElement("p");
  meta.className = "race-meta";
  meta.textContent = `${race.country} / ${race.city} / ${race.surface}`;

  const stats = document.createElement("div");
  stats.className = "race-stats";
  [
    `距离 ${race.distanceKm} km`,
    `爬升 ${race.elevationGain} m`,
    race.bestScore,
  ].forEach((item) => stats.appendChild(createTag(item)));

  card.append(top, meta, stats);
  return card;
}

async function loadRaces() {
  const query = document.getElementById("race-query").value.trim();
  const country = document.getElementById("race-country").value.trim();
  const sort = document.getElementById("race-sort").value;
  const response = await fetch(`/api/races?q=${encodeURIComponent(query)}&country=${encodeURIComponent(country)}&sort=${encodeURIComponent(sort)}`);
  const payload = await response.json();

  raceResults.innerHTML = "";
  (payload.items || []).forEach((race) => raceResults.appendChild(renderRaceCard(race)));

  if (!(payload.items || []).length) {
    raceResults.appendChild(createEmptyState("没有找到符合条件的赛事。"));
  }

  setStatus(raceStatus, `赛事库已返回 ${payload.count || 0} 条结果。`, "muted");
}

compareForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (state.savedRunners.length < 2) {
    setStatus(compareStatus, "请先保存至少两位跑者。", "error");
    return;
  }

  const leftId = compareLeft.value;
  const rightId = compareRight.value;

  if (!leftId || !rightId || leftId === rightId) {
    setStatus(compareStatus, "请选择两位不同的跑者。", "error");
    return;
  }

  const response = await fetch(`/api/compare?leftRunnerId=${encodeURIComponent(leftId)}&rightRunnerId=${encodeURIComponent(rightId)}`);
  const payload = await response.json();

  if (!response.ok) {
    setStatus(compareStatus, payload.error || "对比失败。", "error");
    return;
  }

  const comparison = payload.comparison;
  compareMetrics.innerHTML = "";
  Object.values(comparison.metrics).forEach((metric) => {
    const card = document.createElement("article");
    card.className = "compare-card";
    const label = document.createElement("span");
    label.textContent = metric.label;
    const row = document.createElement("div");
    row.className = "compare-values";
    const left = document.createElement("strong");
    left.textContent = `${comparison.leftRunner.fullName}: ${metric.left}`;
    const right = document.createElement("strong");
    right.textContent = `${comparison.rightRunner.fullName}: ${metric.right}`;
    row.append(left, right);
    card.append(label, row);
    compareMetrics.appendChild(card);
  });

  renderRadarChart(radarChart, comparison.radar.left, comparison.radar.right);
  renderLineChart(
    compareTrendChart,
    [
      { points: comparison.trend.left },
      { points: comparison.trend.right },
    ],
    ["#56f0ff", "#ff7a59"],
  );

  compareContent.classList.remove("hidden");
  setStatus(compareStatus, "双人对比已生成。", "success");
});

aiForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!aiRunner.value) {
    setStatus(aiStatus, "请先选择一位跑者。", "error");
    return;
  }

  const response = await fetch(`/api/ai/analyze?runnerId=${encodeURIComponent(aiRunner.value)}`);
  const payload = await response.json();

  if (!response.ok) {
    setStatus(aiStatus, payload.error || "AI 分析失败。", "error");
    return;
  }

  aiLevel.textContent = payload.analysis.levelAnalysis;
  aiRaces.innerHTML = "";
  aiTraining.innerHTML = "";

  payload.analysis.recommendedRaces.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    aiRaces.appendChild(li);
  });

  payload.analysis.trainingAdvice.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    aiTraining.appendChild(li);
  });

  aiContent.classList.remove("hidden");
  setStatus(aiStatus, "AI 分析已生成。", "success");
});

raceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await loadRaces();
});

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(searchForm);
  const name = String(formData.get("name") || "").trim();
  const ageMin = String(formData.get("ageMin") || "").trim();
  const ageMax = String(formData.get("ageMax") || "").trim();
  const minPi = String(formData.get("minPi") || "").trim();
  const chinaOnly = document.getElementById("china-only").checked;

  if (name.length < 2) {
    setStatus(searchStatus, "姓名至少需要 2 个字符。", "error");
    return;
  }

  searchButton.disabled = true;
  searchButton.textContent = "搜索中...";
  searchResults.innerHTML = "";
  setStatus(searchStatus, `正在搜索本地跑友库：${name}`, "muted");

  try {
    const params = new URLSearchParams({ name });
    if (ageMin) {
      params.set("ageMin", ageMin);
    }
    if (ageMax) {
      params.set("ageMax", ageMax);
    }
    if (minPi) {
      params.set("minPi", minPi);
    }
    if (chinaOnly) {
      params.set("chinaOnly", "true");
    }
    const response = await fetch(`/api/runners/search?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "搜索失败");
    }

    state.searchResults = payload.items || [];
    if (!state.searchResults.length) {
      setStatus(searchStatus, `没有找到与“${name}”匹配的跑者。`, "muted");
      searchResults.appendChild(createEmptyState("搜索完成，但没有返回结果。"));
      return;
    }

    setStatus(
      searchStatus,
      `搜索完成，原始结果 ${payload.resultCount || 0} 位，过滤后 ${payload.filteredCount || state.searchResults.length} 位。`,
      "success",
    );
    state.searchResults.forEach((runner) => {
      searchResults.appendChild(buildRunnerCard(runner));
    });
    renderRunnerDetail(state.searchResults[0]);
  } catch (error) {
    setStatus(searchStatus, error.message, "error");
  } finally {
    searchButton.disabled = false;
    searchButton.textContent = "搜索本地库";
  }
});

syncItraButton.addEventListener("click", async () => {
  const formData = new FormData(searchForm);
  const name = String(formData.get("name") || "").trim();
  const ageMin = String(formData.get("ageMin") || "").trim();
  const ageMax = String(formData.get("ageMax") || "").trim();
  const minPi = String(formData.get("minPi") || "").trim();
  const chinaOnly = document.getElementById("china-only").checked;

  if (name.length < 2) {
    setStatus(searchStatus, "姓名至少需要 2 个字符。", "error");
    return;
  }

  searchButton.disabled = true;
  syncItraButton.disabled = true;
  syncItraButton.textContent = "同步中...";
  searchResults.innerHTML = "";
  setStatus(searchStatus, `正在从 ITRA 同步：${name}`, "muted");

  try {
    const params = new URLSearchParams({ name });
    if (ageMin) {
      params.set("ageMin", ageMin);
    }
    if (ageMax) {
      params.set("ageMax", ageMax);
    }
    if (minPi) {
      params.set("minPi", minPi);
    }
    if (chinaOnly) {
      params.set("chinaOnly", "true");
    }

    const response = await fetch(`/api/itra/sync?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "ITRA 同步失败");
    }

    state.searchResults = payload.items || [];
    if (!state.searchResults.length) {
      setStatus(searchStatus, `ITRA 没有返回与“${name}”匹配的跑友。`, "muted");
      searchResults.appendChild(createEmptyState("同步完成，但没有返回结果。"));
      return;
    }

    await Promise.all([loadSavedRunners(), loadOverview()]);
    setStatus(searchStatus, `已从 ITRA 同步 ${payload.syncedCount || state.searchResults.length} 位跑友。`, "success");
    state.searchResults.forEach((runner) => {
      searchResults.appendChild(buildRunnerCard(runner));
    });
    renderRunnerDetail(state.searchResults[0]);
  } catch (error) {
    setStatus(searchStatus, error.message, "error");
  } finally {
    searchButton.disabled = false;
    syncItraButton.disabled = false;
    syncItraButton.textContent = "从 ITRA 同步";
  }
});

Promise.all([loadSavedRunners(), loadOverview(), loadRaces()]).catch((error) => {
  setStatus(savedStatus, error.message || "初始化失败。", "error");
});
