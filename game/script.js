// ============================================================
// SPACE INVADERS — Full Clone (Responsive)
// ============================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d',{desynchronized:true});
const wrapper = document.getElementById('game-wrapper');
// const canvasContainer = document.getElementById('canvas-container');

// ---- Virtual (logical) game resolution ----
const VW = 640;
const VH = 480;
// const ASPECT = VW / VH; // 4:3
const HUD_VIRTUAL_HEIGHT = 44; // virtual pixels reserved for HUD above canvas
const TOTAL_ASPECT = VW / (VH + HUD_VIRTUAL_HEIGHT);

// ---- Scale factor (updated on resize) ----
let S = 1; // pixel scale: 1 virtual unit = S screen pixels

function resize() {
    const winW = globalThis.innerWidth;
    const winH = globalThis.innerHeight;
    const padding = 16; // breathing room

    const availW = winW - padding;
    const availH = winH - padding;

    let wrapperW, wrapperH;

    if (availW / availH > TOTAL_ASPECT) {
        // Window is wider than game — height-limited
        wrapperH = availH;
        wrapperW = wrapperH * TOTAL_ASPECT;
    } else {
        // Window is taller than game — width-limited
        wrapperW = availW;
        wrapperH = wrapperW / TOTAL_ASPECT;
    }

    S = wrapperW / VW;

    wrapper.style.width = wrapperW + 'px';
    wrapper.style.height = wrapperH + 'px';

    // Scale HUD text via font-size on wrapper (base = 11px at S=1)
    wrapper.style.fontSize = Math.max(8, 11 * S) + 'px';

    // Canvas internal resolution matches its CSS display size for crisp pixels
    const canvasDisplayW = wrapperW;
    const canvasDisplayH = wrapperH - (HUD_VIRTUAL_HEIGHT * S);

    canvas.width = canvasDisplayW;
    canvas.height = canvasDisplayH;

    // Disable smoothing for crisp pixel art
    ctx.imageSmoothingEnabled = false;
}

globalThis.addEventListener('resize', resize);
resize();

// ---- Helper: convert virtual coords to canvas coords ----
function vx(x) { return x * S; }
function vy(y) { return y * S; }
function vs(size) { return size * S; }

// ---- Screens ----
const titleScreen = document.getElementById('title-screen');
const gameoverScreen = document.getElementById('gameover-screen');
const pauseScreen = document.getElementById('pause-screen');
const scoreEl = document.getElementById('score');
const hiScoreEl = document.getElementById('hi-score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const finalScoreEl = document.getElementById('final-score');
const finalHiEl = document.getElementById('final-hi');

// ---- Audio (procedural) ----
const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
let audioCtx;

function ensureAudio() {
    if (!audioCtx) audioCtx = new AudioCtx();
}

function playSound(type) {
    ensureAudio();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;

    switch (type) {
        case 'shoot':
            osc.type = 'square';
            osc.frequency.setValueAtTime(600, t);
            osc.frequency.exponentialRampToValueAtTime(200, t + 0.1);
            gain.gain.setValueAtTime(0.08, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
            osc.start(t); osc.stop(t + 0.1);
            break;
        case 'invaderDie':
            osc.type = 'square';
            osc.frequency.setValueAtTime(800, t);
            osc.frequency.exponentialRampToValueAtTime(100, t + 0.2);
            gain.gain.setValueAtTime(0.1, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
            osc.start(t); osc.stop(t + 0.2);
            break;
        case 'playerDie':
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(300, t);
            osc.frequency.exponentialRampToValueAtTime(50, t + 0.6);
            gain.gain.setValueAtTime(0.12, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
            osc.start(t); osc.stop(t + 0.6);
            break;
        case 'ufo':
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, t);
            osc.frequency.linearRampToValueAtTime(500, t + 0.15);
            osc.frequency.linearRampToValueAtTime(400, t + 0.3);
            gain.gain.setValueAtTime(0.06, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
            osc.start(t); osc.stop(t + 0.3);
            break;
        case 'wave':
            osc.type = 'sine';
            osc.frequency.setValueAtTime(200, t);
            osc.frequency.exponentialRampToValueAtTime(1000, t + 0.4);
            gain.gain.setValueAtTime(0.08, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
            osc.start(t); osc.stop(t + 0.5);
            break;
    }
}

// ---- Pixel art sprite definitions ----
const SPRITES = {
    invader1: [
        [
            '  0    0  ',
            '   0  0   ',
            '  000000  ',
            ' 00 00 00 ',
            '0000000000',
            '0 000000 0',
            '0 0    0 0',
            '   00 00  '
        ],
        [
            '  0    0  ',
            '0  0  0  0',
            '0 000000 0',
            '000 00 000',
            '0000000000',
            ' 0000000  ',
            '  0    0  ',
            ' 0      0 '
        ]
    ],
    invader2: [
        [
            '   00     ',
            '  0000    ',
            ' 000000   ',
            '00 00 00  ',
            '00000000  ',
            '  0  0    ',
            ' 0 00 0   ',
            '0 0  0 0  '
        ],
        [
            '   00     ',
            '  0000    ',
            ' 000000   ',
            '00 00 00  ',
            '00000000  ',
            ' 0 00 0   ',
            '0      0  ',
            ' 0    0   '
        ]
    ],
    invader3: [
        [
            '    00    ',
            '   0000   ',
            '  000000  ',
            ' 00 00 00 ',
            ' 00000000 ',
            '   0  0   ',
            '  0 00 0  ',
            '00      00'
        ],
        [
            '    00    ',
            '   0000   ',
            '  000000  ',
            ' 00 00 00 ',
            ' 00000000 ',
            '  0 00 0  ',
            '  0    0  ',
            '   0  0   '
        ]
    ],
    player: [
        [
            '     0     ',
            '    000    ',
            '    000    ',
            ' 000000000 ',
            '00000000000',
            '00000000000',
            '00000000000',
        ]
    ],
    ufo: [
        [
            '    000000    ',
            '  0000000000  ',
            ' 000000000000 ',
            '00 00 00 00 00',
            '00000000000000',
            '   00  0 00   ',
            '    0    0    ',
        ]
    ]
};

// Draw sprite in VIRTUAL coordinates — scale factor applied internally
function drawSprite(sprite, vxPos, vyPos, color, pixelScale = 3) {
    ctx.fillStyle = color;
    const ps = pixelScale * S;
    const sx = vxPos * S;
    const sy = vyPos * S;
    for (let row = 0; row < sprite.length; row++) {
        for (let col = 0; col < sprite[row].length; col++) {
            if (sprite[row][col] === '0') {
                ctx.fillRect(sx + col * ps, sy + row * ps, ps, ps);
            }
        }
    }
}

function _spriteVW(sprite, pixelScale = 3) {
    return sprite[0].length * pixelScale;
}
function _spriteVH(sprite, pixelScale = 3) {
    return sprite.length * pixelScale;
}

// ---- Particle system (virtual coords) ----
let particles = [];

function spawnExplosion(x, y, color, count = 12) {
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 / count) * i + Math.random() * 0.5;
        const speed = 1 + Math.random() * 3;
        particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1,
            decay: 0.02 + Math.random() * 0.03,
            size: 1 + Math.random() * 2,
            color
        });
    }
}

function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function drawParticles() {
    for (const p of particles) {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        const sz = vs(p.size);
        ctx.fillRect(vx(p.x) - sz / 2, vy(p.y) - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
}

// ---- Stars background on canvas (virtual coords) ----
const stars = [];
for (let i = 0; i < 80; i++) {
    stars.push({
        x: Math.random() * VW,
        y: Math.random() * VH,
        size: Math.random() * 1.5 + 0.5,
        speed: Math.random() * 0.3 + 0.1,
        brightness: Math.random()
    });
}

function drawStars() {
    for (const s of stars) {
        s.y += s.speed;
        if (s.y > VH) { s.y = 0; s.x = Math.random() * VW; }
        const alpha = 0.3 + Math.sin(Date.now() * 0.003 + s.brightness * 10) * 0.2;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#fff';
        ctx.fillRect(vx(s.x), vy(s.y), vs(s.size), vs(s.size));
    }
    ctx.globalAlpha = 1;
}

// ---- Game State ----
const STATE = { TITLE: 0, PLAYING: 1, GAMEOVER: 2, PAUSED: 3, DYING: 4, WAVE_CLEAR: 5 };
let state = STATE.TITLE;
let score = 0;
let hiScore = parseInt(localStorage.getItem('si_hiscore') || '0');
let lives = 3;
let wave = 1;

// ---- Player (virtual coords) ----
const player = { x: VW / 2 - 16, y: VH - 45, w: 33, h: 21, speed: 5, bullet: null, invincible: 0 };

// ---- Invaders ----
let invaders = [];
let invaderDir = 1;
const invaderDropAmount = 14;
let invaderShootChance = 0.008;
let invaderBullets = [];
let invaderFrame = 0;
let invaderMoveTimer = 0;
let invaderMoveInterval = 40;

// ---- UFO ----
let ufo = null;
let ufoTimer = 0;
const UFO_INTERVAL = 900;

// ---- Shields ----
let shields = [];

// ---- Score popups ----
let popups = [];

// ---- Timers ----
let dyingTimer = 0;
let waveClearTimer = 0;

// ---- Input ----
const keys = {};
globalThis.addEventListener('keydown', e => {
    keys[e.key] = true;
    if ((e.key === 'Enter' || e.key === ' ') && state === STATE.TITLE) {
        startGame();
        e.preventDefault();
    }
    if (e.key === 'Enter' && state === STATE.GAMEOVER) {
        resetToTitle();
        startGame();
        e.preventDefault();
    }
    if (e.key === 'p' || e.key === 'P') {
        if (state === STATE.PLAYING) { state = STATE.PAUSED; pauseScreen.classList.remove('hidden'); }
        else if (state === STATE.PAUSED) { state = STATE.PLAYING; pauseScreen.classList.add('hidden'); }
    }
    if (e.key === ' ') e.preventDefault();
});
globalThis.addEventListener('keyup', e => { keys[e.key] = false; });

// ---- Setup functions ----
function createInvaders() {
    invaders = [];
    const types = [SPRITES.invader3, SPRITES.invader1, SPRITES.invader1, SPRITES.invader2, SPRITES.invader2];
    const colors = ['#ff2975', '#b347ea', '#b347ea', '#00f0ff', '#00f0ff'];
    const points = [40, 20, 20, 10, 10];
    const cols = 11;
    const spacingX = 46;
    const spacingY = 36;
    const offsetX = (VW - cols * spacingX) / 2 + 10;
    const offsetY = 60;

    for (let row = 0; row < 5; row++) {
        for (let col = 0; col < cols; col++) {
            invaders.push({
                x: offsetX + col * spacingX,
                y: offsetY + row * spacingY,
                type: types[row],
                color: colors[row],
                points: points[row],
                alive: true,
                row, col
            });
        }
    }
}

function createShields() {
    shields = [];
    const shieldPattern = [
        '  000000  ',
        ' 00000000 ',
        '0000000000',
        '0000000000',
        '0000000000',
        '0000000000',
        '000    000',
        '00      00',
    ];
    const count = 4;
    const spacing = VW / (count + 1);
    const scale = 4;
    for (let i = 0; i < count; i++) {
        const sx = spacing * (i + 1) - (shieldPattern[0].length * scale) / 2;
        const sy = VH - 110;
        const pixels = [];
        for (let r = 0; r < shieldPattern.length; r++) {
            for (let c = 0; c < shieldPattern[r].length; c++) {
                if (shieldPattern[r][c] === '0') {
                    pixels.push({ x: sx + c * scale, y: sy + r * scale, w: scale, h: scale, alive: true });
                }
            }
        }
        shields.push(pixels);
    }
}

function resetWave() {
    createInvaders();
    invaderDir = 1;
    invaderBullets = [];
    player.bullet = null;
    ufo = null;
    ufoTimer = 0;
    invaderFrame = 0;
    invaderMoveTimer = 0;
    invaderMoveInterval = Math.max(12, 40 - (wave - 1) * 4);
    invaderShootChance = Math.min(0.025, 0.008 + (wave - 1) * 0.003);
}

function startGame() {
    titleScreen.classList.add('hidden');
    gameoverScreen.classList.add('hidden');
    score = 0;
    lives = 3;
    wave = 1;
    player.x = VW / 2 - 16;
    player.invincible = 0;
    particles = [];
    popups = [];
    createShields();
    resetWave();
    state = STATE.PLAYING;
    updateHUD();
}

function resetToTitle() {
    state = STATE.TITLE;
    titleScreen.classList.remove('hidden');
    gameoverScreen.classList.add('hidden');
}

function gameOver() {
    state = STATE.GAMEOVER;
    if (score > hiScore) {
        hiScore = score;
        localStorage.setItem('si_hiscore', hiScore);
    }
    finalScoreEl.textContent = score;
    finalHiEl.textContent = hiScore;
    gameoverScreen.classList.remove('hidden');
}

// ---- HUD ----
function updateHUD() {
    scoreEl.textContent = String(score).padStart(4, '0');
    hiScoreEl.textContent = String(hiScore).padStart(4, '0');
    levelEl.textContent = wave;
    livesEl.innerHTML = '';
    for (let i = 0; i < lives; i++) {
        const d = document.createElement('div');
        d.className = 'life';
        livesEl.appendChild(d);
    }
}

// ---- Collision (all in virtual coords) ----
function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ---- Update (all logic in virtual coords) ----
function update() {
    if (state === STATE.DYING) {
        dyingTimer--;
        updateParticles();
        if (dyingTimer <= 0) {
            if (lives <= 0) {
                gameOver();
            } else {
                player.x = VW / 2 - 16;
                player.invincible = 120;
                state = STATE.PLAYING;
            }
        }
        return;
    }

    if (state === STATE.WAVE_CLEAR) {
        waveClearTimer--;
        updateParticles();
        if (waveClearTimer <= 0) {
            wave++;
            resetWave();
            updateHUD();
            state = STATE.PLAYING;
            playSound('wave');
        }
        return;
    }

    if (state !== STATE.PLAYING) return;

    // ---- Player movement ----
    if (keys['ArrowLeft'] || keys['a'] || keys['A']) player.x -= player.speed;
    if (keys['ArrowRight'] || keys['d'] || keys['D']) player.x += player.speed;
    player.x = Math.max(5, Math.min(VW - player.w - 5, player.x));

    if (player.invincible > 0) player.invincible--;

    // ---- Player shoot ----
    if ((keys[' '] || keys['ArrowUp']) && !player.bullet) {
        player.bullet = { x: player.x + player.w / 2 - 1.5, y: player.y - 4, w: 3, h: 10 };
        playSound('shoot');
    }

    // ---- Player bullet ----
    if (player.bullet) {
        player.bullet.y -= 8;
        if (player.bullet.y < -10) player.bullet = null;
    }

    // ---- Invader movement (step-based) ----
    invaderMoveTimer++;
    if (invaderMoveTimer >= invaderMoveInterval) {
        invaderMoveTimer = 0;
        invaderFrame = 1 - invaderFrame;

        let edgeHit = false;
        const aliveInvaders = invaders.filter(inv => inv.alive);
        const step = 8 + Math.max(0, (55 - aliveInvaders.length) * 0.3);

        for (const inv of aliveInvaders) {
            inv.x += step * invaderDir;
        }

        for (const inv of aliveInvaders) {
            if (inv.x + 30 > VW - 10 || inv.x < 10) {
                edgeHit = true;
                break;
            }
        }

        if (edgeHit) {
            invaderDir *= -1;
            for (const inv of aliveInvaders) {
                inv.y += invaderDropAmount;
            }
        }

        const remaining = aliveInvaders.length;
        if (remaining <= 5) invaderMoveInterval = Math.max(3, invaderMoveInterval);
        if (remaining <= 2) invaderMoveInterval = 2;
        if (remaining === 1) invaderMoveInterval = 1;
    }

    // ---- Invader shooting ----
    const alive = invaders.filter(i => i.alive);
    const bottomInvaders = {};
    for (const inv of alive) {
        if (!bottomInvaders[inv.col] || inv.row > bottomInvaders[inv.col].row) {
            bottomInvaders[inv.col] = inv;
        }
    }
    const shooters = Object.values(bottomInvaders);
    for (const inv of shooters) {
        if (Math.random() < invaderShootChance) {
            invaderBullets.push({ x: inv.x + 12, y: inv.y + 20, w: 3, h: 10, color: inv.color });
        }
    }

    // ---- Invader bullets ----
    for (let i = invaderBullets.length - 1; i >= 0; i--) {
        invaderBullets[i].y += 4 + wave * 0.3;
        if (invaderBullets[i].y > VH + 10) {
            invaderBullets.splice(i, 1);
            continue;
        }

        // Hit player
        if (player.invincible <= 0 && rectsOverlap(invaderBullets[i], { x: player.x, y: player.y, w: player.w, h: player.h })) {
            playerHit();
            invaderBullets.splice(i, 1);
            continue;
        }

        // Hit shields
        let shieldHit = false;
        for (const shield of shields) {
            for (const px of shield) {
                if (px.alive && rectsOverlap(invaderBullets[i], px)) {
                    px.alive = false;
                    destroyShieldArea(shield, px.x, px.y, 8);
                    shieldHit = true;
                    break;
                }
            }
            if (shieldHit) break;
        }
        if (shieldHit) {
            invaderBullets.splice(i, 1);
        }
    }

    // ---- Player bullet collisions ----
    if (player.bullet) {
        for (const inv of invaders) {
            if (!inv.alive) continue;
            const invRect = { x: inv.x, y: inv.y, w: 30, h: 21 };
            if (rectsOverlap(player.bullet, invRect)) {
                inv.alive = false;
                score += inv.points;
                spawnExplosion(inv.x + 15, inv.y + 10, inv.color, 16);
                popups.push({ x: inv.x + 5, y: inv.y, text: inv.points, life: 40, color: inv.color });
                player.bullet = null;
                playSound('invaderDie');
                updateHUD();
                break;
            }
        }

        if (player.bullet && ufo) {
            const ufoRect = { x: ufo.x, y: ufo.y, w: 42, h: 21 };
            if (rectsOverlap(player.bullet, ufoRect)) {
                const pts = [50, 100, 150, 200, 300][Math.floor(Math.random() * 5)];
                score += pts;
                spawnExplosion(ufo.x + 21, ufo.y + 10, '#ff2975', 24);
                popups.push({ x: ufo.x + 5, y: ufo.y, text: pts, life: 60, color: '#ff2975' });
                ufo = null;
                player.bullet = null;
                playSound('invaderDie');
                updateHUD();
            }
        }

        if (player.bullet) {
            for (const shield of shields) {
                for (const px of shield) {
                    if (px.alive && rectsOverlap(player.bullet, px)) {
                        px.alive = false;
                        player.bullet = null;
                        break;
                    }
                }
                if (!player.bullet) break;
            }
        }
    }

    // ---- Invaders reaching bottom ----
    for (const inv of alive) {
        if (inv.y + 24 >= player.y) {
            gameOver();
            return;
        }
    }

    // ---- Invaders hitting shields ----
    for (const inv of alive) {
        for (const shield of shields) {
            for (const px of shield) {
                if (px.alive && rectsOverlap({ x: inv.x, y: inv.y, w: 30, h: 21 }, px)) {
                    px.alive = false;
                }
            }
        }
    }

    // ---- UFO ----
    ufoTimer++;
    if (!ufo && ufoTimer > UFO_INTERVAL) {
        ufoTimer = 0;
        ufo = { x: -50, y: 25, dir: 1 };
        if (Math.random() > 0.5) { ufo.x = VW + 50; ufo.dir = -1; }
    }
    if (ufo) {
        ufo.x += ufo.dir * 2;
        if (ufo.x < -60 || ufo.x > VW + 60) ufo = null;
        else if (Math.random() < 0.03) playSound('ufo');
    }

    // ---- Check wave clear ----
    if (invaders.every(i => !i.alive)) {
        state = STATE.WAVE_CLEAR;
        waveClearTimer = 90;
    }

    // ---- Particles & popups ----
    updateParticles();
    for (let i = popups.length - 1; i >= 0; i--) {
        popups[i].y -= 0.5;
        popups[i].life--;
        if (popups[i].life <= 0) popups.splice(i, 1);
    }
}

function destroyShieldArea(shield, cx, cy, radius) {
    for (const px of shield) {
        if (px.alive) {
            const dx = px.x - cx;
            const dy = px.y - cy;
            if (dx * dx + dy * dy < radius * radius) {
                px.alive = false;
            }
        }
    }
}

function playerHit() {
    lives--;
    updateHUD();
    spawnExplosion(player.x + player.w / 2, player.y + player.h / 2, '#00f0ff', 20);
    playSound('playerDie');
    state = STATE.DYING;
    dyingTimer = 90;
    player.bullet = null;
}

// ---- Render (virtual → screen via S) ----
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Disable smoothing every frame (some browsers reset it)
    ctx.imageSmoothingEnabled = false;

    // Stars
    drawStars();

    // Ground line
    ctx.strokeStyle = 'rgba(57, 255, 20, 0.2)';
    ctx.lineWidth = Math.max(1, S);
    ctx.beginPath();
    ctx.moveTo(0, vy(VH - 20));
    ctx.lineTo(canvas.width, vy(VH - 20));
    ctx.stroke();

    if (state === STATE.TITLE || state === STATE.GAMEOVER || state === STATE.PAUSED) {
        return;
    }

    // ---- Shields ----
    ctx.fillStyle = '#39ff14';
    ctx.shadowColor = '#39ff14';
    ctx.shadowBlur = 2 * S;
    for (const shield of shields) {
        for (const px of shield) {
            if (px.alive) {
                ctx.fillRect(vx(px.x), vy(px.y), vs(px.w), vs(px.h));
            }
        }
    }
    ctx.shadowBlur = 0;

    // ---- Invaders ----
    for (const inv of invaders) {
        if (!inv.alive) continue;
        const frame = inv.type[invaderFrame] || inv.type[0];
        drawSprite(frame, inv.x, inv.y, inv.color);
    }

    // ---- UFO ----
    if (ufo) {
        ctx.shadowColor = '#ff2975';
        ctx.shadowBlur = 15 * S;
        drawSprite(SPRITES.ufo[0], ufo.x, ufo.y, '#ff2975');
        ctx.shadowBlur = 0;
    }

    // ---- Player ----
    if (state !== STATE.DYING || Math.floor(dyingTimer / 4) % 2 === 0) {
        if (player.invincible <= 0 || Math.floor(player.invincible / 4) % 2 === 0) {
            ctx.shadowColor = '#00f0ff';
            ctx.shadowBlur = 8 * S;
            drawSprite(SPRITES.player[0], player.x, player.y, '#00f0ff');
            ctx.shadowBlur = 0;
        }
    }

    // ---- Player bullet ----
    if (player.bullet) {
        ctx.fillStyle = '#ffe600';
        ctx.shadowColor = '#ffe600';
        ctx.shadowBlur = 6 * S;
        ctx.fillRect(vx(player.bullet.x), vy(player.bullet.y), vs(player.bullet.w), vs(player.bullet.h));
        ctx.shadowBlur = 0;
    }

    // ---- Invader bullets ----
    for (const b of invaderBullets) {
        ctx.fillStyle = b.color || '#ff2975';
        ctx.shadowColor = b.color || '#ff2975';
        ctx.shadowBlur = 4 * S;
        const zigzag = Math.sin(b.y * 0.3) * 2;
        ctx.fillRect(vx(b.x + zigzag), vy(b.y), vs(b.w), vs(b.h));
        ctx.shadowBlur = 0;
    }

    // ---- Particles ----
    drawParticles();

    // ---- Score popups ----
    for (const p of popups) {
        ctx.globalAlpha = p.life / 40;
        ctx.font = `${vs(10)}px "Press Start 2P"`;
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, vx(p.x), vy(p.y));
    }
    ctx.globalAlpha = 1;

    // ---- Wave announcement ----
    if (state === STATE.WAVE_CLEAR) {
        ctx.font = `${vs(16)}px "Press Start 2P"`;
        ctx.fillStyle = '#ffe600';
        ctx.shadowColor = '#ffe600';
        ctx.shadowBlur = 20 * S;
        ctx.textAlign = 'center';
        ctx.fillText(`WAVE ${wave} COMPLETE`, canvas.width / 2, vy(VH / 2));
        ctx.font = `${vs(10)}px "Press Start 2P"`;
        ctx.fillStyle = '#39ff14';
        ctx.fillText(`WAVE ${wave + 1} INCOMING`, canvas.width / 2, vy(VH / 2 + 30));
        ctx.textAlign = 'left';
        ctx.shadowBlur = 0;
    }
}

// ---- Game loop ----
function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

// ---- Init ----
updateHUD();
gameLoop();
