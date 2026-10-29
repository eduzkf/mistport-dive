/* =========================================================
   雾港深巡 Mistport Dive · v0.1 (MVP)
   房间制随机肉鸽：灯油经济 + 强化三选一 + 血月层 + NPC 状态感知记忆
   原创玩法实现，美术为程序化绘制的原创视觉（雾港/灯火主题）
   ========================================================= */
"use strict";

/* ---------- 基础 ---------- */
const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
const W = cv.width, H = cv.height;
const WALL = 46;                       // 房间墙厚
const TAU = Math.PI * 2;

const keys = {};
addEventListener("keydown", (e) => {
  // Tab 开关 灯塔手记
  if (e.code === "Tab") { e.preventDefault(); G.codexOpen = !G.codexOpen; return; }
  // 手记打开时：1/2/3/4 切章节，其它键一律吞掉
  if (G.codexOpen) {
    if (e.code === "Digit1") G.codexTab = 0;
    else if (e.code === "Digit2") G.codexTab = 1;
    else if (e.code === "Digit3") G.codexTab = 2;
    else if (e.code === "Digit4") G.codexTab = 3;
    return;
  }
  // 对话进行中：空格推进对话（单次触发，不设 keys.Space，避免误攻击）
  if (e.code === "Space" && G.dialogue) { e.preventDefault(); advanceDialogue(); return; }
  keys[e.code] = true;
  if (["ArrowUp", "ArrowDown", "Left", "Right", "Space"].includes(e.code)) e.preventDefault();
  if (e.code === "F1") { e.preventDefault(); G.debug = !G.debug; }
  if (e.code === "Digit1") pickUpgrade(0);
  if (e.code === "Digit2") pickUpgrade(1);
  if (e.code === "Digit3") pickUpgrade(2);
  if (e.code === "KeyE") onInteract();
});
addEventListener("keyup", (e) => { keys[e.code] = false; });

/* ---------- 鼠标：跟踪光标 + 左键攻击 ---------- */
const mouse = { x: W / 2, y: H / 2, down: false };
function updateMouseFromEvent(e) {
  const rect = cv.getBoundingClientRect();
  // 缩放：canvas 内部分辨率 vs CSS 显示尺寸
  const sx = cv.width / rect.width;
  const sy = cv.height / rect.height;
  mouse.x = (e.clientX - rect.left) * sx;
  mouse.y = (e.clientY - rect.top) * sy;
}
cv.addEventListener("mousemove", updateMouseFromEvent);
cv.addEventListener("mousedown", (e) => {
  if (e.button === 0) { mouse.down = true; e.preventDefault(); }
});
addEventListener("mouseup", (e) => {
  if (e.button === 0) mouse.down = false;
});
cv.addEventListener("contextmenu", (e) => e.preventDefault());

const rnd = (a, b) => a + Math.random() * (b - a);
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

/* ---------- 跨局存档（localStorage，等价「云存档」记忆） ---------- */
function newCodex() {
  return {
    npcs: {},            // 人物章：speaker → [台词1, 台词2, ...]（去重）
    rooms: {},           // 见闻章：房间 type → true
    enemies: {},        // 见闻章：怪 kind → 击杀数
    kills: 0,           // 历程：累计击杀
    oil: 0,              // 历程：累计拾油
    bosses: 0,          // 历程：累计击杀 Boss
    deathBy: {},        // 历程：死因分布（暗室/血月/Boss/战斗 → 计数）
    buffs: {},           // 历程：每个强化被选过几次
    secrets: {},        // 秘闻：成就 id → true
    darkStreak: 0,      // 连续暗室死亡计数
  };
}
let SAVE = { runs: 0, wins: 0, lastDeath: null, bestFloor: 0, codex: newCodex() };
try {
  const raw = localStorage.getItem("mistport_v1");
  if (raw) {
    const parsed = JSON.parse(raw);
    SAVE = Object.assign(SAVE, parsed);
    if (!SAVE.codex) SAVE.codex = newCodex();
    ["npcs", "rooms", "enemies", "deathBy", "buffs", "secrets"].forEach((k) => {
      if (!SAVE.codex[k]) SAVE.codex[k] = {};
    });
  }
} catch (e) { /* 隐私模式下忽略 */ }
function persist() {
  try { localStorage.setItem("mistport_v1", JSON.stringify(SAVE)); } catch (e) {}
}

/* ---------- 灯塔手记：记录辅助 ---------- */
function recordHeard(speaker, line) {
  if (!speaker || !line) return;
  if (!SAVE.codex.npcs[speaker]) SAVE.codex.npcs[speaker] = [];
  if (!SAVE.codex.npcs[speaker].includes(line)) {
    SAVE.codex.npcs[speaker].push(line);
    persist();
  }
}
function recordSeenRoom(type) {
  if (type && !SAVE.codex.rooms[type]) { SAVE.codex.rooms[type] = true; persist(); }
}
function recordSeenEnemy(kind) {
  SAVE.codex.enemies[kind] = (SAVE.codex.enemies[kind] || 0) + 1;
  persist();
}
function bumpStat(field, n) {
  SAVE.codex[field] = (SAVE.codex[field] || 0) + (n || 1);
}
function bumpSecret(id) {
  if (!SAVE.codex.secrets[id]) { SAVE.codex.secrets[id] = true; persist(); }
}

/* ---------- 数据表：道具（以撒式，共 100 个：机制类手工设计 + 数值类模板生成） ---------- */
/* fx 数据驱动字段：
   dmg(+n) dmgMul(×) atkMul(<1更快) rangeAdd/rangeMul speedMul heart(+n并回复) tearSize(×) oilStart(+n)
   flag 类：triple pierce bounce homing burn echo blade blood greed scav wick laststand iron */
const RARS = ["常见", "稀有", "史诗"];
const RAR_COLOR = ["#8aa2b8", "#7ea1ff", "#e8b34b"];

/* ---------- 数据表：道具（管线生成，真源在 pipeline/content/*.yaml，勿在此硬编码） ---------- */
const D = window.MISTPORT_DATA;        // 由 data.generated.js 提供（index.html 先于本文件加载）
const BAL = D.balance;
const UPGRADES = D.items;

/* ---------- 数据表：NPC 台词（真源 pipeline/content/npcs.yaml，分支按数组顺序求值） ---------- */
function interpLines(lines) {
  return lines.map((s) => s.replaceAll("{next_run}", SAVE.runs + 1));
}
function lanLines() {
  for (const b of D.npcs.lan.branches) {
    const w = b.when;
    if (!w) return interpLines(b.lines);                                  // default 兜底
    if (w.runs_eq !== undefined && SAVE.runs === w.runs_eq) return interpLines(b.lines);
    if (w.last_death !== undefined && SAVE.lastDeath === w.last_death) return interpLines(b.lines);
    if (w.wins_min !== undefined && SAVE.wins >= w.wins_min) return interpLines(b.lines);
  }
  return ["……"];
}
const YAN_LINES = D.npcs.yan.lines;

/* ---------- 全局状态 ---------- */
const G = {
  state: "lobby",          // lobby | play | upgrade | over | win
  debug: false,
  time: 0,
  // run 数据
  floor: 0, roomIdx: 0, rooms: [],
  oilStart: 0, oilTotal: 0, kills: 0,
  deathCause: null,
  eliteBonus: false,
  // 实体
  player: null, enemies: [], orbs: [], pickups: [], tears: [], fx: [],
  room: null,              // 当前房间运行时数据
  dialogue: null,          // {speaker, lines, idx}
  offer: null,             // 强化三选一
  boss: null, waves: null,
  // 灯塔手记
  codexOpen: false,
  codexTab: 0,             // 0=人物 1=见闻 2=历程 3=秘闻
};

function newPlayer() {
  const B = BAL.player;
  return {
    x: W / 2, y: H / 2, r: 13,
    hp: B.hp, maxHp: B.hp, speed: B.speed,
    dmg: B.dmg, atkCd: B.atk_cd, cd: 0,
    range: B.range, tearR: B.tear_r,   // 泪滴射程(px) / 半径
    oil: B.oil, inv: 0, face: { x: 0, y: 1 },
    buffs: {}, echoT: 0,
    darkT: 0, hurtT: 0,
  };
}

/* ---------- 楼层 / 房间生成 ---------- */
function genFloor(fi) {
  G.floor = fi; G.roomIdx = 0;
  let seq;
  if (fi === 0) {
    seq = ["battle", "battle"];
    if (Math.random() < 0.15) seq[1] = "elite";
    if (Math.random() < 0.5) seq.reverse();
  } else if (fi === 1) {
    seq = ["battle", "dark", "shop"];
    if (Math.random() < 0.15) seq[0] = "elite";
    if (Math.random() < 0.5) { seq = [seq[1], seq[0], seq[2]]; }
  } else if (fi === 2) {
    seq = ["waves", "boss"];
  } else {
    // 无尽模式：第 4 层起随机 3 间 + Boss，深度越深怪越强
    const pool = ["battle", "battle", "elite", "dark", "shop", "event", "waves"];
    seq = [pick(pool), pick(pool), pick(pool), "boss"];
  }
  G.rooms = seq;
  enterRoom(0);
}

function makeRoom(type) {
  const r = {
    type, cleared: false, pillars: [],
    drain: 0, hurtT: 0,           // 暗室计时
    wave: 0, waveT: 0,            // 血月波次
    goods: null,                  // 商店
    chest: null, eventKind: null, eventDone: false,
  };
  // 随机柱子
  const n = rndi(2, 4);
  for (let i = 0; i < n; i++) {
    r.pillars.push({ x: rnd(140, W - 140), y: rnd(140, H - 140), w: rndi(30, 60), h: rndi(30, 60) });
  }
  if (type === "shop") {
    // 砚站在店堂上方
    r.keeper = { x: W / 2, y: 130 };
    // 商品：1 个心灯（消耗品）+ 2 个随机道具（未拥有优先），每次进店随机刷新
    const owned = Object.keys(G.player ? G.player.buffs : {});
    const avail = UPGRADES.filter((u) => !owned.includes(u.id));
    const pool = avail.length >= 2 ? avail : UPGRADES;
    const a = pick(pool);
    let b = pick(pool);
    let tries = 0;
    while (b.id === a.id && tries < 40) { b = pick(pool); tries++; }
    const itemPrice = (u) => BAL.shop.base_price + u.rar * BAL.shop.price_per_rar;
    r.goods = [
      { name: "心灯", desc: "回复 " + BAL.shop.heal_amount + " 生命", cost: BAL.shop.heal_price, id: "heal" },
      { name: a.name, desc: a.desc, cost: itemPrice(a), item: a },
      { name: b.name, desc: b.desc, cost: itemPrice(b), item: b },
    ];
    // 随机打乱货架位置
    r.goods.sort(() => Math.random() - 0.5);
    r.goods.forEach((g, i) => { g.x = W / 2 + (i - 1) * 150; g.y = 200; g.sold = false; });
  }
  if (type === "dark") {
    r.exit = { x: W / 2, y: WALL + 26, r: 30 };   // 出口光圈（到顶边）
  }
  if (type === "event") {
    r.eventKind = pick(["chest", "trap", "mystery"]);
    if (r.eventKind === "chest") r.chest = { x: W / 2, y: H / 2, open: false };
  }
  return r;
}

function spawnEnemies(type) {
  G.enemies = []; G.orbs = []; G.pickups = []; G.tears = []; G.fx = []; G.boss = null;
  const f = G.floor;
  // 无尽深度缩放（参数来自 balance.yaml）
  const DS = BAL.depth_scaling;
  const dm = f > DS.from_floor ? 1 + (f - DS.from_floor) * DS.hp_step : 1;
  const sp = f > DS.from_floor ? (f - DS.from_floor) * DS.spd_step : 0;
  const HP = (n) => Math.round(n * dm);
  const base = { vx: 0, vy: 0, burn: 0, t: rnd(0, 9) };
  if (type === "battle" || type === "elite") {
    const elite = type === "elite";
    const nW = elite ? 2 : (f === 0 ? 3 : 4);
    for (let i = 0; i < nW; i++) G.enemies.push(Object.assign({}, base, { kind: "wisp", x: rnd(120, W - 120), y: rnd(120, H - 120), r: 11, hp: HP(3), maxHp: HP(3), spd: 68 + f * 8 + sp, dmg: 1, drop: 2 }));
    if (f >= 1) for (let i = 0; i < (elite ? 1 : 2); i++) G.enemies.push(Object.assign({}, base, { kind: "spit", x: rnd(120, W - 120), y: rnd(120, H - 120), r: 12, hp: HP(2), maxHp: HP(2), spd: 55 + sp, dmg: 1, drop: 2, shootT: rnd(1, 2.5) }));
    if (elite) G.enemies.push(Object.assign({}, base, { kind: "brute", x: W / 2, y: 150, r: 17, hp: HP(8), maxHp: HP(8), spd: 52 + sp, dmg: 2, drop: 4 }));
  } else if (type === "dark") {
    for (let i = 0; i < 2; i++) G.enemies.push(Object.assign({}, base, { kind: "wisp", x: rnd(120, W - 120), y: rnd(200, H - 120), r: 11, hp: HP(3), maxHp: HP(3), spd: 62 + sp, dmg: 1, drop: 2 }));
  } else if (type === "waves") {
    G.room.wave = 0; G.room.waveT = 1.2;
    G.wavesDef = [
      () => { for (let i = 0; i < 3; i++) G.enemies.push(Object.assign({}, base, { kind: "wisp", x: rnd(120, W - 120), y: rnd(120, H - 120), r: 11, hp: HP(3), maxHp: HP(3), spd: 80 + sp, dmg: 1, drop: 2 })); },
      () => { for (let i = 0; i < 2; i++) G.enemies.push(Object.assign({}, base, { kind: "wisp", x: rnd(120, W - 120), y: rnd(120, H - 120), r: 11, hp: HP(3), maxHp: HP(3), spd: 84 + sp, dmg: 1, drop: 2 }));
              for (let i = 0; i < 2; i++) G.enemies.push(Object.assign({}, base, { kind: "spit", x: rnd(120, W - 120), y: rnd(120, H - 120), r: 12, hp: HP(2), maxHp: HP(2), spd: 55 + sp, dmg: 1, drop: 2, shootT: rnd(1, 2) })); },
      () => { G.enemies.push(Object.assign({}, base, { kind: "brute", x: W / 2, y: 150, r: 17, hp: HP(10), maxHp: HP(10), spd: 58 + sp, dmg: 2, drop: 4 }));
              for (let i = 0; i < 2; i++) G.enemies.push(Object.assign({}, base, { kind: "wisp", x: rnd(120, W - 120), y: rnd(200, H - 120), r: 11, hp: HP(3), maxHp: HP(3), spd: 84 + sp, dmg: 1, drop: 2 })); },
    ];
  } else if (type === "boss") {
    G.boss = Object.assign({}, base, { kind: "boss", x: W / 2, y: 170, r: 22, hp: HP(45), maxHp: HP(45), spd: 62 + sp, dmg: 2, phase: 1, tele: null, atkT: 2.5, summoned: false });
  }
}

function enterRoom(idx) {
  G.roomIdx = idx;
  const type = G.rooms[idx];
  G.room = makeRoom(type);
  spawnEnemies(type);
  G.player.x = W / 2; G.player.y = H - 110;
  G.player.inv = 0.6;
  if (type === "waves" || type === "boss") G.room.cleared = false;
  else if (type === "dark" || type === "shop") G.room.cleared = true; // 出口即通（商店出口常开）
  else G.room.cleared = (G.enemies.length === 0);
  if (type === "event") G.room.cleared = true;
  recordSeenRoom(type);
  // Boss 战开始：满油进 Boss 秘闻
  if (type === "boss" && G.player.oil >= 10) bumpSecret("full_oil_boss");
}

/* ---------- 拾取 / 特效 ---------- */
function makePickup(x, y, v) { return { x, y, v, t: 0, kind: "oil" }; }
function addFx(x, y, color, life, r) { G.fx.push({ x, y, color, life, max: life, r: r || 16 }); }
function gainOil(n) { G.player.oil += n; G.oilTotal += n; bumpStat("oil", n); }

/* ---------- 掉落 ---------- */
function dropOil(e) {
  let n = e.drop || 0;
  if (G.player.buffs.greed) n += 1;
  if (G.player.buffs.scav && e.kind !== "brute") n = Math.max(1, n - 1);
  for (let i = 0; i < n; i++) G.pickups.push(makePickup(e.x + rnd(-14, 14), e.y + rnd(-14, 14), 1));
  recordSeenEnemy(e.kind);
  bumpStat("kills", 1);
  G.kills++;
}

/* ---------- 玩家伤害 ---------- */
function hurtPlayer(dmg, cause) {
  const p = G.player;
  if (p.inv > 0) return;
  p.hp -= dmg; p.inv = 0.8 + (p.buffs.iron ? 0.4 : 0); p.hurtT = 0.25;
  if (p.buffs.blood && Math.random() < 0.5) {
    for (let i = 0; i < 2; i++) G.pickups.push(makePickup(p.x + rnd(-20, 20), p.y + rnd(-20, 20), 1));
  }
  if (p.hp <= 0) { G.deathCause = cause; gameOver(); }
}

/* ---------- 攻击：以撒式泪滴 ---------- */
function shootTear(angleOffset, force) {
  const p = G.player;
  if (p.cd > 0 && !force) return;
  p.cd = p.atkCd;
  const base = Math.atan2(p.face.y, p.face.x) + (angleOffset || 0);
  let dmg = p.dmg;
  if (p.buffs.triple) dmg *= 0.7;
  if (G.room && G.room.type === "dark" && p.buffs.blade) dmg *= 2;
  if (p.buffs.laststand && p.hp <= 2) dmg *= 2;
  const spd = 380;
  const tearR = p.tearR;
  G.tears.push({
    x: p.x + Math.cos(base) * 14, y: p.y + Math.sin(base) * 14,
    vx: Math.cos(base) * spd, vy: Math.sin(base) * spd,
    dmg, r: tearR, dist: 0, maxDist: p.range,
    pierce: !!p.buffs.pierce, bounces: p.buffs.bounce ? 2 : 0,
    burn: !!p.buffs.burn, hit: [],
  });
}
function tryShoot() {
  const p = G.player;
  if (p.cd > 0) return;
  if (p.buffs.triple) { shootTear(-0.22, true); shootTear(0.22, true); }
  shootTear(0, true);
}

/* 泪滴命中一个敌人（pierce 用 hit 记录防重复） */
function tearHitEnemy(t, e) {
  e.hp -= t.dmg;
  const ang = Math.atan2(t.vy, t.vx);
  e.vx += Math.cos(ang) * 120; e.vy += Math.sin(ang) * 120;
  addFx(e.x, e.y, "#ffd27a", 0.2, 10);
  if (t.burn) e.burn = 2;
  t.hit.push(e);
  if (e.hp <= 0) dropOil(e);   // dropOil 内含击杀计数与手记登记
}

function updateTears(dt) {
  const p = G.player;
  for (const t of G.tears) {
    // 循光泪：缓慢追踪最近敌人
    if (p.buffs.homing) {
      let best = null, bd = 1e9;
      for (const e of G.enemies) {
        if (t.hit.includes(e) || e.hp <= 0) continue;
        const d = dist(t.x, t.y, e.x, e.y);
        if (d < bd) { bd = d; best = e; }
      }
      if (best && bd < 220) {
        const ang = Math.atan2(best.y - t.y, best.x - t.x);
        const cur = Math.atan2(t.vy, t.vx);
        const spd = Math.hypot(t.vx, t.vy);
        // 角度缓慢偏向目标
        let diff = ((ang - cur + Math.PI * 3) % TAU) - Math.PI;
        const na = cur + clamp(diff, -3 * dt, 3 * dt);
        t.vx = Math.cos(na) * spd; t.vy = Math.sin(na) * spd;
      }
    }
    t.x += t.vx * dt; t.y += t.vy * dt;
    t.dist += Math.hypot(t.vx, t.vy) * dt;
    // 墙壁：反弹或消失
    if (t.x < WALL + t.r || t.x > W - WALL - t.r || t.y < WALL + t.r || t.y > H - WALL - t.r) {
      if (t.bounces > 0) {
        t.bounces--;
        if (t.x < WALL + t.r || t.x > W - WALL - t.r) t.vx *= -1;
        if (t.y < WALL + t.r || t.y > H - WALL - t.r) t.vy *= -1;
        t.x = clamp(t.x, WALL + t.r, W - WALL - t.r);
        t.y = clamp(t.y, WALL + t.r, H - WALL - t.r);
      } else { t.dist = t.maxDist + 1; addFx(t.x, t.y, "#9db4c0", 0.2, t.r); }
    }
    // 敌人命中
    for (const e of G.enemies) {
      if (e.hp <= 0 || t.hit.includes(e)) continue;
      if (dist(t.x, t.y, e.x, e.y) < t.r + e.r) {
        tearHitEnemy(t, e);
        if (!t.pierce) { t.dist = t.maxDist + 1; break; }
      }
    }
    // Boss 命中
    if (t.dist <= t.maxDist && G.boss && G.boss.hp > 0 && !t.hit.includes(G.boss)) {
      const b = G.boss;
      if (dist(t.x, t.y, b.x, b.y) < t.r + b.r) {
        b.hp -= t.dmg;
        addFx(b.x, b.y, "#ffd27a", 0.2, 12);
        t.hit.push(b);
        if (b.hp <= 0) bossDown();
        if (!t.pierce) t.dist = t.maxDist + 1;
      }
    }
  }
  G.tears = G.tears.filter((t) => t.dist <= t.maxDist);
}

/* ---------- 道具应用（层末三选一 / 道具基座 / 商店共用） ---------- */
function applyItem(u) {
  const p = G.player;
  p.buffs[u.id] = true;
  const fx = u.fx || {};
  if (fx.dmg) p.dmg += fx.dmg;
  if (fx.dmgMul) p.dmg *= fx.dmgMul;
  if (fx.atkMul) p.atkCd *= fx.atkMul;
  if (fx.rangeAdd) p.range += fx.rangeAdd;
  if (fx.rangeMul) p.range *= fx.rangeMul;
  if (fx.speedMul) p.speed *= fx.speedMul;
  if (fx.tearSize) p.tearR *= fx.tearSize;
  if (fx.heart) { p.maxHp += fx.heart; p.hp = Math.min(p.maxHp, p.hp + fx.heart); }
  if (fx.oilStart) { p.oil += fx.oilStart; G.oilTotal += fx.oilStart; }
  SAVE.codex.buffs[u.id] = (SAVE.codex.buffs[u.id] || 0) + 1;
  persist();
  addFx(p.x, p.y, "#ffcf6e", 0.5, 26);
  G.dialogue = { speaker: "灯塔手记", lines: ["拾取了【" + u.name + "】· " + u.desc], idx: 0 };
  recordHeard("灯塔手记", "拾取了【" + u.name + "】· " + u.desc);
}
/* ---------- 交互 ---------- */
function onInteract() {
  // 对话进行中：任何状态下按 E 都只推进对话，不触发其他交互
  if (G.dialogue) { advanceDialogue(); return; }
  if (G.state === "lobby") {
    const p = G.player;
    // 岚
    if (dist(p.x, p.y, W / 2 - 130, H / 2) < 46) {
      const lines = lanLines();
      G.dialogue = { speaker: "守塔人·岚", lines, idx: 0 };
      recordHeard("守塔人·岚", lines[0]);
      return;
    }
    if (dist(p.x, p.y, W / 2 + 130, H / 2) < 46) {
      G.dialogue = { speaker: "商人·砚", lines: YAN_LINES, idx: 0 };
      recordHeard("商人·砚", YAN_LINES[0]);
      return;
    }
    // 出发门
    if (dist(p.x, p.y, W / 2, 125) < 60) startRun();
  } else if (G.state === "play") {
    // 道具基座
    if (G.room && G.room.pedestal && !G.room.pedestal.taken) {
      const pd = G.room.pedestal;
      if (dist(G.player.x, G.player.y, pd.x, pd.y) < 46) {
        pd.taken = true;
        applyItem(pd.item);
        return;
      }
    }
    // 商店
    if (G.room && G.room.type === "shop") {
      // 和砚说话
      if (G.room.keeper && dist(G.player.x, G.player.y, G.room.keeper.x, G.room.keeper.y + 6) < 44) {
        G.dialogue = { speaker: "商人·砚", lines: [pick(YAN_LINES)], idx: 0 };
        recordHeard("商人·砚", G.dialogue.lines[0]);
        return;
      }
      for (const g of G.room.goods) {
        if (!g.sold && dist(G.player.x, G.player.y, g.x, g.y + 40) < 55) {
          if (G.player.oil >= g.cost) {
            G.player.oil -= g.cost; g.sold = true;
            if (g.id === "heal") { G.player.hp = Math.min(G.player.maxHp, G.player.hp + BAL.shop.heal_amount); }
            if (g.item) { applyItem(g.item); }
            else addFx(g.x, g.y, "#ffd27a", 0.4, 20);
          } else {
            const lines = ["油不够。", "下次带够。"];
            G.dialogue = { speaker: "商人·砚", lines, idx: 0 };
            recordHeard("商人·砚", lines[0]);
          }
          break;
        }
      }
    }
  } else if (G.state === "over" || G.state === "win") {
    toLobby();
  }
}
function advanceDialogue() {
  if (!G.dialogue) return;
  G.dialogue.idx++;
  if (G.dialogue.idx >= G.dialogue.lines.length) {
    G.dialogue = null;
  } else {
    // 推进到新的一句 → 记录
    recordHeard(G.dialogue.speaker, G.dialogue.lines[G.dialogue.idx]);
  }
}

/* ---------- 流程 ---------- */
function startRun() {
  G.player = newPlayer();
  G.oilStart = G.player.oil; G.oilTotal = 0; G.kills = 0; G.deathCause = null; G.eliteBonus = false;
  genFloor(0);
  G.state = "play";
}
function gameOver() {
  G.state = "over";
  SAVE.runs++; SAVE.lastDeath = G.deathCause;
  SAVE.bestFloor = Math.max(SAVE.bestFloor, G.floor + (G.deathCause === "boss" ? 1 : 0));
  // 历程：死因分布
  SAVE.codex.deathBy[G.deathCause] = (SAVE.codex.deathBy[G.deathCause] || 0) + 1;
  // 暗室连死
  if (G.deathCause === "dark") {
    SAVE.codex.darkStreak = (SAVE.codex.darkStreak || 0) + 1;
    if (SAVE.codex.darkStreak >= 3) bumpSecret("dark_die_3");
  } else {
    SAVE.codex.darkStreak = 0;
  }
  persist();
}
function winGame() {
  // 已被 bossDown 取代（无尽模式），保留防误调
  bossDown();
}
function bossDown() {
  bumpStat("bosses", 1);
  SAVE.bestFloor = Math.max(SAVE.bestFloor, G.floor + 1);
  G.boss = null;
  if (G.room) G.room.cleared = true;   // Boss 房底边门向下开
  if (!SAVE.wins) {
    // 首次点灯
    SAVE.wins++; SAVE.lastDeath = null;
    bumpSecret("first_win");
    // 不带任何强化点灯
    if (Object.keys(G.player.buffs).length === 0) bumpSecret("no_buff_win");
    persist();
    G.dialogue = { speaker: "守塔人·岚", lines: ["……塔顶的雾，散了一寸。", "灯塔复明了。", "但你脚下的门——", "是向下开的。"], idx: 0 };
    ["……塔顶的雾，散了一寸。", "灯塔复明了。", "但你脚下的门——", "是向下开的。"].forEach((l) => recordHeard("守塔人·岚", l));
  } else {
    persist();
  }
}
function toLobby() {
  G.state = "lobby";
  G.player = newPlayer();
  G.enemies = []; G.orbs = []; G.pickups = []; G.tears = []; G.fx = []; G.boss = null;
  G.dialogue = null; G.offer = null;
}
toLobby(); // 启动进大厅

/* ---------- 强化三选一 ---------- */
function openUpgrade() {
  const pool = [];
  const weighted = [];
  for (const u of UPGRADES) {
    const w = u.rar === 0 ? 6 : u.rar === 1 ? 3 : 1;
    for (let i = 0; i < w; i++) weighted.push(u);
  }
  while (pool.length < 3) {
    const u = pick(weighted);
    if (!pool.includes(u)) pool.push(u);
  }
  if (G.eliteBonus) {
    const rares = UPGRADES.filter((u) => u.rar >= 1 && !pool.includes(u));
    if (rares.length) pool[rndi(0, 2)] = pick(rares);
    G.eliteBonus = false;
  }
  G.offer = pool;
  G.state = "upgrade";
}
function pickUpgrade(i) {
  if (G.state !== "upgrade" || !G.offer || !G.offer[i]) return;
  applyItem(G.offer[i]);
  G.offer = null;
  nextFloorOrRoom();
}
function afterUpgrade() { /* 强化在层末触发 */ }

/* ---------- 层/房间推进 ---------- */
function nextRoom() {
  if (G.roomIdx + 1 < G.rooms.length) {
    enterRoom(G.roomIdx + 1);
  } else {
    openUpgrade();
  }
}
function nextFloorOrRoom() {
  // 无尽模式：层数无上限
  genFloor(G.floor + 1);
  G.state = "play";
}

/* ---------- 更新 ---------- */
function update(dt) {
  G.time += dt;
  const p = G.player;
  if (G.state === "lobby" || G.state === "play") {
    // 移动
    let dx = 0, dy = 0;
    if (keys.KeyW || keys.ArrowUp) dy -= 1;
    if (keys.KeyS || keys.ArrowDown) dy += 1;
    if (keys.KeyA || keys.ArrowLeft) dx -= 1;
    if (keys.KeyD || keys.ArrowRight) dx += 1;
    if (dx || dy) {
      const l = Math.hypot(dx, dy);
      p.x += (dx / l) * p.speed * dt;
      p.y += (dy / l) * p.speed * dt;
    }
    // 朝向 = 鼠标方向（覆盖移动方向）
    let mdx = mouse.x - p.x, mdy = mouse.y - p.y;
    const ml = Math.hypot(mdx, mdy) || 1;
    p.face = { x: mdx / ml, y: mdy / ml };
    p.x = clamp(p.x, WALL + p.r, W - WALL - p.r);
    p.y = clamp(p.y, WALL + p.r, H - WALL - p.r);
    p.cd = Math.max(0, p.cd - dt);
    p.inv = Math.max(0, p.inv - dt);
    p.hurtT = Math.max(0, p.hurtT - dt);
    if (mouse.down && G.state === "play") tryShoot();
  }

  if (G.state === "play") {
    const room = G.room;
    // 回声：自动射一滴泪（朝当前鼠标方向，不影响手动射击冷却）
    if (p.buffs.echo) {
      p.echoT += dt;
      if (p.echoT >= 3) {
        p.echoT = 0;
        const savedCd = p.cd; p.cd = 0;
        shootTear(0);
        p.cd = savedCd;
      }
    }
    // 泪滴
    updateTears(dt);
    // 燃烧
    for (const e of G.enemies) {
      if (e.burn > 0) {
        e.burn -= dt;
        e.burnTick = (e.burnTick || 0) + dt;
        if (e.burnTick >= 0.5) { e.burnTick = 0; e.hp -= 1; addFx(e.x, e.y, "#ff8c42", 0.2, 8); if (e.hp <= 0) dropOil(e); }
      }
    }
    // 敌人
    for (const e of G.enemies) {
      if (e.hp <= 0) continue;
      e.t += dt;
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
      if (e.kind === "wisp" || e.kind === "brute" || e.kind === "shadow") {
        e.x += (dx / d) * e.spd * dt + (e.vx || 0) * dt;
        e.y += (dy / d) * e.spd * dt + (e.vy || 0) * dt;
        if (d < e.r + p.r + 2) hurtPlayer(e.dmg, G.floor >= 2 && room.type === "waves" ? "blood" : "battle");
      } else if (e.kind === "spit") {
        const want = d < 130 ? -1 : d > 210 ? 1 : 0;
        e.x += (dx / d) * e.spd * want * dt;
        e.y += (dy / d) * e.spd * want * dt;
        e.shootT -= dt;
        if (e.shootT <= 0) {
          e.shootT = 2.2;
          G.orbs.push({ x: e.x, y: e.y, vx: (dx / d) * 150, vy: (dy / d) * 150, t: 4 });
        }
      }
      e.x = clamp(e.x, WALL + e.r, W - WALL - e.r);
      e.y = clamp(e.y, WALL + e.r, H - WALL - e.r);
      // 击退衰减
      e.vx = (e.vx || 0) * Math.pow(0.001, dt);
      e.vy = (e.vy || 0) * Math.pow(0.001, dt);
    }
    G.enemies = G.enemies.filter((e) => e.hp > 0);
    // 敌人两两分离
    for (let i = 0; i < G.enemies.length; i++)
      for (let j = i + 1; j < G.enemies.length; j++) {
        const a = G.enemies[i], b = G.enemies[j];
        const d = dist(a.x, a.y, b.x, b.y);
        if (d < a.r + b.r && d > 0) {
          const px = (a.x - b.x) / d, py = (a.y - b.y) / d, ov = (a.r + b.r - d) / 2;
          a.x += px * ov; a.y += py * ov; b.x -= px * ov; b.y -= py * ov;
        }
      }
    // 弹幕
    for (const o of G.orbs) {
      o.x += o.vx * dt; o.y += o.vy * dt; o.t -= dt;
      if (dist(o.x, o.y, p.x, p.y) < p.r + 6) { o.t = 0; hurtPlayer(1, "battle"); }
      if (o.x < WALL || o.x > W - WALL || o.y < WALL || o.y > H - WALL) o.t = 0;
    }
    G.orbs = G.orbs.filter((o) => o.t > 0);
    // 拾取
    for (const pk of G.pickups) {
      pk.t += dt;
      const d = dist(pk.x, pk.y, p.x, p.y);
      if (d < 70) { pk.x += (p.x - pk.x) / d * 90 * dt; pk.y += (p.y - pk.y) / d * 90 * dt; }
      if (d < p.r + 10) { gainOil(pk.v); pk.t = -99; addFx(pk.x, pk.y, "#ffcf6e", 0.25, 10); }
    }
    G.pickups = G.pickups.filter((pk) => pk.t > -50);
    // 暗室
    if (room.type === "dark") {
      const DR = BAL.dark_room;
      const interval = (p.buffs.wick || p.buffs.wick2) ? DR.drain_interval_wick : DR.drain_interval;
      room.drain += dt;
      if (room.drain >= interval) {
        room.drain = 0;
        if (p.oil > 0) { p.oil -= 1; addFx(p.x, p.y - 20, "#6b7a8c", 0.4, 14); }
      }
      if (p.oil <= 0) {
        room.hurtT += dt;
        if (room.hurtT >= DR.hurt_after) { room.hurtT = 0; hurtPlayer(1, "dark"); }
      }
      // 到达出口 → 离开暗室
      if (dist(p.x, p.y, room.exit.x, room.exit.y) < room.exit.r) { nextRoom(); return; }
    }
    // 商店/事件出口（底边门）
    if ((room.type === "shop" || room.type === "event" || room.type === "battle" || room.type === "elite") && room.cleared) {
      if (p.y >= H - WALL - p.r - 1) { nextRoom(); return; }
    }
    // 事件房交互
    if (room.type === "event" && !room.eventDone && room.chest && !room.chest.open) {
      if (dist(p.x, p.y, room.chest.x, room.chest.y) < 40) {
        room.chest.open = true; room.eventDone = true;
        const n = (p.buffs.scav ? 8 : 4);
        for (let i = 0; i < n; i++) G.pickups.push(makePickup(room.chest.x + rnd(-24, 24), room.chest.y + rnd(-24, 24), 1));
      }
    }
    if (room.type === "event" && room.eventKind === "trap" && !room.eventDone) {
      // 简单陷阱：中央火环周期性喷发
      room.waveT = (room.waveT || 0) + dt;
      if (room.waveT > 3) {
        room.waveT = 0;
        if (dist(p.x, p.y, W / 2, H / 2) < 130) hurtPlayer(1, "battle");
        addFx(W / 2, H / 2, "#ff7a4d", 0.5, 130);
        room.eventDone = true; // 踩过一次即视为完成（可走）
      }
      if (dist(p.x, p.y, W / 2, H / 2) > 130) room.cleared = true;
    }
    if (room.type === "event" && room.eventKind === "mystery" && !room.eventDone) {
      if (dist(p.x, p.y, W / 2, H / 2) < 40) {
        room.eventDone = true;
        const u = pick(UPGRADES.filter((x) => x.rar === 0));
        applyItem(u);
        G.dialogue = { speaker: "神秘灯", lines: ["一缕暖光……", "获得了【" + u.name + "】"], idx: 0 };
        recordHeard("神秘灯", "一缕暖光……");
      }
    }
    // 波次（血月）
    if (room.type === "waves") {
      if (G.enemies.length === 0) {
        room.waveT -= dt;
        if (room.waveT <= 0) {
          if (room.wave < G.wavesDef.length) {
            G.wavesDef[room.wave](); room.wave++; room.waveT = 2.2;
          } else { room.cleared = true; }
        }
      }
      if (room.cleared && p.y >= H - WALL - p.r - 1) { nextRoom(); return; }
    }
    // 战斗房清空判定 → 生成道具基座（以撒式）
    if ((room.type === "battle" || room.type === "elite") && !room.cleared && G.enemies.length === 0) {
      room.cleared = true;
      if (room.type === "elite") G.eliteBonus = true;
      // 基座：从未拿过的道具里抽一个
      const owned = Object.keys(p.buffs);
      const avail = UPGRADES.filter((u) => !owned.includes(u.id));
      if (avail.length > 0) {
        const weighted = [];
        for (const u of avail) {
          const w = u.rar === 0 ? 6 : u.rar === 1 ? 3 : 1;
          for (let i = 0; i < w; i++) weighted.push(u);
        }
        room.pedestal = { x: W / 2, y: H / 2, item: pick(weighted), taken: false };
      }
    }
    // Boss
    if (G.boss) {
      const b = G.boss;
      b.t += dt;
      if (b.hp <= b.maxHp / 2 && b.phase === 1) {
        b.phase = 2; b.spd = 90;
        if (!b.summoned) {
          b.summoned = true;
          for (let i = 0; i < 3; i++) G.enemies.push({ kind: "shadow", x: b.x + rnd(-60, 60), y: b.y + rnd(-60, 60), r: 10, hp: 2, maxHp: 2, spd: 105, dmg: 1, drop: 1, vx: 0, vy: 0, burn: 0, t: 0 });
        }
      }
      const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy) || 1;
      b.x += (dx / d) * b.spd * dt; b.y += (dy / d) * b.spd * dt;
      if (d < b.r + p.r + 2) hurtPlayer(b.dmg, "boss");
      b.atkT -= dt;
      if (b.atkT <= 0) {
        b.atkT = b.phase === 2 ? 3 : 4;
        b.tele = { x: p.x, y: p.y, t: 1 };
      }
      if (b.tele) {
        b.tele.t -= dt;
        if (b.tele.t <= 0) {
          if (dist(p.x, p.y, b.tele.x, b.tele.y) < 120) hurtPlayer(2, "boss");
          addFx(b.tele.x, b.tele.y, "#ff5a4d", 0.4, 120);
          b.tele = null;
        }
      }
      b.x = clamp(b.x, WALL + b.r, W - WALL - b.r);
      b.y = clamp(b.y, WALL + b.r, H - WALL - b.r);
    }
    // Boss 房：击杀后底边门向下开 → 层末三选一 → 下一层
    if (room.type === "boss" && room.cleared && p.y >= H - WALL - p.r - 1) { openUpgrade(); return; }
  }
  // 特效
  for (const f of G.fx) f.life -= dt;
  G.fx = G.fx.filter((f) => f.life > 0);
}

/* ---------- 渲染 ---------- */
function draw() {
  const p = G.player;
  // 背景
  ctx.fillStyle = "#101620";
  ctx.fillRect(0, 0, W, H);

  if (G.state === "lobby") drawLobby();
  else drawPlay();

  // 特效层
  for (const f of G.fx) {
    ctx.globalAlpha = f.life / f.max * 0.6;
    ctx.fillStyle = f.color;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1.2 - f.life / f.max), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // 血月红罩
  if (G.state === "play" && G.floor === 2) {
    ctx.fillStyle = "rgba(120,20,20,0.14)";
    ctx.fillRect(0, 0, W, H);
  }
  // 暗室遮罩
  if (G.state === "play" && G.room && G.room.type === "dark") {
    const lightR = clamp(120 + p.oil * 4, 90, 220);
    const g = ctx.createRadialGradient(p.x, p.y, lightR * 0.35, p.x, p.y, lightR);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(2,3,6,0.94)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // 暗角
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  if (G.state === "upgrade") drawUpgrade();
  if (G.state === "over") drawOver();
  if (G.state === "win") drawWin();
  drawDialogue();
  if (G.state === "play" || G.state === "upgrade") drawHUD();
  if (G.debug) drawDebug();
  if (G.codexOpen) drawCodex();
}

function drawWallsAndPillars(room) {
  ctx.strokeStyle = "#2a3548";
  ctx.lineWidth = 8;
  ctx.strokeRect(WALL / 2, WALL / 2, W - WALL, H - WALL);
  ctx.fillStyle = "#1a2230";
  for (const pl of room.pillars) ctx.fillRect(pl.x, pl.y, pl.w, pl.h);
}

function drawLanternBearer(x, y, r, hurt) {
  // 原创：提灯人——圆身 + 头顶小灯
  const g = ctx.createRadialGradient(x, y, 4, x, y, 60);
  g.addColorStop(0, "rgba(255,207,110,0.28)");
  g.addColorStop(1, "rgba(255,207,110,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, 60, 0, TAU); ctx.fill();
  ctx.fillStyle = hurt ? "#e8746a" : "#d8c9a3";
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = "#2b241a"; ctx.lineWidth = 2; ctx.stroke();
  // 灯
  ctx.fillStyle = "#ffcf6e";
  ctx.fillRect(x - 4, y - r - 12, 8, 10);
  ctx.strokeStyle = "#2b241a"; ctx.strokeRect(x - 4, y - r - 12, 8, 10);
  // 眼睛（朝向）
  ctx.fillStyle = "#2b241a";
  ctx.beginPath(); ctx.arc(x + G.player.face.x * 4 - 3, y + G.player.face.y * 3, 1.8, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(x + G.player.face.x * 4 + 3, y + G.player.face.y * 3, 1.8, 0, TAU); ctx.fill();
}

function drawLobby() {
  const p = G.player;
  ctx.fillStyle = "#0d121c";
  ctx.fillRect(WALL, WALL, W - WALL * 2, H - WALL * 2);
  ctx.strokeStyle = "#2a3548"; ctx.lineWidth = 8;
  ctx.strokeRect(WALL / 2, WALL / 2, W - WALL, H - WALL);
  // 标题
  ctx.fillStyle = "#e8dcc0";
  ctx.font = "bold 40px serif";
  ctx.textAlign = "center";
  ctx.fillText("雾 港 深 巡", W / 2, 56);
  ctx.font = "13px monospace";
  ctx.fillStyle = "#5a6b82";
  ctx.fillText("Mistport Dive ｜ 提灯下行，油尽人熄", W / 2, 80);
  // 出发门（下移，避开标题）
  ctx.fillStyle = "#223047";
  ctx.fillRect(W / 2 - 60, 98, 120, 54);
  ctx.strokeStyle = "#e8dcc0"; ctx.lineWidth = 2;
  ctx.strokeRect(W / 2 - 60, 98, 120, 54);
  ctx.fillStyle = "#e8dcc0"; ctx.font = "14px monospace";
  ctx.fillText("深 港 门", W / 2, 122);
  ctx.fillStyle = "#5a6b82"; ctx.font = "11px monospace";
  ctx.fillText("走进按 E 下港", W / 2, 140);
  // NPC 岚
  drawNPC(W / 2 - 130, H / 2, "#9db4c0", "岚");
  drawNPC(W / 2 + 130, H / 2, "#c9a86a", "砚");
  // 统计
  ctx.font = "13px monospace"; ctx.fillStyle = "#5a6b82";
  ctx.fillText("下港 " + SAVE.runs + " 次 ｜ 点灯 " + SAVE.wins + " 次 ｜ 最深第 " + SAVE.bestFloor + " 层", W / 2, H - 70);
  ctx.fillText("WASD 移动 · 鼠标瞄准 · 左键射泪 · E 交谈/拾取/进门 · 空格 推进对话 · Tab 手记", W / 2, H - 50);
  drawLanternBearer(p.x, p.y, p.r, p.hurtT > 0);
}

function drawNPC(x, y, color, label) {
  const t = G.time;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y + Math.sin(t * 2 + x) * 3, 14, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "#12161f"; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = "#12161f";
  ctx.beginPath(); ctx.arc(x - 4, y - 3, 1.8, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 4, y - 3, 1.8, 0, TAU); ctx.fill();
  ctx.font = "12px monospace"; ctx.textAlign = "center";
  ctx.fillStyle = "#8aa2b8";
  ctx.fillText(label + "（E）", x, y + 32);
}

function drawPlay() {
  const p = G.player, room = G.room;
  ctx.fillStyle = G.floor === 2 ? "#180f10" : "#121a26";
  ctx.fillRect(WALL, WALL, W - WALL * 2, H - WALL * 2);
  drawWallsAndPillars(room);
  // 出口提示
  if (room.type === "dark") {
    ctx.strokeStyle = "#ffcf6e"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(room.exit.x, room.exit.y, room.exit.r, 0, TAU); ctx.stroke();
    ctx.fillStyle = "#ffcf6e"; ctx.font = "12px monospace"; ctx.textAlign = "center";
    ctx.fillText("出口", room.exit.x, room.exit.y + 4);
  }
  if (room.cleared && (room.type !== "dark")) {
    ctx.fillStyle = "#7ea1ff"; ctx.font = "12px monospace"; ctx.textAlign = "center";
    ctx.fillText(room.type === "boss" ? "↓ 塔顶之门已开 · 走到下边缘继续下潜 ↓" : "↓ 门已开，走到下边缘离开 ↓", W / 2, H - WALL + 30);
  }
  if (room.type === "shop") {
    // 砚站在店堂
    if (room.keeper) drawNPC(room.keeper.x, room.keeper.y, "#c9a86a", "砚");
    for (const g of room.goods) {
      ctx.fillStyle = g.sold ? "#33404f" : "#223047";
      ctx.fillRect(g.x - 46, g.y, 92, 64);
      ctx.strokeStyle = g.item ? RAR_COLOR[g.item.rar] : "#3c4d63";
      ctx.strokeRect(g.x - 46, g.y, 92, 64);
      ctx.fillStyle = g.sold ? "#4a5a6c" : "#e8dcc0";
      ctx.font = "13px monospace"; ctx.textAlign = "center";
      ctx.fillText(g.name, g.x, g.y + 18);
      ctx.fillStyle = g.sold ? "#4a5a6c" : "#9db4c0";
      ctx.font = "10px monospace";
      wrapText(g.desc, g.x, g.y + 32, 88, 12);
      ctx.fillStyle = g.sold ? "#4a5a6c" : "#ffcf6e";
      ctx.font = "13px monospace";
      ctx.fillText(g.cost + " 油", g.x, g.y + 58);
      if (!g.sold) { ctx.fillStyle = "#5a6b82"; ctx.font = "10px monospace"; ctx.fillText("走近按 E", g.x, g.y + 76); }
    }
  }
  if (room.type === "event" && room.chest && !room.chest.open) {
    ctx.fillStyle = "#8a6d3b";
    ctx.fillRect(room.chest.x - 16, room.chest.y - 12, 32, 24);
    ctx.strokeStyle = "#e8dcc0"; ctx.strokeRect(room.chest.x - 16, room.chest.y - 12, 32, 24);
    ctx.fillStyle = "#5a6b82"; ctx.font = "12px monospace"; ctx.textAlign = "center";
    ctx.fillText("旧货箱（E）", room.chest.x, room.chest.y + 30);
  }
  // 拾取（灯油）
  for (const pk of G.pickups) {
    const yy = pk.y + Math.sin(pk.t * 4) * 2;
    const g2 = ctx.createRadialGradient(pk.x, yy, 1, pk.x, yy, 14);
    g2.addColorStop(0, "rgba(255,207,110,0.7)");
    g2.addColorStop(1, "rgba(255,207,110,0)");
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.arc(pk.x, yy, 14, 0, TAU); ctx.fill();
    ctx.fillStyle = "#ffcf6e";
    ctx.beginPath();
    ctx.moveTo(pk.x, yy - 6);
    ctx.quadraticCurveTo(pk.x + 5, yy, pk.x, yy + 6);
    ctx.quadraticCurveTo(pk.x - 5, yy, pk.x, yy - 6);
    ctx.fill();
  }
  // 敌人（原创：雾影 / 提灯怨灵 / 沉重者 / 暗影 / 无面守灯者）
  for (const e of G.enemies) {
    const wob = Math.sin(e.t * 5) * 2;
    if (e.kind === "wisp") {
      ctx.fillStyle = "rgba(157,180,192,0.85)";
      ctx.beginPath(); ctx.arc(e.x, e.y + wob * 0.3, e.r, 0, TAU); ctx.fill();
      ctx.fillStyle = "#12161f";
      ctx.beginPath(); ctx.arc(e.x - 3, e.y - 2, 1.6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(e.x + 3, e.y - 2, 1.6, 0, TAU); ctx.fill();
    } else if (e.kind === "spit") {
      ctx.fillStyle = "rgba(180,142,173,0.9)";
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#12161f"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "#ffcf6e";
      ctx.beginPath(); ctx.arc(e.x, e.y - 2, 2.5, 0, TAU); ctx.fill();
    } else if (e.kind === "brute") {
      ctx.fillStyle = "rgba(140,90,80,0.95)";
      ctx.beginPath(); ctx.arc(e.x, e.y + wob * 0.2, e.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#12161f"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#ff8c6e";
      ctx.fillRect(e.x - 6, e.y - 3, 12, 2);
    } else if (e.kind === "shadow") {
      ctx.fillStyle = "rgba(20,24,34,0.9)";
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#7ea1ff"; ctx.lineWidth = 1; ctx.stroke();
    }
    // 血条
    if (e.hp < e.maxHp) {
      ctx.fillStyle = "#000a";
      ctx.fillRect(e.x - 12, e.y - e.r - 8, 24, 3);
      ctx.fillStyle = "#e8746a";
      ctx.fillRect(e.x - 12, e.y - e.r - 8, 24 * e.hp / e.maxHp, 3);
    }
  }
  // 弹幕
  for (const o of G.orbs) {
    ctx.fillStyle = "#c9a0ff";
    ctx.beginPath(); ctx.arc(o.x, o.y, 5, 0, TAU); ctx.fill();
  }
  // Boss
  if (G.boss) {
    const b = G.boss;
    ctx.fillStyle = "rgba(10,12,18,0.95)";
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, b.r * 0.8, b.r * 1.25, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = b.phase === 2 ? "#ff5a4d" : "#8aa2b8"; ctx.lineWidth = 2; ctx.stroke();
    // 灯笼笼子
    ctx.strokeStyle = "#ffcf6e";
    ctx.strokeRect(b.x - 8, b.y - b.r - 22, 16, 18);
    ctx.beginPath(); ctx.moveTo(b.x - 8, b.y - b.r - 13); ctx.lineTo(b.x + 8, b.y - b.r - 13); ctx.stroke();
    if (b.tele) {
      ctx.strokeStyle = "rgba(255,90,77," + (0.4 + 0.4 * Math.sin(G.time * 12)) + ")";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(b.tele.x, b.tele.y, 120, 0, TAU); ctx.stroke();
    }
    // Boss 血条
    ctx.fillStyle = "#000a"; ctx.fillRect(W / 2 - 180, 26, 360, 8);
    ctx.fillStyle = "#e8746a"; ctx.fillRect(W / 2 - 180, 26, 360 * Math.max(0, b.hp) / b.maxHp, 8);
    ctx.fillStyle = "#e8dcc0"; ctx.font = "12px monospace"; ctx.textAlign = "center";
    ctx.fillText("无面守灯者" + (b.phase === 2 ? " · 怒" : ""), W / 2, 20);
  }
  // 玩家
  drawLanternBearer(p.x, p.y, p.r, p.hurtT > 0);
  // 玩家泪滴（灯火弹）
  for (const t of G.tears) {
    const g2 = ctx.createRadialGradient(t.x, t.y, 1, t.x, t.y, t.r + 4);
    g2.addColorStop(0, "rgba(255,224,160,0.95)");
    g2.addColorStop(1, "rgba(255,207,110,0)");
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r + 4, 0, TAU); ctx.fill();
    ctx.fillStyle = "#ffe8b0";
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, TAU); ctx.fill();
  }
  // 道具基座
  if (room.pedestal && !room.pedestal.taken) {
    const pd = room.pedestal;
    // 基座
    ctx.fillStyle = "#223047";
    ctx.fillRect(pd.x - 18, pd.y + 6, 36, 14);
    ctx.strokeStyle = "#3c4d63"; ctx.strokeRect(pd.x - 18, pd.y + 6, 36, 14);
    // 道具光球（按稀有度着色）
    const glow = 0.5 + 0.3 * Math.sin(G.time * 3);
    ctx.fillStyle = RAR_COLOR[pd.item.rar];
    ctx.globalAlpha = glow;
    ctx.beginPath(); ctx.arc(pd.x, pd.y - 6, 14, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#e8dcc0"; ctx.font = "12px monospace"; ctx.textAlign = "center";
    ctx.fillText(pd.item.name, pd.x, pd.y + 40);
    ctx.fillStyle = "#5a6b82";
    ctx.fillText("走近按 E 拾取", pd.x, pd.y + 56);
  }
  // 层标题
  ctx.fillStyle = "#8aa2b8"; ctx.font = "12px monospace"; ctx.textAlign = "left";
  const roomName = { battle: "雾影回廊", dark: "无光暗室", elite: "精英巢", shop: "砚的货栈", event: "失物之间", waves: "血月潮", boss: "塔顶" }[room.type] || "";
  ctx.fillText("第 " + (G.floor + 1) + " 层" + (G.floor === 2 ? " · 血月" : "") + " ｜ " + roomName, WALL + 8, WALL + 18);
}

function drawHUD() {
  const p = G.player;
  ctx.textAlign = "left";
  // 版本标记（右上角，用于确认浏览器加载的是否为最新脚本）
  ctx.textAlign = "right";
  ctx.fillStyle = "#44546a"; ctx.font = "11px monospace";
  ctx.fillText("v0.4", W - WALL - 8, WALL + 18);
  ctx.textAlign = "left";
  // 生命（灯火格）
  for (let i = 0; i < p.maxHp; i++) {
    ctx.fillStyle = i < p.hp ? "#ffcf6e" : "#2a3548";
    ctx.fillRect(WALL + 8 + i * 18, H - 34, 12, 16);
  }
  // 灯油
  const g = ctx.createRadialGradient(WALL + 20, H - 58, 1, WALL + 20, H - 58, 16);
  g.addColorStop(0, "rgba(255,207,110,0.8)"); g.addColorStop(1, "rgba(255,207,110,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(WALL + 20, H - 58, 16, 0, TAU); ctx.fill();
  ctx.fillStyle = "#e8dcc0"; ctx.font = "bold 15px monospace";
  ctx.fillText("油 " + p.oil, WALL + 34, H - 53);
  // 强化
  ctx.font = "11px monospace"; ctx.fillStyle = "#7ea1ff";
  const names = Object.keys(p.buffs).filter((k) => p.buffs[k]).map((k) => (UPGRADES.find((u) => u.id === k) || { name: k }).name);
  ctx.fillText("强化: " + (names.join("·") || "无"), WALL + 8, H - 64);
}

function drawUpgrade() {
  ctx.fillStyle = "rgba(5,8,14,0.82)";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#e8dcc0"; ctx.font = "bold 24px serif"; ctx.textAlign = "center";
  ctx.fillText("层 末 · 拾 一 盏", W / 2, 150);
  ctx.font = "13px monospace"; ctx.fillStyle = "#5a6b82";
  ctx.fillText("选一个强化（按 1 / 2 / 3）", W / 2, 176);
  G.offer.forEach((u, i) => {
    const x = W / 2 + (i - 1) * 240;
    ctx.fillStyle = "#141c2a";
    ctx.fillRect(x - 100, 220, 200, 190);
    ctx.strokeStyle = RAR_COLOR[u.rar]; ctx.lineWidth = 2;
    ctx.strokeRect(x - 100, 220, 200, 190);
    ctx.fillStyle = RAR_COLOR[u.rar]; ctx.font = "12px monospace";
    ctx.fillText(RARS[u.rar], x, 250);
    ctx.fillStyle = "#e8dcc0"; ctx.font = "bold 22px serif";
    ctx.fillText(u.name, x, 290);
    ctx.fillStyle = "#9db4c0"; ctx.font = "13px monospace";
    wrapText(u.desc, x, 325, 180, 18);
    ctx.fillStyle = "#5a6b82"; ctx.font = "13px monospace";
    ctx.fillText("[" + (i + 1) + "]", x, 390);
  });
}

function drawOver() {
  ctx.fillStyle = "rgba(5,8,14,0.85)";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#e8746a"; ctx.font = "bold 34px serif"; ctx.textAlign = "center";
  ctx.fillText("灯 熄 了", W / 2, 240);
  const cause = { dark: "暗室里的黑，把最后一点油也吃了。", boss: "守灯者收走了你的灯。", blood: "血月之下，雾影围住了你。", battle: "你倒在了回廊里。" }[G.deathCause] || "";
  ctx.fillStyle = "#9db4c0"; ctx.font = "15px monospace";
  ctx.fillText(cause, W / 2, 280);
  ctx.fillStyle = "#5a6b82"; ctx.font = "13px monospace";
  ctx.fillText("到达 第 " + (G.floor + 1) + " 层 ｜ 击杀 " + G.kills + " ｜ 本局拾油 " + G.oilTotal, W / 2, 310);
  ctx.fillStyle = "#e8dcc0"; ctx.font = "14px monospace";
  ctx.fillText("按 E 回到雾港", W / 2, 360);
}

function drawWin() {
  ctx.fillStyle = "rgba(5,8,14,0.85)";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffcf6e"; ctx.font = "bold 34px serif"; ctx.textAlign = "center";
  ctx.fillText("灯 塔 复 明", W / 2, 240);
  ctx.fillStyle = "#9db4c0"; ctx.font = "15px monospace";
  ctx.fillText("无面守灯者倒下了。雾退了一寸。", W / 2, 280);
  ctx.fillStyle = "#5a6b82"; ctx.font = "13px monospace";
  ctx.fillText("击杀 " + G.kills + " ｜ 本局拾油 " + G.oilTotal + " ｜ 累计点灯 " + SAVE.wins + " 次", W / 2, 310);
  ctx.fillStyle = "#e8dcc0"; ctx.font = "14px monospace";
  ctx.fillText("按 E 回到雾港", W / 2, 360);
}

function drawDialogue() {
  if (!G.dialogue) return;
  const d = G.dialogue;
  ctx.fillStyle = "rgba(8,12,20,0.92)";
  ctx.fillRect(60, H - 150, W - 120, 110);
  ctx.strokeStyle = "#3c4d63"; ctx.strokeRect(60, H - 150, W - 120, 110);
  ctx.fillStyle = "#7ea1ff"; ctx.font = "bold 14px monospace"; ctx.textAlign = "left";
  ctx.fillText(d.speaker, 80, H - 124);
  ctx.fillStyle = "#e8dcc0"; ctx.font = "16px serif";
  ctx.fillText(d.lines[d.idx] || "", 80, H - 92);
  ctx.fillStyle = "#5a6b82"; ctx.font = "11px monospace";
  ctx.fillText("空格 继续 (" + (d.idx + 1) + "/" + d.lines.length + ")", W - 210, H - 60);
}

function drawDebug() {
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(WALL + 4, WALL + 4, 250, 108);
  ctx.fillStyle = "#7CFFB2"; ctx.font = "11px monospace"; ctx.textAlign = "left";
  const lines = [
    "state=" + G.state + " t=" + G.time.toFixed(1),
    "floor=" + G.floor + " room=" + (G.room ? G.room.type : "-") + " idx=" + G.roomIdx,
    "enemies=" + G.enemies.length + " orbs=" + G.orbs.length + " pickups=" + G.pickups.length,
    "oil=" + G.player.oil + " hp=" + G.player.hp + "/" + G.player.maxHp,
    "buffs=" + Object.keys(G.player.buffs).filter((k) => G.player.buffs[k]).join(","),
    "data=" + D.meta.item_count + "items@" + D.meta.content_hash,
    "save=" + JSON.stringify(SAVE),
  ];
  lines.forEach((l, i) => ctx.fillText(l, WALL + 10, WALL + 22 + i * 15));
}

/* ---------- 灯塔手记 ---------- */
const CODEX_TABS = ["人物", "见闻", "历程", "秘闻"];
const ROOM_DESC = {
  battle: "雾影回廊：雾影游荡之地，清光才能驱散。",
  elite:  "精英巢：雾影最为稠密之处，必有一次格外耀眼。",
  dark:   "无光暗室：黑会吃油，油尽人熄。",
  shop:   "砚的货栈：只换，不送。",
  event:  "失物之间：旧货箱、火环、神秘灯皆可遇。",
  waves:  "血月潮：三波尸潮，第三波伴生精英。",
  boss:   "塔顶：无面守灯者栖息之地。",
};
const ENEMY_DESC = {
  wisp:   "雾影：怕光怕火的形，成群结队。",
  spit:   "提灯怨灵：远吐光弹，近身则逃。",
  brute:  "沉重者：笨拙但凶悍，惧击退不开。",
  shadow: "暗影：守灯者召唤之物，速度极快。",
  boss:   "无面守灯者：提灯人的脸都挂在塔顶，它没有脸。",
};
const DEATH_NAME = {
  dark:   "暗室耗尽",
  blood:  "血月陨落",
  boss:   "守灯者收灯",
  battle: "回廊断灯",
};
const SECRET_LIST = [
  { id: "first_win",     name: "首次点灯",       desc: "通关一次。" },
  { id: "no_buff_win",   name: "净身过塔",       desc: "不带任何强化通关。" },
  { id: "full_oil_boss", name: "整油见守灯者", desc: "满油进入 Boss 房。" },
  { id: "dark_die_3",    name: "暗室常客",       desc: "连续 3 次死在暗室。" },
];
function drawCodex() {
  const cx = WALL + 8, cy = WALL + 8, cw = W - WALL * 2 - 16, ch = H - WALL * 2 - 16;
  // 半透蒙板
  ctx.fillStyle = "rgba(8,12,20,0.94)";
  ctx.fillRect(0, 0, W, H);
  // 边框
  ctx.strokeStyle = "#3c4d63"; ctx.lineWidth = 2;
  ctx.strokeRect(cx, cy, cw, ch);
  // 标题
  ctx.fillStyle = "#e8dcc0"; ctx.font = "bold 22px serif"; ctx.textAlign = "left";
  ctx.fillText("灯  塔  手  记", cx + 18, cy + 30);
  ctx.fillStyle = "#5a6b82"; ctx.font = "11px monospace";
  ctx.fillText("Tab 关闭 ｜ 1/2/3/4 切章", cx + cw - 200, cy + 30);
  // 章节选择条
  const tabY = cy + 50;
  ctx.strokeStyle = "#2a3548";
  ctx.beginPath(); ctx.moveTo(cx + 18, tabY); ctx.lineTo(cx + cw - 18, tabY); ctx.stroke();
  CODEX_TABS.forEach((name, i) => {
    const tx = cx + 18 + i * 90;
    ctx.fillStyle = i === G.codexTab ? "#e8dcc0" : "#5a6b82";
    ctx.font = i === G.codexTab ? "bold 13px monospace" : "13px monospace";
    ctx.fillText("[" + (i + 1) + "] " + name, tx, tabY + 22);
  });
  ctx.beginPath(); ctx.moveTo(cx + 18, tabY + 32); ctx.lineTo(cx + 18 + cw - 36, tabY + 32); ctx.stroke();
  // 内容区
  const innerX = cx + 22, innerY = tabY + 56, innerW = cw - 44;
  if (G.codexTab === 0) drawCodexNpcs(innerX, innerY, innerW);
  else if (G.codexTab === 1) drawCodexSeen(innerX, innerY, innerW);
  else if (G.codexTab === 2) drawCodexStats(innerX, innerY, innerW);
  else if (G.codexTab === 3) drawCodexSecrets(innerX, innerY, innerW);
}

function drawCodexNpcs(x, y, w) {
  const speakers = Object.keys(SAVE.codex.npcs);
  if (speakers.length === 0) {
    ctx.fillStyle = "#5a6b82"; ctx.font = "13px monospace"; ctx.textAlign = "left";
    ctx.fillText("（尚未与人交谈）", x, y + 20);
    return;
  }
  ctx.textAlign = "left";
  let yy = y;
  for (const sp of speakers) {
    ctx.fillStyle = "#e8b34b"; ctx.font = "bold 14px serif";
    ctx.fillText(sp, x, yy + 16); yy += 26;
    ctx.fillStyle = "#9db4c0"; ctx.font = "13px monospace";
    for (const line of SAVE.codex.npcs[sp]) {
      wrapText("「" + line + "」", x + 20, yy + 14, w - 40, 18);
      yy += 22;
    }
    yy += 14;
    ctx.strokeStyle = "#1a2230"; ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
    yy += 10;
  }
}

function drawCodexSeen(x, y, w) {
  const roomTypes = Object.keys(SAVE.codex.rooms);
  const enemyKinds = Object.keys(SAVE.codex.enemies);
  ctx.textAlign = "left";
  let yy = y;
  ctx.fillStyle = "#e8b34b"; ctx.font = "bold 13px monospace";
  ctx.fillText("已历之处", x, yy + 14); yy += 22;
  if (roomTypes.length === 0) {
    ctx.fillStyle = "#5a6b82"; ctx.font = "12px monospace";
    ctx.fillText("（尚未下港）", x + 20, yy + 14); yy += 22;
  } else {
    ctx.font = "12px monospace";
    for (const t of roomTypes) {
      ctx.fillStyle = "#9db4c0";
      ctx.fillText("· " + (ROOM_DESC[t] || t), x + 20, yy + 14); yy += 18;
    }
  }
  yy += 20;
  ctx.fillStyle = "#e8b34b"; ctx.font = "bold 13px monospace";
  ctx.fillText("所遇之形", x, yy + 14); yy += 22;
  if (enemyKinds.length === 0) {
    ctx.fillStyle = "#5a6b82"; ctx.font = "12px monospace";
    ctx.fillText("（无）", x + 20, yy + 14); yy += 22;
  } else {
    ctx.font = "12px monospace";
    for (const k of enemyKinds) {
      ctx.fillStyle = "#9db4c0";
      ctx.fillText("· " + (ENEMY_DESC[k] || k) + "（击杀 " + SAVE.codex.enemies[k] + "）", x + 20, yy + 14); yy += 18;
    }
  }
}

function drawCodexStats(x, y, w) {
  const s = SAVE.codex;
  const rows = [
    ["下  港", SAVE.runs + " 次"],
    ["点  灯", SAVE.wins + " 次"],
    ["最深深度", "第 " + SAVE.bestFloor + " 层"],
    ["累计击杀", s.kills + " 具"],
    ["累计拾油", s.oil + " 盏"],
    ["击杀守灯者", s.bosses + " 次"],
  ];
  ctx.textAlign = "left";
  ctx.font = "13px monospace";
  rows.forEach((r, i) => {
    const yy = y + 20 + i * 26;
    ctx.fillStyle = "#5a6b82"; ctx.fillText(r[0], x, yy);
    ctx.fillStyle = "#e8dcc0"; ctx.fillText(r[1], x + 110, yy);
  });
  // 死因分布
  let yy = y + 20 + rows.length * 26 + 14;
  ctx.fillStyle = "#e8b34b"; ctx.font = "bold 13px monospace";
  ctx.fillText("死  因  分  布", x, yy); yy += 22;
  ctx.font = "12px monospace";
  const deathKeys = Object.keys(s.deathBy);
  if (deathKeys.length === 0) {
    ctx.fillStyle = "#5a6b82";
    ctx.fillText("（无）", x + 20, yy); yy += 18;
  } else {
    for (const k of deathKeys) {
      ctx.fillStyle = "#9db4c0";
      ctx.fillText("· " + (DEATH_NAME[k] || k) + "：" + s.deathBy[k] + " 次", x + 20, yy); yy += 18;
    }
  }
}

function drawCodexSecrets(x, y, w) {
  ctx.textAlign = "left";
  const yy0 = y + 16;
  ctx.fillStyle = "#e8b34b"; ctx.font = "bold 14px serif";
  ctx.fillText("秘  闻", x, yy0);
  ctx.fillStyle = "#5a6b82"; ctx.font = "11px monospace";
  ctx.fillText("达成条件即点亮", x + 80, yy0);
  let yy = yy0 + 22;
  SECRET_LIST.forEach((sc, i) => {
    const got = !!SAVE.codex.secrets[sc.id];
    ctx.fillStyle = got ? "#e8dcc0" : "#3a4658";
    ctx.font = "13px monospace";
    ctx.fillText((got ? "●" : "○") + "  " + sc.name, x, yy);
    ctx.fillStyle = got ? "#9db4c0" : "#3a4658";
    ctx.font = "12px monospace";
    ctx.fillText(sc.desc, x + 24, yy + 18);
    yy += 38;
  });
}

function wrapText(text, x, y, maxW, lh) {
  const chars = text.split("");
  let line = "", yy = y;
  for (const c of chars) {
    if (ctx.measureText(line + c).width > maxW) { ctx.fillText(line, x, yy); line = c; yy += lh; }
    else line += c;
  }
  ctx.fillText(line, x, yy);
}

/* ---------- 主循环 ---------- */
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  if (G.state !== "upgrade" && !G.codexOpen) update(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
