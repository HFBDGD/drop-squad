'use strict';

// ═══════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════
const W = 480, H = 640;
const CEIL_H    = 42;     // ceiling zone height (spikes)
const FLOOR_H   = 14;     // platform thickness
const FLOOR_SP  = 95;     // vertical spacing between floors
const PW = 22, PH = 30;   // player width / height
const MOVE_SPD  = 175;    // px/s horizontal
const CONV_SPD  = 130;    // conveyor speed
const GRAVITY   = 1100;   // px/s²
const SPRING_V  = -380;   // upward velocity from spring
const SCROLL_I  = 55;     // initial scroll speed px/s
const SCROLL_MAX = 185;
const SCROLL_ACC = 2.5;   // px/s per second
const MAX_HP    = 10;
const INV_MS    = 1100;   // invincibility after spike hit
const CEIL_DMG_MS = 180;  // ms between ceiling damage ticks

// Platform types
const PT = { NORMAL: 0, SPIKE: 1, SPRING: 2, CONV_L: 3, CONV_R: 4, WOOD: 5 };
const MIN_SEG_W = 70;   // minimum platform segment width

// Supabase — read from config.js (window.GAME_CONFIG), with safe fallback
const SB_URL  = (window.GAME_CONFIG && window.GAME_CONFIG.SB_URL)  || 'https://uganjsnopnievufjlqga.supabase.co';
const SB_ANON = (window.GAME_CONFIG && window.GAME_CONFIG.SB_ANON) || '';

// Floor body / top-strip colours per type
const FLOOR_BODY = [0x2a5035, 0x6a1010, 0x806010, 0x143a5a, 0x145a3a];
const FLOOR_TOP  = [0x3a9055, 0xcc2222, 0xd49010, 0x2266aa, 0x22aa66];

// ═══════════════════════════════════════════════════════
//  SEEDED RNG  (xorshift32)
// ═══════════════════════════════════════════════════════
class RNG {
  constructor(seed) { this.s = (seed >>> 0) || 1; }
  next() {
    let s = this.s;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    this.s = s >>> 0;
    return this.s / 0x100000000;
  }
  int(lo, hi) { return lo + Math.floor(this.next() * (hi - lo + 1)); }
}

function codeToSeed(code) {
  let h = 2166136261;
  for (const c of code) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

function randCode() {
  const ch = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  return Array.from({ length: 6 }, () => ch[Math.floor(Math.random() * ch.length)]).join('');
}

function pickType(rng) {
  const r = rng.next() * 100;
  if (r < 46) return PT.NORMAL;
  if (r < 58) return PT.WOOD;
  if (r < 70) return PT.SPIKE;
  if (r < 80) return PT.SPRING;
  if (r < 90) return PT.CONV_L;
  return PT.CONV_R;
}

// ═══════════════════════════════════════════════════════
//  MULTIPLAYER  (Supabase Realtime Broadcast)
// ═══════════════════════════════════════════════════════
class MP {
  // True only if the Supabase library + a key are both present
  static available() {
    return typeof supabase !== 'undefined' && !!SB_ANON;
  }

  constructor() {
    this.sb = supabase.createClient(SB_URL, SB_ANON);
    this.ch  = null;
    this.id  = Math.random().toString(36).slice(2, 8);
    this.peerConnected = false;
    this.onState = null;   // (payload) => void
    this.onPeer  = null;   // () => void — first message from opponent
  }

  connect(code) {
    this.ch = this.sb.channel(`nsshaft-${code}`, {
      config: { broadcast: { self: false } },
    });
    this.ch
      .on('broadcast', { event: 'gs' }, ({ payload }) => {
        if (!this.peerConnected) {
          this.peerConnected = true;
          if (this.onPeer) this.onPeer();
        }
        if (this.onState) this.onState(payload);
      })
      .subscribe();
  }

  send(data) {
    if (!this.ch) return;
    this.ch.send({ type: 'broadcast', event: 'gs', payload: { ...data, _id: this.id } });
  }

  off() {
    if (this.ch) { this.sb.removeChannel(this.ch); this.ch = null; }
  }
}

// ═══════════════════════════════════════════════════════
//  SCENE: MENU
// ═══════════════════════════════════════════════════════
class MenuScene extends Phaser.Scene {
  constructor() { super('Menu'); }

  create() {
    this.menuBtns = [];
    this.selIdx   = 0;
    this.clouds   = [
      { x: 30,  y: 28, w: 80 },
      { x: 200, y: 18, w: 64 },
      { x: 340, y: 34, w: 96 },
      { x: 120, y: 46, w: 56 },
    ];

    // ── Static background (drawn once) ──────────────────
    const bg = this.add.graphics().setDepth(0);
    this.buildBG(bg);

    // ── Animated layer (clouds + buttons, redrawn each frame) ──
    this.animGfx = this.add.graphics().setDepth(3);

    // ── Title — Minecraft blocky style ──────────────────
    // "DROP" — shadow then main (each word independently scaled so neither clips)
    this.add.text(W / 2 + 4, 74, 'DROP', {
      fontSize: '56px', fontFamily: 'Press Start 2P', color: '#1a4a00',
    }).setOrigin(0.5).setScale(3).setDepth(5);
    this.add.text(W / 2, 70, 'DROP', {
      fontSize: '56px', fontFamily: 'Press Start 2P',
      color: '#88ff44', stroke: '#2a6600', strokeThickness: 10,
    }).setOrigin(0.5).setScale(3).setDepth(6);

    // "SQUAD" — shadow then main
    this.add.text(W / 2 + 4, 154, 'SQUAD', {
      fontSize: '44px', fontFamily: 'Press Start 2P', color: '#1a4a00',
    }).setOrigin(0.5).setScale(3).setDepth(5);
    this.add.text(W / 2, 150, 'SQUAD', {
      fontSize: '44px', fontFamily: 'Press Start 2P',
      color: '#ffee00', stroke: '#665500', strokeThickness: 8,
    }).setOrigin(0.5).setScale(3).setDepth(6);

    // Subtitle shadow + main
    this.add.text(W / 2 + 2, 237, 'Mine your way down!', {
      fontSize: '10px', fontFamily: 'Press Start 2P', color: '#225500',
    }).setOrigin(0.5).setDepth(5);
    this.add.text(W / 2, 235, 'Mine your way down!', {
      fontSize: '10px', fontFamily: 'Press Start 2P', color: '#aaffaa',
    }).setOrigin(0.5).setDepth(6);

    // ── Buttons ─────────────────────────────────────────
    const BW = 272, BH = 40;
    this.makeBtn(W / 2, 378, '1 PLAYER',          BW, BH, () => this.scene.start('Game', { mode: '1p' }));
    this.makeBtn(W / 2, 432, '2 PLAYERS (local)', BW, BH, () => this.scene.start('Game', { mode: '2p' }));
    this.makeBtn(W / 2, 486, 'PLAY ONLINE',       BW, BH, () => this.scene.start('OnlineLobby'));

    // ── Footer hints ─────────────────────────────────────
    this.add.text(W / 2, 542, 'P1: ← →     P2: A D', {
      fontSize: '14px', fontFamily: 'Fredoka One', color: '#aaccaa',
    }).setOrigin(0.5).setDepth(7);
    this.add.text(W / 2, 562, '↑ ↓ navigate    ENTER select', {
      fontSize: '12px', fontFamily: 'Fredoka One', color: '#88aa88',
    }).setOrigin(0.5).setDepth(7);
    this.add.text(4, H - 6, 'Drop Squad  v1.0', {
      fontSize: '10px', fontFamily: 'Fredoka One', color: '#557755',
    }).setOrigin(0, 1).setDepth(7);

    // ── Keyboard ─────────────────────────────────────────
    this.cursors  = this.input.keyboard.createCursorKeys();
    this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.updateSel();
  }

  // ── Static Minecraft landscape background ────────────
  buildBG(g) {
    const SHAFT_W = 192;
    const SHAFT_X = (W - SHAFT_W) / 2;
    const GROUND_Y = 170;

    // Sky
    g.fillStyle(0x7ec8e3); g.fillRect(0, 0, W, GROUND_Y);

    // Sun (top-right)
    g.fillStyle(0xffff55); g.fillRect(W - 58, 18, 28, 28);
    g.fillStyle(0xffff88, 0.7);
    g.fillRect(W - 44, 10, 4, 6);  g.fillRect(W - 44, 48, 4, 6);
    g.fillRect(W - 62, 30, 6, 4);  g.fillRect(W - 50, 22, 4, 4);
    g.fillRect(W - 38, 22, 4, 4);

    // Trees (left side)
    this.drawTree(g, 28,  GROUND_Y - 44);
    this.drawTree(g, 68,  GROUND_Y - 38);
    this.drawTree(g, 12,  GROUND_Y - 30);
    // Trees (right side)
    this.drawTree(g, W - 40, GROUND_Y - 42);
    this.drawTree(g, W - 18, GROUND_Y - 34);
    this.drawTree(g, W - 68, GROUND_Y - 30);

    // Grass row
    for (let bx = 0; bx < W; bx += 16) {
      g.fillStyle(0x8b5e3c); g.fillRect(bx, GROUND_Y, 16, 16);
      g.fillStyle(0x5da832); g.fillRect(bx, GROUND_Y, 16, 4);
      g.fillStyle(0x7acc44, 0.55); g.fillRect(bx, GROUND_Y, 16, 2);
      g.fillStyle(0x6e4820, 0.4);
      g.fillRect(bx + 3, GROUND_Y + 6, 2, 2);
      g.fillRect(bx + 9, GROUND_Y + 10, 3, 2);
      g.fillStyle(0x000000, 0.1);
      g.fillRect(bx, GROUND_Y, 1, 16); g.fillRect(bx, GROUND_Y, 16, 1);
      // Grass tufts
      g.fillStyle(0x4a9028);
      g.fillRect(bx + 3, GROUND_Y - 3, 2, 4);
      g.fillRect(bx + 9, GROUND_Y - 4, 2, 5);
    }

    // Dirt rows
    for (let bx = 0; bx < W; bx += 16) {
      for (let by = GROUND_Y + 16; by < GROUND_Y + 48; by += 16) {
        g.fillStyle(0x8b5e3c); g.fillRect(bx, by, 16, 16);
        g.fillStyle(0x6e4820, 0.45);
        g.fillRect(bx + 3, by + 4, 2, 2); g.fillRect(bx + 9, by + 9, 3, 2);
        g.fillStyle(0x000000, 0.1);
        g.fillRect(bx, by, 1, 16); g.fillRect(bx, by, 16, 1);
      }
    }

    // Stone below
    for (let bx = 0; bx < W; bx += 16) {
      for (let by = GROUND_Y + 48; by < H; by += 16) {
        const shade = ((bx + by) / 16 | 0) % 2 === 0 ? 0x585858 : 0x4c4c4c;
        g.fillStyle(shade); g.fillRect(bx, by, 16, 16);
        g.fillStyle(0x000000, 0.11);
        g.fillRect(bx, by, 1, 16); g.fillRect(bx, by, 16, 1);
        // Ores
        const r = (by / 16 | 0), c = (bx / 16 | 0);
        if ((r * 7 + c * 3) % 23 === 0)  { g.fillStyle(0xff3333, 0.9); g.fillRect(bx + 5, by + 5, 4, 4); }
        if ((r * 5 + c * 7) % 31 === 0)  { g.fillStyle(0xffd700, 0.9); g.fillRect(bx + 4, by + 4, 5, 5); }
        if ((r * 11 + c * 2) % 43 === 0) { g.fillStyle(0x44ddff, 0.9); g.fillRect(bx + 5, by + 5, 4, 4); }
      }
    }

    // Shaft hole (dark opening in centre)
    g.fillStyle(0x000000); g.fillRect(SHAFT_X, GROUND_Y, SHAFT_W, H - GROUND_Y);

    // Shaft wall blocks each side
    for (let by = GROUND_Y; by < H; by += 16) {
      g.fillStyle(0x4a4a4a); g.fillRect(SHAFT_X - 16, by, 16, 16);
      g.fillStyle(0x000000, 0.14); g.fillRect(SHAFT_X - 16, by, 1, 16); g.fillRect(SHAFT_X - 16, by, 16, 1);
      g.fillStyle(0x4a4a4a); g.fillRect(SHAFT_X + SHAFT_W, by, 16, 16);
      g.fillStyle(0x000000, 0.14); g.fillRect(SHAFT_X + SHAFT_W, by, 1, 16); g.fillRect(SHAFT_X + SHAFT_W, by, 16, 1);
    }

    // Mine entrance frame (oak wood planks)
    const planks = [[SHAFT_X, GROUND_Y, 8, 48], [SHAFT_X + SHAFT_W - 8, GROUND_Y, 8, 48]];
    for (const [px, py, pw, ph] of planks) {
      for (let by = py; by < py + ph; by += 16) {
        g.fillStyle(0xa0763c); g.fillRect(px, by, pw, 16);
        g.fillStyle(0x7a5228, 0.55);
        g.fillRect(px + 1, by + 3, pw - 2, 2);
        g.fillRect(px + 1, by + 9, pw - 2, 2);
        g.fillStyle(0x000000, 0.12); g.fillRect(px, by, pw, 1);
      }
    }
    // Top beam
    g.fillStyle(0xa0763c); g.fillRect(SHAFT_X, GROUND_Y - 10, SHAFT_W, 10);
    g.fillStyle(0x7a5228, 0.5); g.fillRect(SHAFT_X + 4, GROUND_Y - 8, SHAFT_W - 8, 4);
    g.fillStyle(0x000000, 0.15); g.fillRect(SHAFT_X, GROUND_Y - 10, SHAFT_W, 1);

    // Depth fog inside shaft
    for (let by = GROUND_Y; by < H; by += 16) {
      const t = Math.min(0.92, (by - GROUND_Y) / 380);
      g.fillStyle(0x000000, t * 0.55);
      g.fillRect(SHAFT_X, by, SHAFT_W, 16);
    }

    // Faint stalactites peeking from shaft top
    g.fillStyle(0x5a5a4a);
    for (const sx of [SHAFT_X + 30, SHAFT_X + 72, SHAFT_X + 110, SHAFT_X + 148]) {
      g.fillTriangle(sx - 4, GROUND_Y + 2, sx + 4, GROUND_Y + 2, sx, GROUND_Y + 14);
    }
  }

  drawTree(g, x, y) {
    // Trunk (oak log)
    g.fillStyle(0x6e4a1e); g.fillRect(x + 4, y + 20, 8, 20);
    g.fillStyle(0x5a3c18, 0.5); g.fillRect(x + 8, y + 20, 3, 20);
    // Leaves (3 layers, getting narrower at top)
    const leafColor = [0x2e7a1e, 0x3a9424, 0x267018];
    [[x, y + 12, 16, 12], [x + 2, y + 4, 12, 12], [x + 4, y, 8, 8]].forEach(([lx, ly, lw, lh], i) => {
      g.fillStyle(leafColor[i % 3]); g.fillRect(lx, ly, lw, lh);
      g.fillStyle(0x000000, 0.1);
      g.fillRect(lx, ly, 1, lh); g.fillRect(lx, ly, lw, 1);
    });
  }

  makeBtn(cx, cy, label, w, h, cb) {
    const t = this.add.text(cx, cy, label, {
      fontSize: '18px', fontFamily: 'Fredoka One', color: '#e8e8e8',
      stroke: '#000000', strokeThickness: 1,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(8);
    const idx = this.menuBtns.length;
    t.on('pointerover', () => { this.selIdx = idx; this.updateSel(); });
    t.on('pointerdown', cb);
    this.menuBtns.push({ t, cb, x: cx - w / 2, y: cy - h / 2, w, h });
    return t;
  }

  updateSel() {
    this.menuBtns.forEach((b, i) => {
      b.t.setColor(i === this.selIdx ? '#ffffff' : '#b0b0b0');
      b.t.setScale(i === this.selIdx ? 1.04 : 1.0);
    });
  }

  update(_, delta) {
    const g = this.animGfx;
    g.clear();

    // Animated clouds (pixel-art style)
    for (const c of this.clouds) {
      c.x -= 0.03 * delta;
      if (c.x + c.w < 0) c.x = W + 10;
      g.fillStyle(0xffffff);
      g.fillRect(c.x + 8,  c.y,      c.w - 16, 8);
      g.fillRect(c.x,      c.y + 8,  c.w,      8);
      g.fillRect(c.x + 8,  c.y + 16, c.w - 16, 8);
    }

    // Minecraft stone-style button backgrounds
    for (let i = 0; i < this.menuBtns.length; i++) {
      const b   = this.menuBtns[i];
      const sel = i === this.selIdx;

      // Base stone fill
      g.fillStyle(sel ? 0x8a8a8a : 0x636363);
      g.fillRect(b.x, b.y, b.w, b.h);

      // Stone texture dots
      g.fillStyle(0x000000, 0.07);
      for (let bx = b.x + 3; bx < b.x + b.w - 3; bx += 6)
        for (let by = b.y + 3; by < b.y + b.h - 3; by += 6)
          g.fillRect(bx, by, 2, 2);

      // Highlight — top + left edges
      g.fillStyle(0xffffff, sel ? 0.45 : 0.28);
      g.fillRect(b.x,         b.y,         b.w, 2);
      g.fillRect(b.x,         b.y,         2,   b.h);

      // Shadow — bottom + right edges
      g.fillStyle(0x000000, sel ? 0.55 : 0.38);
      g.fillRect(b.x,             b.y + b.h - 2, b.w, 2);
      g.fillRect(b.x + b.w - 2,  b.y,           2,   b.h);

      // Selected: faint yellow glow fill
      if (sel) {
        g.fillStyle(0xffff55, 0.07);
        g.fillRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4);
      }
    }

    // Keyboard navigation
    if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) {
      this.selIdx = (this.selIdx + 1) % this.menuBtns.length;
      this.updateSel();
    }
    if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) {
      this.selIdx = (this.selIdx - 1 + this.menuBtns.length) % this.menuBtns.length;
      this.updateSel();
    }
    if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
      this.menuBtns[this.selIdx].cb();
    }
  }
}

// ═══════════════════════════════════════════════════════
//  SCENE: ONLINE LOBBY
// ═══════════════════════════════════════════════════════
class OnlineLobbyScene extends Phaser.Scene {
  constructor() { super('OnlineLobby'); }

  create() {
    this.mp        = null;
    this.domInput  = null;
    this.pingEvent = null;
    this.menuBtns  = [];
    this.selIdx    = 0;
    this.menuLocked = false;

    const g = this.add.graphics();
    g.fillStyle(0x0d0d1f); g.fillRect(0, 0, W, H);
    g.fillStyle(0x080812);
    g.fillRect(0, 0, 20, H); g.fillRect(W - 20, 0, 20, H);

    this.add.text(W / 2 + 3, 73, 'PLAY\nONLINE!', {
      fontSize: '28px', fontFamily: 'Press Start 2P',
      color: '#115533', align: 'center', lineSpacing: 8,
    }).setOrigin(0.5);
    this.add.text(W / 2, 70, 'PLAY\nONLINE!', {
      fontSize: '28px', fontFamily: 'Press Start 2P',
      color: '#44ff99', stroke: '#116633', strokeThickness: 6,
      align: 'center', lineSpacing: 8,
    }).setOrigin(0.5);

    this.infoText = this.add.text(W / 2, 310, '', {
      fontSize: '17px', fontFamily: 'Fredoka One',
      color: '#aaaacc', align: 'center', lineSpacing: 8,
    }).setOrigin(0.5);

    this.statusText = this.add.text(W / 2, H - 54, '', {
      fontSize: '12px', fontFamily: 'Fredoka One', color: '#336644',
    }).setOrigin(0.5);

    this.makeBtn(W / 2, 180, 'HOST A GAME', 0x4488ff, () => this.doHost());
    this.makeBtn(W / 2, 250, 'JOIN A GAME', 0x22aa66, () => this.doJoin());
    this.makeBtn(W / 2, H - 90, 'BACK',     0x555566, () => { this.cleanup(); this.scene.start('Menu'); });

    this.add.text(W / 2, H - 40, '↑ ↓ navigate   ENTER select   ESC back', {
      fontSize: '12px', fontFamily: 'Fredoka One', color: '#336644',
    }).setOrigin(0.5);

    this.cursors  = this.input.keyboard.createCursorKeys();
    this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.escKey   = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.updateSel();
  }

  makeBtn(x, y, label, color, cb) {
    const hex = '#' + color.toString(16).padStart(6, '0');
    const t = this.add.text(x, y, label, {
      fontSize: '20px', fontFamily: 'Fredoka One', color: hex,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const idx = this.menuBtns.length;
    t.on('pointerover', () => { if (!this.menuLocked) { this.selIdx = idx; this.updateSel(); } });
    t.on('pointerdown', cb);
    this.menuBtns.push({ t, cb });
    return t;
  }

  updateSel() {
    this.menuBtns.forEach((b, i) => {
      b.t.setAlpha(i === this.selIdx ? 1.0 : 0.4);
      b.t.setScale(i === this.selIdx ? 1.09 : 1.0);
      b.t.setText((i === this.selIdx ? '▶  ' : '    ') + b.t.text.replace(/^[▶ ]+/, ''));
    });
  }

  update() {
    if (this.menuLocked || this.domInput) return;

    if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) {
      this.selIdx = (this.selIdx + 1) % this.menuBtns.length;
      this.updateSel();
    }
    if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) {
      this.selIdx = (this.selIdx - 1 + this.menuBtns.length) % this.menuBtns.length;
      this.updateSel();
    }
    if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
      this.menuBtns[this.selIdx].cb();
    }
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.cleanup(); this.scene.start('Menu');
    }
  }

  doHost() {
    if (this.mp) return;
    if (!MP.available()) {
      this.infoText.setText('Online play is\nunavailable right now.\n(No connection.)');
      return;
    }
    this.menuLocked = true;
    const code = randCode();
    this.mp = new MP();
    this.mp.connect(code);
    this.mp.onPeer = () => {
      this.infoText.setText('Opponent connected!\nStarting game…');
      this.time.delayedCall(800, () => {
        const m = this.mp; this.mp = null;
        this.scene.start('Game', { mode: 'online', isHost: true, code, mp: m });
      });
    };
    this.infoText.setText(`Your room code:\n\n${code}\n\nShare with a friend.\nWaiting for them…`);
    this.statusText.setText('Channel open.');
  }

  doJoin() {
    if (this.domInput) return;
    if (!MP.available()) {
      this.infoText.setText('Online play is\nunavailable right now.\n(No connection.)');
      return;
    }
    this.menuLocked = true;
    this.infoText.setText('Enter the 6-letter code\nyour friend gave you,\nthen press ENTER:');

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 6;
    input.placeholder = 'XXXXXX';
    Object.assign(input.style, {
      position: 'fixed', top: '62%', left: '50%',
      transform: 'translate(-50%, -50%)',
      fontSize: '30px', textAlign: 'center', letterSpacing: '10px',
      width: '230px', background: '#0a0a18', color: '#ffffff',
      border: '2px solid #22aa66', padding: '10px',
      fontFamily: 'Fredoka One', textTransform: 'uppercase',
      zIndex: '9999', outline: 'none', borderRadius: '4px',
    });
    document.body.appendChild(input);
    input.focus();
    this.domInput = input;

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim().length >= 4) {
        const code = input.value.trim().toUpperCase();
        this.cleanDom();
        this.connectJoin(code);
      }
    });
  }

  connectJoin(code) {
    this.mp = new MP();
    this.mp.connect(code);
    this.infoText.setText(`Joining room: ${code}\nSending hello…`);

    // Ping every 400ms so host sees us
    this.pingEvent = this.time.addEvent({
      delay: 400, loop: true,
      callback: () => { if (this.mp) this.mp.send({ ping: true }); },
    });

    this.mp.onPeer = () => {
      if (this.pingEvent) { this.pingEvent.remove(); this.pingEvent = null; }
      this.infoText.setText('Host found!\nStarting game…');
      this.time.delayedCall(600, () => {
        const m = this.mp; this.mp = null;
        this.scene.start('Game', { mode: 'online', isHost: false, code, mp: m });
      });
    };

    this.statusText.setText('Pinging host…');
  }

  cleanDom()  { if (this.domInput) { this.domInput.remove(); this.domInput = null; } }
  cleanup()   {
    this.cleanDom();
    if (this.pingEvent) { this.pingEvent.remove(); this.pingEvent = null; }
    if (this.mp) { this.mp.off(); this.mp = null; }
  }
  shutdown()  { this.cleanup(); }
}

// ═══════════════════════════════════════════════════════
//  SCENE: GAME
// ═══════════════════════════════════════════════════════
class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data) {
    this.mode   = data.mode   || '1p';
    this.isHost = data.isHost ?? true;
    this.code   = data.code   || null;
    this.mp     = data.mp     || null;
  }

  create() {
    const seed = this.code ? codeToSeed(this.code) : (Date.now() & 0xffffffff);
    this.rng   = new RNG(seed);

    this.scrollSpeed   = SCROLL_I;
    this.score         = 0;
    this.floors        = [];
    this.broadcastTimer = 0;
    this.dead          = false;

    // Graphics layers
    this.gfx    = this.add.graphics().setDepth(2);
    this.hudGfx = this.add.graphics().setDepth(10);

    // Score text
    this.scoreTxt = this.add.text(W - 14, 6, '0', {
      fontSize: '20px', fontFamily: 'Fredoka One',
      color: '#ffff88', stroke: '#664400', strokeThickness: 3,
    }).setOrigin(1, 0).setDepth(11);

    // Keyboard
    this.keys = this.input.keyboard.addKeys({
      LEFT:  Phaser.Input.Keyboard.KeyCodes.LEFT,
      RIGHT: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      A:     Phaser.Input.Keyboard.KeyCodes.A,
      D:     Phaser.Input.Keyboard.KeyCodes.D,
    });

    // Players
    this.players = [];
    this.p1 = this.mkPlayer(W / 4, CEIL_H + 40, { left: 'LEFT', right: 'RIGHT' }, 0x4488ff, true);
    this.players.push(this.p1);

    if (this.mode === '2p') {
      this.p2 = this.mkPlayer(3 * W / 4, CEIL_H + 40, { left: 'A', right: 'D' }, 0xff8833, true);
      this.players.push(this.p2);
    }

    if (this.mode === 'online') {
      this.ghost = this.mkPlayer(W / 2, CEIL_H + 40, null, 0x888888, false);
      this.ghost.isGhost = true;
      this.players.push(this.ghost);

      this.mp.onState = (s) => {
        if (s.ping) return;
        this.ghost.x    = s.x;
        this.ghost.y    = s.y;
        this.ghost.hp   = s.hp  ?? this.ghost.hp;
        this.ghost.dead = s.dead ?? false;
      };
    }

    // Spawn initial floors
    for (let y = H - 60; y > CEIL_H + FLOOR_SP; y -= FLOOR_SP) this.spawnFloor(y);

    // Place players on top floor
    const topFloor = [...this.floors].sort((a, b) => a.y - b.y)[0];
    if (topFloor) {
      [this.p1, this.p2, this.ghost].forEach(p => {
        if (p) { p.y = topFloor.y - PH / 2; p.onGround = true; }
      });
    }

    // UI labels
    if (this.mode === 'online' && this.code) {
      this.add.text(W / 2, 4, `Room: ${this.code}`, {
        fontSize: '10px', fontFamily: 'Fredoka One', color: '#223344',
      }).setOrigin(0.5, 0).setDepth(11);
    }
    if (this.mode === '2p') {
      this.add.text(16, 6, 'P1', {
        fontSize: '11px', fontFamily: 'Fredoka One', color: '#224466',
      }).setDepth(11);
      this.add.text(W / 2 + 8, 6, 'P2', {
        fontSize: '11px', fontFamily: 'Fredoka One', color: '#664422',
      }).setDepth(11);
    }
    if (this.mode === 'online') {
      this.add.text(W / 2 + 8, 6, 'OPP', {
        fontSize: '11px', fontFamily: 'Fredoka One', color: '#444444',
      }).setDepth(11);
    }
  }

  mkPlayer(x, y, controls, color, isLocal) {
    return {
      x, y, vx: 0, vy: 0,
      controls, color, isLocal,
      hp: MAX_HP, onGround: false,
      standType: PT.NORMAL,
      invTimer: 0, ceilTimer: 0,
      woodTimer: 0,   // ms until fall-through (counts down while on wood)
      woodPass:  0,   // ms of pass-through remaining after drop
      dead: false, isGhost: false,
    };
  }

  // ── Floor generation ─────────────────────────────────
  spawnFloor(y) {
    // Place 1–3 segments at fully random positions across the width.
    // Each is 70–140 px wide; any two must be at least 100 px apart.
    const MIN_GAP = 100;
    const placed  = [];

    const want = this.rng.int(1, 3);
    for (let tries = 0; tries < 80 && placed.length < want; tries++) {
      const sw = this.rng.int(70, 140);
      const x1 = this.rng.int(0, W - sw);
      const x2 = x1 + sw;
      const ok  = placed.every(p => x1 >= p.x2 + MIN_GAP || x2 <= p.x1 - MIN_GAP);
      if (ok) placed.push({ x1, x2 });
    }

    placed.sort((a, b) => a.x1 - b.x1);

    const segs = placed.length
      ? placed.map(p => ({ x1: p.x1, x2: p.x2, type: pickType(this.rng) }))
      : [{ x1: this.rng.int(0, W - 110), x2: 0, type: PT.NORMAL }];

    // fallback: ensure x2 is set if the emergency path fired
    if (segs[0].x2 === 0) segs[0].x2 = segs[0].x1 + 110;

    this.floors.push({ y, segs });
  }

  lowestY() {
    return this.floors.length ? Math.max(...this.floors.map(f => f.y)) : CEIL_H;
  }

  // ── Update loop ──────────────────────────────────────
  update(time, delta) {
    if (this.dead) return;
    const dt = delta / 1000;

    // Scroll acceleration
    this.scrollSpeed = Math.min(SCROLL_MAX, this.scrollSpeed + SCROLL_ACC * dt);

    // Move floors up, prune those past ceiling
    for (const f of this.floors) f.y -= this.scrollSpeed * dt;
    this.floors = this.floors.filter(f => f.y > CEIL_H - 20);

    // Spawn new floors at the bottom
    while (this.lowestY() < H + FLOOR_SP) this.spawnFloor(this.lowestY() + FLOOR_SP);

    // Physics for local players
    for (const p of this.players) {
      if (p.isLocal && !p.isGhost) this.tickPlayer(p, dt, delta);
    }

    // Score
    this.score += dt;
    this.scoreTxt.setText(Math.floor(this.score * 10));

    // Online broadcast (every ~50 ms)
    if (this.mode === 'online' && this.mp) {
      this.broadcastTimer -= delta;
      if (this.broadcastTimer <= 0) {
        this.broadcastTimer = 50;
        this.mp.send({ x: this.p1.x, y: this.p1.y, hp: this.p1.hp, dead: this.p1.dead });
      }
    }

    // Game-over check (local players only)
    const locals = this.players.filter(p => p.isLocal && !p.isGhost);
    if (locals.length && locals.every(p => p.dead)) {
      this.dead = true;
      if (this.mp) { this.mp.off(); this.mp = null; }
      this.time.delayedCall(700, () =>
        this.scene.start('GameOver', { score: Math.floor(this.score * 10), mode: this.mode }));
      return;
    }

    // Render
    this.gfx.clear();
    this.hudGfx.clear();
    this.drawBG();
    this.drawCeiling();
    this.drawFloors();
    this.drawPlayers(time);
    this.drawHUD();
  }

  // ── Player physics ───────────────────────────────────
  tickPlayer(p, dt, deltaMs) {
    if (p.dead) return;
    if (p.invTimer  > 0) p.invTimer  -= deltaMs;
    if (p.ceilTimer > 0) p.ceilTimer -= deltaMs;

    // Input
    const kl = this.keys[p.controls.left];
    const kr = this.keys[p.controls.right];
    p.vx = kl.isDown ? -MOVE_SPD : kr.isDown ? MOVE_SPD : 0;

    // Conveyor adds drift — player input still works on top
    if (p.onGround) {
      if (p.standType === PT.CONV_L) p.vx = Math.max(p.vx - CONV_SPD, -MOVE_SPD * 1.4);
      if (p.standType === PT.CONV_R) p.vx = Math.min(p.vx + CONV_SPD, MOVE_SPD * 1.4);
    }

    // Gravity (only when airborne)
    if (!p.onGround) p.vy += GRAVITY * dt;

    // Scroll player upward while standing
    if (p.onGround) p.y -= this.scrollSpeed * dt;

    // Integrate
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Wrap X
    if (p.x < -PW / 2) p.x = W + PW / 2;
    else if (p.x > W + PW / 2) p.x = -PW / 2;

    // Ceiling contact
    if (p.y - PH / 2 < CEIL_H) {
      p.y = CEIL_H + PH / 2;
      if (p.vy < 0) p.vy = 0;
      if (p.ceilTimer <= 0) {
        p.hp        -= 1;
        p.invTimer   = 0;        // ceiling ignores invincibility
        p.ceilTimer  = CEIL_DMG_MS;
      }
    }

    // Platform collision
    p.onGround  = false;
    p.standType = PT.NORMAL;

    outer:
    for (const floor of this.floors) {
      const pb = p.y + PH / 2;
      if (pb < floor.y - 14 || pb > floor.y + 18) continue;
      for (const seg of floor.segs) {
        if (this.lands(p, seg, floor.y)) {
          p.y       = floor.y - PH / 2;
          p.onGround = true;
          p.standType = seg.type;

          if (seg.type === PT.SPRING) {
            p.vy       = SPRING_V;
            p.onGround = false;
            p.standType = PT.NORMAL;
          } else if (seg.type === PT.SPIKE && p.invTimer <= 0) {
            p.hp      -= 1;
            p.invTimer = INV_MS;
            p.vy       = 0;
          } else {
            p.vy = 0;
          }
          break outer;
        }
      }
    }

    // Wood platform: hold 1 s then fall through
    if (p.onGround && p.standType === PT.WOOD) {
      if (p.woodTimer === 0) p.woodTimer = 1000;
      p.woodTimer -= deltaMs;
      if (p.woodTimer <= 0) {
        p.woodTimer = 0;
        p.woodPass  = 700;   // 700 ms pass-through window
        p.onGround  = false;
        p.vy        = 60;    // small nudge so physics takes over immediately
      }
    } else {
      if (p.woodPass > 0) p.woodPass = Math.max(0, p.woodPass - deltaMs);
      else                p.woodTimer = 0; // reset if left wood before timer expired
    }

    // Death conditions
    if (p.y > H + 60)  { p.dead = true; p.hp = 0; }
    if (p.hp <= 0)     { p.hp = 0; p.dead = true; }
  }

  lands(p, seg, floorY) {
    if (p.vy < -300) return false;
    if (seg.type === PT.WOOD && p.woodPass > 0) return false; // falling through wood
    const px1 = p.x - PW / 2 + 3;
    const px2 = p.x + PW / 2 - 3;
    if (px2 <= seg.x1 || px1 >= seg.x2) return false;
    const pb = p.y + PH / 2;
    return pb >= floorY - 12 && pb <= floorY + 16;
  }

  // ── Rendering ────────────────────────────────────────

  drawBG() {
    const g = this.gfx;
    // Cave darkness
    g.fillStyle(0x100e08); g.fillRect(0, 0, W, H);

    // Stone shaft walls with ore veins
    for (let side = 0; side < 2; side++) {
      const wx = side === 0 ? 0 : W - 20;
      for (let by = 0; by < H; by += 16) {
        const shade = ((by / 16 | 0) + side) % 2 === 0 ? 0x565656 : 0x4a4a4a;
        g.fillStyle(shade); g.fillRect(wx, by, 20, 16);
        g.fillStyle(0x1a1a1a, 0.5);
        g.fillRect(wx, by, 20, 1); g.fillRect(wx, by, 1, 16);
        // Ore veins
        const row = (by / 16) | 0;
        if ((row + side * 3 + 3) % 7 === 0) {
          g.fillStyle(0xff3333, 0.95); // redstone
          g.fillRect(wx + (side === 0 ? 13 : 4), by + 6, 3, 3);
        }
        if ((row + side * 5 + 1) % 11 === 0) {
          g.fillStyle(0xffd700, 0.95); // gold
          g.fillRect(wx + (side === 0 ? 11 : 5), by + 4, 4, 4);
        }
        if ((row + side * 2 + 7) % 17 === 0) {
          g.fillStyle(0x44ddff, 0.9); // diamond
          g.fillRect(wx + (side === 0 ? 12 : 4), by + 8, 4, 4);
        }
      }
    }
  }

  drawCeiling() {
    const g = this.gfx;
    // Bedrock blocks
    for (let bx = 0; bx < W; bx += 16) {
      g.fillStyle(0x111111); g.fillRect(bx, 0, 16, CEIL_H);
      g.fillStyle(0x363636);
      g.fillRect(bx + 2,  2, 5, 4);
      g.fillRect(bx + 9,  6, 4, 5);
      g.fillRect(bx + 1, 12, 7, 4);
      g.fillRect(bx + 10, 1, 4, 4);
      g.fillStyle(0x232323);
      g.fillRect(bx + 4,  8, 3, 3);
      g.fillRect(bx + 11,14, 3, 3);
      g.fillStyle(0x000000);
      g.fillRect(bx, 0, 1, CEIL_H); g.fillRect(bx, 0, 16, 1);
    }
    // Stalactites
    const stals = [
      {x:30,h:13},{x:64,h:9},{x:98,h:16},{x:132,h:10},
      {x:168,h:14},{x:205,h:8},{x:242,h:18},{x:278,h:11},
      {x:315,h:15},{x:352,h:9},{x:390,h:16},{x:428,h:10},{x:458,h:13},
    ];
    for (const s of stals) {
      g.fillStyle(0x787768);
      g.fillTriangle(s.x - 5, CEIL_H, s.x + 5, CEIL_H, s.x, CEIL_H + s.h);
      g.fillStyle(0x565547);
      g.fillTriangle(s.x - 2, CEIL_H + s.h - 5, s.x + 2, CEIL_H + s.h - 5, s.x, CEIL_H + s.h);
    }
    // Danger glow
    g.fillStyle(0xff2200, 0.06); g.fillRect(0, CEIL_H - 6, W, 6);
  }

  drawFloors() {
    // Collect which floor Y values are actively counting down (for crack visual)
    const crackMap = new Map(); // floorY → woodTimer ms remaining
    for (const p of this.players) {
      if (p.onGround && p.standType === PT.WOOD && p.woodTimer > 0) {
        const fy = Math.round(p.y + PH / 2);
        const fl = this.floors.find(f => Math.abs(f.y - fy) < 6);
        if (fl) crackMap.set(fl.y, p.woodTimer);
      }
    }
    for (const floor of this.floors)
      for (const seg of floor.segs)
        this.drawBlock(seg.x1, seg.x2, floor.y, seg.type, crackMap.get(floor.y) ?? -1);
  }

  drawBlock(x1, x2, fy, type, cracking = -1) {
    const g  = this.gfx;
    const x  = Math.floor(x1);
    const w  = Math.floor(x2) - x;
    const y  = Math.floor(fy);
    const h  = FLOOR_H;

    switch (type) {
      case PT.NORMAL: {
        g.fillStyle(0x8b5e3c); g.fillRect(x, y, w, h);
        // Dirt flecks
        g.fillStyle(0x6e4820, 0.7);
        for (let bx = x + 3; bx < x + w - 3; bx += 9) g.fillRect(bx, y + 5, 2, 2);
        for (let bx = x + 7; bx < x + w - 2; bx += 9) g.fillRect(bx, y + 9, 3, 2);
        // Grass top
        g.fillStyle(0x5da832); g.fillRect(x, y, w, 4);
        g.fillStyle(0x7acc44, 0.6); g.fillRect(x, y, w, 2);
        // Grass tufts above
        g.fillStyle(0x4a9028);
        for (let bx = x + 4; bx < x + w - 4; bx += 8) g.fillRect(bx, y - 3, 2, 4);
        break;
      }
      case PT.SPIKE: {
        g.fillStyle(0x7a1a1a); g.fillRect(x, y, w, h);
        g.fillStyle(0x991f1f, 0.5);
        for (let bx = x + 2; bx < x + w - 2; bx += 7) g.fillRect(bx, y + 4, 3, 3);
        g.fillStyle(0x550d0d, 0.6);
        for (let bx = x + 5; bx < x + w - 2; bx += 7) g.fillRect(bx, y + 9, 2, 3);
        // Fire on top
        g.fillStyle(0xff4400);
        for (let bx = x + 1; bx < x + w - 9; bx += 10) g.fillTriangle(bx, y, bx + 5, y - 9, bx + 10, y);
        g.fillStyle(0xff8800);
        for (let bx = x + 5; bx < x + w - 5; bx += 10) g.fillTriangle(bx, y, bx + 4, y - 6, bx + 8, y);
        g.fillStyle(0xffdd00, 0.7);
        for (let bx = x + 3; bx < x + w - 4; bx += 10) g.fillTriangle(bx, y, bx + 3, y - 4, bx + 6, y);
        break;
      }
      case PT.SPRING: {
        g.fillStyle(0x4cb832); g.fillRect(x, y, w, h);
        g.fillStyle(0x66dd44, 0.5); g.fillRect(x, y, w, 3);
        g.lineStyle(1, 0x3a9025, 0.45);
        for (let bx = x; bx < x + w; bx += 16) g.lineBetween(bx, y, bx, y + h);
        // Coil indicator above
        const cx = x + w / 2;
        g.fillStyle(0xffffff, 0.65);
        g.fillRect(cx - 5, y - 5, 10, 5);
        g.fillRect(cx - 3, y - 9, 6, 5);
        g.fillStyle(0xddffdd, 0.85);
        g.fillRect(cx - 1, y - 11, 2, 3);
        break;
      }
      case PT.CONV_L:
      case PT.CONV_R: {
        g.fillStyle(0x3a70aa); g.fillRect(x, y, w, h);
        g.fillStyle(0x7ab8e8, 0.4); g.fillRect(x, y, w, 3);
        g.fillStyle(0x285a8a, 0.5);
        for (let bx = x + 4; bx < x + w - 2; bx += 10) g.fillRect(bx, y + 7, 4, 3);
        g.fillStyle(0xffffff, 0.8);
        const isL = type === PT.CONV_L;
        for (let ax = x + 14; ax < x + w - 10; ax += 22) {
          if (isL) g.fillTriangle(ax - 8, y + h/2, ax + 6, y + h/2 - 5, ax + 6, y + h/2 + 5);
          else     g.fillTriangle(ax + 8, y + h/2, ax - 6, y + h/2 - 5, ax - 6, y + h/2 + 5);
        }
        break;
      }
      case PT.WOOD: {
        // Cracking progress: 0 = just landed, 1 = about to fall
        const crack = cracking >= 0 ? 1 - (cracking / 1000) : 0;
        // Planks darken as they crack
        const baseColor = crack > 0.6 ? 0x6b3a10 : 0x9a6b35;
        g.fillStyle(baseColor); g.fillRect(x, y, w, h);
        // Plank grain lines (horizontal)
        g.fillStyle(0x7a5228, 0.6);
        g.fillRect(x, y + 4, w, 1);
        g.fillRect(x, y + 9, w, 1);
        // Top highlight strip
        g.fillStyle(crack > 0.6 ? 0x8a4a18 : 0xb5823f, 0.9);
        g.fillRect(x, y, w, 3);
        // Vertical plank dividers
        g.fillStyle(0x5a3010, 0.5);
        for (let bx = x + 16; bx < x + w; bx += 16) g.fillRect(bx, y, 1, h);
        // Crack marks when timer is running (> 60% elapsed)
        if (crack > 0.6) {
          g.fillStyle(0x000000, 0.55);
          for (let bx = x + 6; bx < x + w - 6; bx += 20) {
            g.fillRect(bx,     y + 2, 1, 5);
            g.fillRect(bx + 8, y + 6, 1, 5);
          }
          // Red danger tint
          g.fillStyle(0xff2200, 0.18);
          g.fillRect(x, y, w, h);
        }
        // Warning flash in last 300 ms
        if (cracking >= 0 && cracking < 300 && Math.floor(cracking / 80) % 2 === 0) {
          g.fillStyle(0xff6600, 0.35);
          g.fillRect(x, y, w, h);
        }
        break;
      }
    }
    // Block grid lines
    g.lineStyle(1, 0x000000, 0.16);
    for (let bx = x; bx <= x + w; bx += 16) g.lineBetween(bx, y, bx, y + h);
  }

  drawPlayers(time) {
    for (const p of this.players) {
      if (p.dead) continue;
      if (p.invTimer > 0 && Math.floor(time / 90) % 2 === 1) continue;
      this.drawSteve(p, time);
    }
  }

  drawSteve(p, time) {
    const g  = this.gfx;
    const x  = Math.floor(p.x);
    const y  = Math.floor(p.y);
    const a  = p.isGhost ? 0.3 : 1.0;

    const moving = Math.abs(p.vx) > 5;
    const frame  = moving ? (Math.floor(time / 160) % 2) : 0;
    const faceL  = p.vx < -5;

    // Swing offsets (legs/arms alternate)
    const lLeg = frame === 0 ?  2 : -2;
    const rLeg = -lLeg;
    const lArm = -lLeg;   // arms swing opposite to same-side leg
    const rArm =  lLeg;

    const SKIN  = 0xf5c089;
    const HAIR  = 0x5c3510;
    const SHIRT = p.color;
    const PANTS = 0x253d82;
    const SHOE  = 0x3d2008;

    // ── Shoes ──
    g.fillStyle(SHOE, a);
    g.fillRect(x - 5 + lLeg, y + 13, 6, 2);
    g.fillRect(x + 1 + rLeg, y + 13, 6, 2);

    // ── Legs ──
    g.fillStyle(PANTS, a);
    g.fillRect(x - 5 + lLeg, y + 7, 4, 8);
    g.fillRect(x + 1 + rLeg, y + 7, 4, 8);
    // Leg shading
    g.fillStyle(0x000000, 0.18 * a);
    g.fillRect(x - 5 + lLeg + 2, y + 7, 2, 8);
    g.fillRect(x + 1 + rLeg + 2, y + 7, 2, 8);

    // ── Body ──
    g.fillStyle(SHIRT, a);
    g.fillRect(x - 5, y - 3, 10, 11);
    // Body shading
    g.fillStyle(0x000000, 0.2 * a);
    g.fillRect(x - 5, y + 4, 10, 4);
    // Belt
    g.fillStyle(0x7a5030, a);
    g.fillRect(x - 5, y + 7, 10, 2);

    // ── Arms ──
    g.fillStyle(SHIRT, a);
    g.fillRect(x - 9 + lArm, y - 3, 4, 6);
    g.fillRect(x + 5 + rArm, y - 3, 4, 6);
    g.fillStyle(SKIN, a);
    g.fillRect(x - 9 + lArm, y + 3, 4, 4);
    g.fillRect(x + 5 + rArm, y + 3, 4, 4);
    // Arm shading
    g.fillStyle(0x000000, 0.15 * a);
    g.fillRect(x - 9 + lArm + 2, y - 3, 2, 10);
    g.fillRect(x + 5 + rArm + 2, y - 3, 2, 10);

    // ── Head ──
    // Skin
    g.fillStyle(SKIN, a);
    g.fillRect(x - 7, y - 15, 14, 12);
    // Hair top
    g.fillStyle(HAIR, a);
    g.fillRect(x - 7, y - 15, 14, 4);
    // Hair side (back of head)
    g.fillRect(faceL ? (x + 4) : (x - 7), y - 15, 3, 12);
    // Face shading (subtle)
    g.fillStyle(0x000000, 0.1 * a);
    g.fillRect(faceL ? (x - 7) : (x + 4), y - 11, 3, 8);

    // ── Eyes ──
    if (!p.isGhost) {
      const ex = faceL ? x - 5 : x - 2;  // eye cluster x
      g.fillStyle(0xffffff, a);
      g.fillRect(ex,     y - 11, 3, 3);
      g.fillRect(ex + 4, y - 11, 3, 3);
      g.fillStyle(0x111111, a);
      g.fillRect(ex + (faceL ? 0 : 1), y - 10, 2, 2);
      g.fillRect(ex + (faceL ? 4 : 5), y - 10, 2, 2);
    }
  }

  drawHUD() {
    const g = this.hudGfx;
    // P1 health — left side below ceiling
    this.drawHP(g, this.p1, 20, H - 22, false);
    if (this.mode === '2p' && this.p2)
      this.drawHP(g, this.p2, W / 2 + 10, H - 22, false);
    if (this.mode === 'online' && this.ghost)
      this.drawHP(g, this.ghost, W / 2 + 10, H - 22, true);
  }

  drawHP(g, p, startX, y, ghost) {
    const sz = 10, gap = 3;
    for (let i = 0; i < MAX_HP; i++) {
      g.fillStyle(i < p.hp
        ? (ghost ? 0x666666 : 0xff3333)
        : 0x2a2a2a);
      g.fillRect(startX + i * (sz + gap), y, sz, sz);
    }
  }

  shutdown() {
    if (this.mp) { this.mp.off(); this.mp = null; }
  }
}

// ═══════════════════════════════════════════════════════
//  SCENE: GAME OVER
// ═══════════════════════════════════════════════════════
class GameOverScene extends Phaser.Scene {
  constructor() { super('GameOver'); }

  init(d) {
    this.finalScore = d.score || 0;
    this.prevMode   = d.mode  || '1p';
  }

  create() {
    this.menuBtns = [];
    this.selIdx   = 0;

    const g = this.add.graphics();
    g.fillStyle(0x0d0d1f); g.fillRect(0, 0, W, H);
    g.fillStyle(0x07070f); g.fillRect(0, 0, 20, H); g.fillRect(W - 20, 0, 20, H);

    // "GAME" shadow + main
    this.add.text(W / 2 + 4, 84, 'GAME', {
      fontSize: '52px', fontFamily: 'Press Start 2P', color: '#550000',
    }).setOrigin(0.5).setScale(3).setDepth(1);
    this.add.text(W / 2, 80, 'GAME', {
      fontSize: '52px', fontFamily: 'Press Start 2P',
      color: '#ff4444', stroke: '#880000', strokeThickness: 10,
    }).setOrigin(0.5).setScale(3).setDepth(2);

    // "OVER" shadow + main
    this.add.text(W / 2 + 4, 174, 'OVER', {
      fontSize: '52px', fontFamily: 'Press Start 2P', color: '#550000',
    }).setOrigin(0.5).setScale(3).setDepth(1);
    this.add.text(W / 2, 170, 'OVER', {
      fontSize: '52px', fontFamily: 'Press Start 2P',
      color: '#ff6666', stroke: '#880000', strokeThickness: 10,
    }).setOrigin(0.5).setScale(3).setDepth(2);

    this.add.text(W / 2, 330, `SCORE: ${this.finalScore}`, {
      fontSize: '18px', fontFamily: 'Press Start 2P', color: '#ffff88',
      stroke: '#664400', strokeThickness: 4,
    }).setOrigin(0.5);
    this.add.text(W / 2, 360, 'higher = deeper!', {
      fontSize: '10px', fontFamily: 'Press Start 2P', color: '#557755',
    }).setOrigin(0.5);

    this.mkBtn(W / 2, 440, 'PLAY AGAIN', 0x4488ff, () =>
      this.scene.start('Game', { mode: this.prevMode }));
    this.mkBtn(W / 2, 496, 'MAIN MENU',  0x555566, () =>
      this.scene.start('Menu'));

    this.add.text(W / 2, 555, '↑ ↓ navigate   ENTER select   ESC menu', {
      fontSize: '12px', fontFamily: 'Fredoka One', color: '#446644',
    }).setOrigin(0.5);

    this.cursors  = this.input.keyboard.createCursorKeys();
    this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.escKey   = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.updateSel();
  }

  mkBtn(x, y, label, color, cb) {
    const hex = '#' + color.toString(16).padStart(6, '0');
    const t = this.add.text(x, y, label, {
      fontSize: '22px', fontFamily: 'Fredoka One', color: hex,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const idx = this.menuBtns.length;
    t.on('pointerover', () => { this.selIdx = idx; this.updateSel(); });
    t.on('pointerdown', cb);
    this.menuBtns.push({ t, cb });
    return t;
  }

  updateSel() {
    this.menuBtns.forEach((b, i) => {
      b.t.setAlpha(i === this.selIdx ? 1.0 : 0.4);
      b.t.setScale(i === this.selIdx ? 1.09 : 1.0);
      b.t.setText((i === this.selIdx ? '▶  ' : '    ') + b.t.text.replace(/^[▶ ]+/, ''));
    });
  }

  update() {
    if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) {
      this.selIdx = (this.selIdx + 1) % this.menuBtns.length;
      this.updateSel();
    }
    if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) {
      this.selIdx = (this.selIdx - 1 + this.menuBtns.length) % this.menuBtns.length;
      this.updateSel();
    }
    if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
      this.menuBtns[this.selIdx].cb();
    }
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.start('Menu');
    }
  }
}

// ═══════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════
// eslint-disable-next-line no-unused-vars
const game = new Phaser.Game({
  type: Phaser.AUTO,
  width:  W,
  height: H,
  backgroundColor: '#0d0d1f',
  scene: [MenuScene, OnlineLobbyScene, GameScene, GameOverScene],
  scale: {
    mode:       Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: { antialias: false },
});
