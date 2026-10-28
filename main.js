const { app, BaseWindow, BrowserWindow, WebContentsView, View, Menu, Tray, ipcMain, dialog, shell, nativeImage, session, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

// Garante uma única instância do aplicativo rodando.
// Se o usuário tentar abrir de novo (ex.: pelo atalho enquanto está nos ícones ocultos),
// traz a janela existente para a frente em vez de abrir um segundo processo.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
}

// Suporte a dados portáteis: se existir a pasta "mefislink-data" ao lado do executável, usa ela.
// Caso contrário, salva no AppData do Windows do usuário (%APPDATA%\Mefislink).
const portableData = path.join(path.dirname(process.execPath), 'mefislink-data');
if (fs.existsSync(portableData)) {
  app.setPath('userData', portableData);
} else {
  app.setPath('userData', path.join(app.getPath('appData'), 'Mefislink'));
}

// As lives abertas em segundo plano ficam com a GUIA mutada (como "mutar guia" no navegador);
// o player em si continua com som, então precisa poder tocar sem clique do usuário.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Não deixa o Windows/Chromium "adormecer" as páginas quando o Mefislink fica atrás de outra janela:
// sem isso, o player da Kick pausa assim que você abre outro programa por cima.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// Identificadores de navegador
const GOOGLE_AUTH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0';
const CLEAN_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
app.userAgentFallback = CLEAN_UA;

// Intercepta requisições de autenticação do Google para contornar a tela "Esse navegador ou app pode não ser seguro"
function applyGoogleLoginFix(ses) {
  if (!ses || ses._googleFixApplied) return;
  ses._googleFixApplied = true;
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const url = details.url || '';
    if (/accounts\.google\.com|google\.com\/signin|oauth2\.googleapis\.com|apis\.google\.com/i.test(url)) {
      details.requestHeaders['User-Agent'] = GOOGLE_AUTH_UA;
      delete details.requestHeaders['sec-ch-ua'];
      delete details.requestHeaders['sec-ch-ua-mobile'];
      delete details.requestHeaders['sec-ch-ua-platform'];
      delete details.requestHeaders['Sec-CH-UA'];
      delete details.requestHeaders['Sec-CH-UA-Mobile'];
      delete details.requestHeaders['Sec-CH-UA-Platform'];
    } else if (details.requestHeaders['User-Agent'] && /Electron/i.test(details.requestHeaders['User-Agent'])) {
      details.requestHeaders['User-Agent'] = CLEAN_UA;
    }
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });
}

// esconde a marca de "navegador controlado por automação"
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

// Silencia os avisos "Failed to load URL ... ERR_BLOCKED_BY_CSP" (pixel do Facebook, inofensivo)
process.removeAllListeners('warning');

// ====== CONFIGURE AQUI ======
const GAME_URL = 'https://pokeidle.io';
const ACCOUNTS = ['Conta 1', 'Conta 2', 'Conta 3', 'Conta 4'];
// ============================

// ====== VERSÃO ======
const APP_NAME = 'Mefislink';
const APP_VERSION = '1.1.2';
const APP_CHANNEL = '';
// Contato para pedidos de remoção (aparece em "Direitos e marcas"). Ex.: 'contato@seudominio.com'
// Enquanto estiver vazio, esse trecho não é exibido.
const SUPPORT_CONTACT = '';
// ====================

// Modo desenvolvedor: só quando o app roda pelo código (npm start / electron .).
// No .exe gerado, as opções de desenvolvedor (atualizar arquivos, pasta do app, F12) não existem.
const DEV = !app.isPackaged;

// Ícone do app: definido por você (desenvolvedor), não pelo usuário.
// Para trocar, coloque "icone.png" (ou .jpg/.ico) na pasta do projeto ANTES de gerar o .exe.
// Sem arquivo, usa o ícone padrão do Mefislink (o elo dourado).
const ICON_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', ico: 'image/x-icon' };
function customIconPath() {
  for (const ext of Object.keys(ICON_MIME)) {
    const f = path.join(__dirname, 'icone.' + ext);
    try { if (fs.statSync(f).isFile()) return f; } catch {}
  }
  return null;
}
// a imagem vai para a barra já embutida (data:), assim não depende de caminho de pasta
function customIconUrl() {
  const f = customIconPath();
  if (!f) return null;
  try {
    const buf = fs.readFileSync(f);
    return `data:${ICON_MIME[path.extname(f).slice(1).toLowerCase()]};base64,${buf.toString('base64')}`;
  } catch { return null; }
}
function applyWindowIcon() {
  const f = customIconPath();
  if (!f || !win) return;
  const img = nativeImage.createFromPath(f);
  if (!img.isEmpty()) win.setIcon(img);
}

const BAR_H = 38;
// barra de título customizada (substitui a barra de menu nativa do Windows)
const TITLE_H = 34;
const TITLE_BG = '#0b0f19';   // Dark Obsidian: combina com a nova barra de controle
const TITLE_FG = '#f8fafc';
let titleBar = null;
let menuOpen = false; // com um menu aberto, a barra de título cobre a janela toda (transparente)
let appMenu = null;
let win;
let tray = null;
let isQuitting = false;
let hasNotifiedTray = false;

function showMainWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

function createTray() {
  if (tray) return;

  const icoFile = path.join(__dirname, 'icone.ico');
  const pngFile = path.join(__dirname, 'icone.png');
  let icon = null;

  if (fs.existsSync(icoFile)) {
    icon = nativeImage.createFromPath(icoFile);
  } else if (fs.existsSync(pngFile)) {
    icon = nativeImage.createFromPath(pngFile);
  } else {
    const custom = customIconPath();
    if (custom) icon = nativeImage.createFromPath(custom);
  }

  tray = new Tray(icon || icoFile);
  tray.setToolTip('Mefislink');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Mefislink',
      click: () => {
        showMainWindow();
      },
    },
    { type: 'separator' },
    {
      label: 'Encerrar o Mefislink',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    showMainWindow();
  });

  tray.on('double-click', () => {
    showMainWindow();
  });
}
let bars = [];
let views = [];
let focused = -1; // -1 = grade 2x2, 0..3 = tela cheia de uma conta
const level = ACCOUNTS.map(() => 0); // 0 normal, 1 ECO, 2 ECO MAX, 3 dormindo
const ecoCss = ACCOUNTS.map(() => null);

// ---------- Zoom (largura "virtual" do jogo) ----------
let REF_WIDTH = 1920;
const cfgFile = () => path.join(app.getPath('userData'), 'zoom.json');
const barsEdge = true; // barras das contas 3 e 4 sempre na borda de baixo da janela
function loadRef() {
  try {
    const j = JSON.parse(fs.readFileSync(cfgFile(), 'utf8'));
    REF_WIDTH = j.ref || REF_WIDTH;
  } catch {}
}
function saveCfg() {
  try { fs.writeFileSync(cfgFile(), JSON.stringify({ ref: REF_WIDTH })); } catch {}
}
function changeRef(delta) {
  REF_WIDTH = Math.min(2600, Math.max(900, REF_WIDTH + delta));
  saveCfg();
  layout();
}
// 'top' = barra em cima do jogo | 'bottom' = barra embaixo do jogo
function barPos(i) {
  return focused === -1 && barsEdge && i >= 2 ? 'bottom' : 'top';
}
function applyZoom(v, width) {
  const z = width / REF_WIDTH;
  if (!isFinite(z) || z <= 0) return; // janela minimizada / em transição
  v.webContents.setZoomFactor(z);
}

// ---------- Layout ----------
function layout() {
  if (!win || win.isDestroyed() || bars.length < ACCOUNTS.length) return;
  const { width, height: fullH } = win.getContentBounds();
  const top = titleH();
  const height = fullH - top;
  if (width < 100 || height < 100) return;
  if (titleBar) {
    titleBar.setVisible(top > 0);
    if (liveCover) liveCover.setBounds({ x: 0, y: 0, width, height: fullH });
    titleBar.setBounds({ x: 0, y: 0, width, height: menuOpen || dialogOpen ? fullH : TITLE_H });
  }
  const w = Math.floor(width / 2);
  const h = Math.floor(height / 2);
  views.forEach((v, i) => {
    const grid = focused === -1;
    if (!grid && focused !== i) { // modo ampliado: esconde as outras contas
      v.setVisible(false);
      bars[i].setVisible(false);
      return;
    }
    const row = grid ? Math.floor(i / 2) : 0;
    const x = grid ? (i % 2) * w : 0;
    const y = (grid ? row * h : 0) + top;
    const bw = grid ? w : width;
    const bh = grid ? (row === 0 ? h : height - h) : height; // a linha de baixo ocupa o resto
    const bottom = barPos(i) === 'bottom';
    bars[i].setVisible(true);
    bars[i].setBounds({ x, y: bottom ? y + bh - BAR_H : y, width: bw, height: BAR_H });
    if (level[i] === 3) {
      detachView(i);
      try { v.setVisible(false); } catch {}
      return;
    } // hibernando: só a barra fica
    attachView(i);
    v.setVisible(true);
    v.setBounds({ x, y: bottom ? y : y + BAR_H, width: bw, height: bh - BAR_H });
    applyZoom(v, bw);
  });
}

// em tela cheia (F11) a barra de título some, como no Windows
function titleH() {
  return titleBar && !win.isFullScreen() ? TITLE_H : 0;
}

// Hibernar TIRA a conta da janela (em vez de só escondê-la) e, ao voltar, coloca de novo.
// Só esconder com setVisible deixava a área da conta vazia/cinza ao voltar em alguns PCs.
const attached = ACCOUNTS.map(() => true);
function detachView(i) {
  if (!attached[i]) return;
  try { win.contentView.removeChildView(views[i]); } catch {}
  attached[i] = false;
}
function attachView(i) {
  if (attached[i]) return;
  win.contentView.addChildView(views[i]);
  attached[i] = true;
  if (bars && bars[i]) win.contentView.addChildView(bars[i]);
  // a barra de título (menus e pop-ups) precisa continuar por cima de tudo
  if (titleBar) win.contentView.addChildView(titleBar);
}

function setFocus(n) {
  focused = n;
  layout();
  sendState();
}

// ---------- Níveis de economia ----------
// 1 = Eco (~4 fps) | 2 = Super Eco (~1 fps, esconde o mapa/canvas) | 3 = Hibernar (tela escondida)
const ECO_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
    filter: none !important;
    backdrop-filter: none !important;
    box-shadow: none !important;
    text-shadow: none !important;
  }`;
const MAX_CSS = ` canvas { visibility: hidden !important; }`;

const ecoOn = (ms) => `(() => {
  if (window.__eco) return;
  const o = { raf: window.requestAnimationFrame, caf: window.cancelAnimationFrame };
  window.__eco = o;
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), ${ms});
  window.cancelAnimationFrame = (id) => { clearTimeout(id); try { o.caf.call(window, id); } catch (e) {} };
})()`;

const ECO_OFF = `(() => {
  if (!window.__eco) return;
  window.requestAnimationFrame = window.__eco.raf;
  window.cancelAnimationFrame = window.__eco.caf;
  delete window.__eco;
})()`;

// promessa com limite de tempo: página escondida/pausada pode nunca responder
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const levelSeq = ACCOUNTS.map(() => 0);

async function applyLevel(i, waking) {
  const wc = views[i].webContents;
  if (wc.isDestroyed()) return;
  const lv = level[i];
  const seq = ++levelSeq[i]; // se o nível mudar de novo no meio, esta aplicação para

  // 1) PRIMEIRO mostra/esconde a tela. Antes isso ficava no fim, depois de rodar scripts na página;
  //    vindo do Hibernar, a página pausada podia não responder e a tela nunca voltava (ficava preta).
  wc.setBackgroundThrottling(lv === 3); // hibernando: deixa o Chromium pausar a página escondida
  layout();
  if (waking) {
    // Depois de hibernar, o jogo pode não voltar a se desenhar sozinho (tela vazia).
    // Recarregar a conta garante que ela volta funcionando; o nível é reaplicado no dom-ready.
    ecoCss[i] = null;
    try { wc.invalidate(); } catch {}
    reloadAccount(i);
    return;
  }
  if (lv !== 3) { try { wc.invalidate(); } catch {} } // força redesenhar

  // 2) depois ajusta a página (efeitos/quadros), sem travar se ela demorar
  try {
    if (ecoCss[i]) { const k = ecoCss[i]; ecoCss[i] = null; await withTimeout(wc.removeInsertedCSS(k), 3000); }
    if (seq !== levelSeq[i]) return;
    await withTimeout(wc.executeJavaScript(ECO_OFF), 3000);
    if (seq !== levelSeq[i]) return;
    if (lv === 1 || lv === 2) {
      const k = await withTimeout(wc.insertCSS(lv === 2 ? ECO_CSS + MAX_CSS : ECO_CSS), 3000);
      if (seq !== levelSeq[i]) { wc.removeInsertedCSS(k).catch(() => {}); return; }
      ecoCss[i] = k;
      await withTimeout(wc.executeJavaScript(ecoOn(lv === 2 ? 1000 : 250)), 3000);
    }
  } catch {}

}

function sendState() {
  bars.forEach((b) => {
    if (!b.webContents.isDestroyed()) b.webContents.send('state', {
      level, names: displayNames(), focused, muted, pos: ACCOUNTS.map((_, i) => barPos(i)),
      auto: { enabled: auto.enabled, dry: auto.dry, status: autoStatus },
      lives: livesState(),
      loading,
      extBtns: EXTENSIONS.filter((e) => e.botao && !extOff.has(e.id)).map((e) => ({ id: e.id, botao: e.botao, nome: e.nome })),
    });
  });
  // selos na barra de menus (ex.: quantas lives abertas)
  if (titleBar && !titleBar.webContents.isDestroyed()) {
    const nLives = liveOpen.reduce((t, o) => t + o.twitch.size + o.kick.size, 0);
    titleBar.webContents.send('title-badges', { Lives: nLives });
  }
}

ipcMain.on('bar-ready', sendState);
// ----- medição de uso (CPU e memória) de cada conta, para ver se o modo de desempenho faz diferença -----
const usage = { porPid: new Map(), total: { cpu: 0, mem: 0 }, gpu: { cpu: 0, mem: 0 } };
function sampleUsage() {
  try {
    const ms = app.getAppMetrics();
    usage.porPid = new Map(ms.map((m) => [m.pid, { cpu: m.cpu.percentCPUUsage, mem: m.memory.workingSetSize / 1024 }]));
    usage.total = ms.reduce((t, m) => ({ cpu: t.cpu + m.cpu.percentCPUUsage, mem: t.mem + m.memory.workingSetSize / 1024 }), { cpu: 0, mem: 0 });
    const g = ms.find((m) => m.type === 'GPU');
    usage.gpu = g ? { cpu: g.cpu.percentCPUUsage, mem: g.memory.workingSetSize / 1024 } : { cpu: 0, mem: 0 };
  } catch {}
}
function usageOf(i) {
  const wc = views[i] && views[i].webContents;
  if (!wc || wc.isDestroyed()) return null;
  try { return usage.porPid.get(wc.getOSProcessId()) || null; } catch { return null; }
}
const fmtUso = (u) => (u ? `CPU ${u.cpu.toFixed(0)}% · ${Math.round(u.mem)} MB` : 'medindo...');

const LEVELS = [
  { name: 'Normal', desc: 'sem restrições' },
  { name: 'Eco', desc: 'animações a ~4 quadros/s, sem efeitos visuais' },
  { name: 'Super Eco', desc: '~1 quadro/s e esconde o mapa' },
  { name: 'Hibernar', desc: 'esconde a tela e quase para a conta; recarrega ao voltar' },
];
function showUsage() {
  sampleUsage();
  const linhas = ACCOUNTS.map((_, i) => `${nameOf(i)} — ${LEVELS[level[i]].name}: ${level[i] === 3 ? 'hibernando (página parada)' : fmtUso(usageOf(i))}`);
  const nLives = liveOpen.reduce((t, o) => t + o.twitch.size + o.kick.size, 0);
  // soma por grupo (cada página roda num processo próprio)
  const soma = (wcs) => {
    const pids = new Set();
    wcs.forEach((wc) => { try { if (wc && !wc.isDestroyed()) pids.add(wc.getOSProcessId()); } catch {} });
    return [...pids].reduce((t, pid) => { const u = usage.porPid.get(pid); return u ? { cpu: t.cpu + u.cpu, mem: t.mem + u.mem } : t; }, { cpu: 0, mem: 0 });
  };
  const livesDe = (p) => liveOpen.flatMap((o) => [...o[p].values()].map((sl) => sl.view && sl.view.webContents));
  const nTw = liveOpen.reduce((t, o) => t + o.twitch.size, 0);
  const nKk = liveOpen.reduce((t, o) => t + o.kick.size, 0);
  const grupos = [
    ['As 4 contas do jogo', soma(views.map((v) => v.webContents))],
    [`Lives da Twitch (${nTw})`, soma([...livesDe('twitch'), ...ircs.map((c) => c && c.view.webContents)])],
    [`Lives da Kick (${nKk})`, soma(livesDe('kick'))],
    ['Barras e painéis do Mefislink', soma([...bars.map((b) => b.webContents), titleBar && titleBar.webContents])],
    ['Placa de vídeo (desenho das telas)', usage.gpu],
  ].sort((x, y) => y[1].mem - x[1].mem);
  uiDialog({
    type: 'info',
    title: 'Uso de CPU e memória',
    message: 'Quanto cada conta está usando agora',
    detail: linhas.join('\n') +
      '\n\nPor grupo (do que mais gasta memória para o que menos gasta):\n' +
      grupos.map(([n, u]) => `${n}: ${fmtUso(u)}`).join('\n') +
      `\n\nPlaca de vídeo (desenho das telas): ${fmtUso(usage.gpu)}` +
      `\nMefislink inteiro (contas, barras, ${nLives} lives): ${fmtUso(usage.total)}` +
      '\n\nDica: troque o modo de uma conta, espere uns 10 segundos e abra de novo para comparar.',
  });
}
function setLevel(i, lv) {
  if (!(i >= 0 && i < ACCOUNTS.length) || !(lv >= 0 && lv <= 3)) return;
  const waking = level[i] === 3 && lv !== 3;
  level[i] = lv;
  applyLevel(i, waking);
  sendState();
}
ipcMain.on('level-set', (_, i, lv) => setLevel(i, lv));

let lastPerfMenu = null;
ipcMain.on('perf-menu', async (e, i, rect) => {
  if (!(i >= 0 && i < ACCOUNTS.length)) return;
  // menu no tema do Mefislink, desenhado pela barra de título (que cobre a janela enquanto ele está aberto)
  const canDraw = titleBar && !titleBar.webContents.isDestroyed() && win && !win.isFullScreen() && !win.isMinimized();
  if (canDraw && rect) {
    const b = bars[i].getBounds();
    const r = await uiPopup({
      x: b.x + Math.round(rect.left), y: b.y + Math.round(rect.bottom) + 4,
      up: b.y + Math.round(rect.top) - 4, // se não couber embaixo, abre para cima
      title: `Desempenho — ${nameOf(i)}`,
      sub: `Agora esta conta usa: ${fmtUso(usageOf(i))}` + (level[i] === 3 ? ' (hibernando)' : ''),
      items: LEVELS.map((L, lv) => ({ value: lv, label: L.name, desc: L.desc, checked: level[i] === lv, icon: ['▶', '🍃', '🔋', '💤'][lv] })),
    });
    if (r != null) setLevel(i, r);
    return;
  }
  lastPerfMenu = Menu.buildFromTemplate([
    { label: `Desempenho — ${nameOf(i)}`, enabled: false },
    { type: 'separator' },
    ...LEVELS.map((L, lv) => ({
      label: `${L.name}  —  ${L.desc}`,
      type: 'radio',
      checked: level[i] === lv,
      click: () => setLevel(i, lv),
    })),
  ]);
  lastPerfMenu.popup({ window: win });
});

// ---------- Som, recarregar e troca de tela (acionados pela barra) ----------
const muted = ACCOUNTS.map((_, i) => i > 0); // contas 2, 3 e 4 começam sem som

function setMuted(i, m) {
  muted[i] = !!m;
  views[i].webContents.setAudioMuted(muted[i]);
  const menu = Menu.getApplicationMenu();
  const item = menu && menu.getMenuItemById('mute' + i);
  if (item) item.checked = muted[i]; // mantém o menu Áudio em sincronia com a barra
  sendState();
}

ipcMain.on('view-set', (_, n) => {
  if (Number.isInteger(n) && n >= -1 && n < ACCOUNTS.length) setFocus(n);
});
// Recarregar uma conta de forma confiável.
// Antes falhava às vezes porque: (1) o jogo pedia "tem certeza que quer sair?" e o Electron
// cancelava o recarregamento em silêncio; (2) a página estava travada e não respondia.
const loading = ACCOUNTS.map(() => false);
function reloadAccount(i) {
  const wc = views[i] && views[i].webContents;
  if (!wc || wc.isDestroyed()) return;
  // Se a conta estiver em modo Hibernar (tela escondida), recarregar acorda a conta e volta para o modo Normal
  if (level[i] === 3) {
    setLevel(i, 0);
    return;
  }
  let started = false;
  const onStart = () => { started = true; };
  wc.once('did-start-loading', onStart);
  wc.reloadIgnoringCache();
  setTimeout(() => {
    if (wc.isDestroyed()) return;
    wc.removeListener('did-start-loading', onStart);
    if (started) return;
    // não começou a carregar: a página está travada; reinicia o processo dela e carrega de novo
    try { wc.forcefullyCrashRenderer(); } catch {}
    setTimeout(() => { if (!wc.isDestroyed()) wc.loadURL(GAME_URL).catch(() => {}); }, 300);
  }, 4000);
}
ipcMain.on('reload-account', (_, i) => {
  if (Number.isInteger(i) && i >= 0 && i < ACCOUNTS.length) reloadAccount(i);
});
ipcMain.on('mute-toggle', (_, i) => {
  if (views[i]) setMuted(i, !muted[i]);
});

// ---------- Atualização dentro do app ----------
const UPDATABLE = ['main.js', 'preload.js', 'bar.html'];

function restartApp() {
  app.relaunch();
  app.exit(0);
}

// Atualizações vêm num pacote ".mlk" (ou ".plk") ASSINADO por você.
// O app só instala pacotes cuja assinatura bate com esta chave pública, então ninguém além de você
// consegue colocar código no Mefislink por esse menu. Esta linha é preenchida pelo script na 1ª vez.
const UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAVcB59cUlJYYtgWKZjWaxLmSemRouKoYPqNnlAxj4nyI=
-----END PUBLIC KEY-----`;

const verParts = (v) => String(v).split(/[^0-9]+/).filter(Boolean).map(Number);
function compareVersions(a, b) {
  const x = verParts(a), y = verParts(b);
  for (let k = 0; k < Math.max(x.length, y.length); k++) {
    const d = (x[k] || 0) - (y[k] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// confere se cada arquivo tem o conteúdo certo (evita, por ex., código JS salvo como bar.html)
function checkFileContent(name, content) {
  if (typeof content !== 'string' || !content.trim()) return `${name} está vazio.`;
  if (name.endsWith('.html')) {
    if (!/^\s*<!doctype html/i.test(content)) return `${name} não é uma página HTML (o arquivo parece trocado).`;
    return null;
  }
  if (/^\s*</.test(content)) return `${name} parece ser HTML, não JavaScript (o arquivo parece trocado).`;
  if (name === 'main.js' && !content.includes('BaseWindow')) return 'main.js não parece ser o arquivo principal do Mefislink.';
  if (name === 'preload.js' && (!content.includes('exposeInMainWorld') || content.includes('BaseWindow'))) return 'preload.js não parece ser o preload do Mefislink.';
  try { new vm.Script(content, { filename: name }); } catch (e) { return `${name} tem erro de sintaxe: ${e.message}`; }
  return null;
}

// lê e confere um pacote; devolve { version, files } ou lança um erro com mensagem amigável
function readUpdatePackage(file) {
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error('O arquivo não é um pacote de atualização do Mefislink.'); }
  if (!pkg || typeof pkg.payload !== 'string' || typeof pkg.sig !== 'string') {
    throw new Error('O arquivo não é um pacote de atualização do Mefislink.');
  }
  let ok = false;
  try {
    ok = require('crypto').verify(null, Buffer.from(pkg.payload, 'utf8'), UPDATE_PUBLIC_KEY, Buffer.from(pkg.sig, 'base64'));
  } catch { ok = false; }
  if (!ok) throw new Error('A assinatura do pacote não é válida. Ele não foi gerado pelo desenvolvedor do Mefislink ou foi alterado.');
  const data = JSON.parse(pkg.payload);
  const names = Object.keys(data.files || {});
  if (!names.length || names.some((n) => !UPDATABLE.includes(n))) throw new Error('O pacote tem arquivos inesperados.');
  for (const n of names) {
    const err = checkFileContent(n, data.files[n]);
    if (err) throw new Error(err);
  }
  return { version: String(data.version || '?'), files: data.files };
}

async function applyUpdate() {
  if (!UPDATE_PUBLIC_KEY) {
    showError('Atualizações', 'As atualizações ainda não foram configuradas nesta versão do Mefislink.');
    return;
  }
  const r = await dialog.showOpenDialog({
    title: 'Escolha o pacote de atualização do Mefislink',
    properties: ['openFile'],
    filters: [{ name: 'Atualização do Mefislink', extensions: ['mlk', 'plk'] }],
  });
  if (r.canceled || !r.filePaths.length) return;

  let up;
  try { up = readUpdatePackage(r.filePaths[0]); }
  catch (e) { showError('Atualização recusada', e.message); return; }

  const cmp = compareVersions(up.version, APP_VERSION);
  const c = await uiDialog({
    type: cmp > 0 ? 'question' : 'warning',
    title: 'Atualização',
    message: cmp > 0
      ? `Atualizar de ${APP_VERSION} para ${up.version}?`
      : `Este pacote (${up.version}) não é mais novo que a versão instalada (${APP_VERSION}).`,
    detail: cmp > 0
      ? 'O Mefislink reinicia ao final. Os logins e configurações das contas são mantidos.'
      : 'Instalar mesmo assim vai substituir a versão atual por esta.',
    buttons: [cmp > 0 ? 'Atualizar' : 'Instalar mesmo assim', 'Cancelar'],
    defaultId: 0,
    cancelId: 1,
  });
  if (c.response !== 0) return;

  installPackage(up);
}

// grava os arquivos do pacote (já conferido) e reinicia
function installPackage(up) {
  try {
    for (const [name, content] of Object.entries(up.files)) {
      const dest = path.join(__dirname, name);
      if (fs.existsSync(dest)) fs.copyFileSync(dest, dest + '.bak'); // guarda a versão anterior
      fs.writeFileSync(dest, content, 'utf8');
    }
  } catch (e) {
    showError('Falha ao instalar', e.message);
    return false;
  }
  restartApp();
  return true;
}

// ---------- Atualização online ----------
// O Mefislink confere de tempos em tempos um arquivo "latest.json" publicado por você na internet
// (ex.: num repositório do GitHub). Se houver versão nova, avisa o usuário e instala com um clique.
// O pacote baixado passa pela MESMA conferência de assinatura: só pacotes assinados por você entram,
// mesmo que alguém mexa no site onde os arquivos estão.
// Atualizações automáticas remotas desligadas no Mefislink
const UPDATE_FEED_URL = '';
const UPDATE_CHECK_HOURS = 3;
let updateOffered = null;
let updateBusy = false;

// Lê o latest.json. No GitHub, o endereço "raw" fica alguns minutos em cache depois de você subir um
// arquivo novo; a API do GitHub entrega a versão mais recente na hora. Usa a API e, se falhar, o raw.
async function fetchFeed(ses) {
  const m = UPDATE_FEED_URL.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  if (m) {
    try {
      const api = `https://api.github.com/repos/${m[1]}/${m[2]}/contents/${m[4]}?ref=${m[3]}`;
      const r = await withTimeout(ses.fetch(api, { headers: { Accept: 'application/vnd.github.raw+json', 'User-Agent': 'Mefislink' } }), 15000);
      if (r.ok) return JSON.parse(await r.text());
    } catch {}
  }
  const r = await withTimeout(ses.fetch(UPDATE_FEED_URL + (UPDATE_FEED_URL.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' }), 20000);
  if (!r.ok) throw new Error('servidor respondeu ' + r.status);
  return r.json();
}

async function checkOnlineUpdate(manual) {
  if (updateBusy) return;
  if (!UPDATE_FEED_URL || !UPDATE_PUBLIC_KEY) {
    if (manual) uiDialog({ type: 'info', title: 'Atualizações', message: 'A atualização online ainda não foi configurada.', detail: `Versão instalada: ${APP_VERSION}.` });
    return;
  }
  updateBusy = true;
  try {
    const ses = session.fromPartition('persist:lives-check');
    const feed = await fetchFeed(ses);
    if (!feed || !feed.version || !feed.file) throw new Error('arquivo latest.json incompleto');
    if (compareVersions(feed.version, APP_VERSION) <= 0) {
      if (manual) uiDialog({ type: 'info', title: 'Atualizações', message: 'Você já está na versão mais recente.',
        detail: `Versão instalada: ${APP_VERSION}.\nVersão publicada online: ${feed.version}.` });
      return;
    }
    if (!manual && updateOffered === feed.version) return; // já ofereceu esta versão; não insiste
    updateOffered = feed.version;
    const c = await uiDialog({
      type: 'question',
      title: 'Atualização disponível',
      message: `Nova versão do Mefislink: ${feed.version}`,
      detail: (feed.notes ? `Novidades:\n${feed.notes}\n\n` : '') + `Versão instalada: ${APP_VERSION}. O Mefislink reinicia ao final; logins e configurações são mantidos.`,
      buttons: ['Atualizar agora', 'Depois'],
      defaultId: 0,
      cancelId: 1,
    });
    if (c.response !== 0) return;
    // baixa o pacote, confere a assinatura e instala
    const url = new URL(feed.file, UPDATE_FEED_URL).href;
    const pr = await withTimeout(ses.fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' }), 60000);
    if (!pr.ok) throw new Error('não consegui baixar o pacote (' + pr.status + ')');
    const tmp = path.join(app.getPath('temp'), `mefislink-${feed.version}.mlk`);
    fs.writeFileSync(tmp, Buffer.from(await pr.arrayBuffer()));
    let up;
    try { up = readUpdatePackage(tmp); } finally { try { fs.unlinkSync(tmp); } catch {} }
    if (compareVersions(up.version, APP_VERSION) <= 0) throw new Error('o pacote baixado não é mais novo que a versão instalada');
    installPackage(up);
  } catch (e) {
    if (manual) showError('Atualizações', 'Não consegui atualizar: ' + e.message);
  } finally {
    updateBusy = false;
  }
}

async function undoUpdate() {
  const c = await uiDialog({
    type: 'question',
    title: 'Desfazer atualização',
    message: 'Voltar para a versão anterior?',
    detail: 'O Mefislink reinicia ao final.',
    buttons: ['Voltar versão', 'Cancelar'],
    defaultId: 0,
    cancelId: 1,
  });
  if (c.response !== 0) return;
  let n = 0;
  try {
    for (const name of UPDATABLE) {
      const dest = path.join(__dirname, name);
      if (fs.existsSync(dest + '.bak')) { fs.copyFileSync(dest + '.bak', dest); n++; }
    }
  } catch (e) {
    showError('Falha ao restaurar', e.message);
    return;
  }
  if (!n) { showError('Desfazer', 'Não há versão anterior guardada.'); return; }
  restartApp();
}

// ---------- Auto Compra (Removida no Mefislink a pedido do usuário) ----------
const autoStatus = ACCOUNTS.map(() => '');
const auto = { enabled: ACCOUNTS.map(() => false), dry: false, status: autoStatus };
function loadAuto() {}
function saveAuto() {}
function startAutoBuyTimer() {}
let cfgPanelSeq = 0;
const cfgPanels = new Set();
ipcMain.on('auto-set', () => {});
ipcMain.on('auto-config', () => {});
ipcMain.on('auto-run-now', () => {});
ipcMain.on('auto-log', () => {});
ipcMain.on('title-autocfg-closed', (_, id) => {
  if (id != null) cfgPanels.delete(id);
  else cfgPanels.clear();
  dialogOpen = dlgWait.size > 0 || popWait.size > 0 || cfgPanels.size > 0;
  layout();
});
ipcMain.handle('autocfg-get', () => ({ dry: false, rules: [] }));
ipcMain.handle('autocfg-save', () => ({ ok: true }));
ipcMain.on('close-self', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && !w.isDestroyed()) w.close();
});

// ---------- Diagnóstico (mapa da tela, para eu poder criar leitura/compra) ----------
const OUTLINE_JS = `(() => {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'SVG', 'PATH', 'NOSCRIPT', 'LINK', 'META']);
  const ATTRS = ['id', 'role', 'data-id', 'data-action', 'data-item', 'data-type', 'title', 'aria-label', 'alt', 'type'];
  const out = [];
  const walk = (el, d) => {
    if (d > 16 || out.length > 8000 || SKIP.has(el.tagName.toUpperCase())) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ').slice(0, 90);
    const cls = (typeof el.className === 'string' ? el.className : '').trim().replace(/\\s+/g, '.').slice(0, 70);
    const at = ATTRS.map((a) => (el.getAttribute(a) ? a + '="' + el.getAttribute(a).slice(0, 40) + '"' : '')).filter(Boolean).join(' ');
    out.push('  '.repeat(d) + el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (at ? ' ' + at : '') + (own ? ' "' + own + '"' : ''));
    for (const c of el.children) walk(c, d + 1);
  };
  walk(document.body, 0);
  return out.join('\\n');
})()`;

async function saveOutline(i) {
  try {
    const txt = await views[i].webContents.executeJavaScript(OUTLINE_JS);
    const file = path.join(app.getPath('desktop'), `diagnostico-conta${i + 1}.txt`);
    fs.writeFileSync(file, txt, 'utf8');
    uiDialog({
      type: 'info',
      message: 'Diagnóstico salvo na área de trabalho.',
      detail: `${path.basename(file)}\n\nO arquivo tem só a estrutura e os textos visíveis da tela (sem senhas nem valores digitados). Pode abrir e conferir antes de me enviar.`,
    });
  } catch (e) {
    showError('Diagnóstico', e.message);
  }
}

// ---------- Nick das contas (lido do próprio jogo: #tr-nick) ----------
const nicks = ACCOUNTS.map(() => null);
const nickMiss = ACCOUNTS.map(() => 0);
const nickFile = () => path.join(app.getPath('userData'), 'nicks.json');
const nameOf = (i) => nicks[i] || ACCOUNTS[i];
const displayNames = () => ACCOUNTS.map((_, i) => nameOf(i));

function loadNicks() { // mostra o último nick conhecido já na abertura
  try {
    const j = JSON.parse(fs.readFileSync(nickFile(), 'utf8'));
    if (Array.isArray(j)) ACCOUNTS.forEach((_, i) => { if (typeof j[i] === 'string' && j[i]) nicks[i] = j[i].slice(0, 24); });
  } catch {}
}
function saveNicks() {
  try { fs.writeFileSync(nickFile(), JSON.stringify(nicks)); } catch {}
}
async function readNick(i) {
  const wc = views[i] && views[i].webContents;
  if (!wc || wc.isDestroyed() || wc.isLoading()) return;
  try {
    const t = await wc.executeJavaScript("(() => { const e = document.getElementById('tr-nick'); return e ? e.textContent.trim() : ''; })()");
    const nick = String(t || '').slice(0, 24);
    let changed = false;
    if (nick) {
      nickMiss[i] = 0;
      if (nicks[i] !== nick) { nicks[i] = nick; changed = true; }
    } else if (++nickMiss[i] >= 3 && nicks[i]) { // tela de login por um tempo: volta para "Conta N"
      nicks[i] = null; changed = true;
    }
    if (changed) { saveNicks(); buildMenu(); sendState(); }
  } catch {}
}
function startNickTimer() {
  setInterval(() => ACCOUNTS.forEach((_, i) => readNick(i)), 8000);
  setTimeout(() => ACCOUNTS.forEach((_, i) => readNick(i)), 4000);
}

function buildMenu() {
  const each = (fn) => ACCOUNTS.map((_, i) => fn(i));

  const template = [
    {
      label: 'Telas',
      submenu: [
        // ampliar/grade ficam nos botões de cada conta; aqui só os atalhos (Ctrl+0..4), escondidos
        { label: 'Ver as 4 contas', accelerator: 'CmdOrCtrl+0', visible: false, click: () => setFocus(-1) },
        ...each((i) => ({ label: `Ampliar ${nameOf(i)}`, accelerator: `CmdOrCtrl+${i + 1}`, visible: false, click: () => setFocus(i) })),
        { label: 'Aumentar o jogo', accelerator: 'CmdOrCtrl+=', click: () => changeRef(-100) },
        { label: 'Diminuir o jogo', accelerator: 'CmdOrCtrl+-', click: () => changeRef(100) },
        { label: 'Tela cheia', accelerator: 'F11', click: () => win.setFullScreen(!win.isFullScreen()) },
        { type: 'separator' },
        { label: 'Uso de CPU e memória', click: showUsage },
      ],
    },
    {
      // ações em todas as contas de uma vez (cada conta tem os próprios botões na barra dela)
      label: 'Contas',
      submenu: [
        { label: 'Recarregar todas', click: () => views.forEach((_, i) => reloadAccount(i)) },
        { type: 'separator' },
        { label: 'Silenciar todas', click: () => each((i) => setMuted(i, true)) },
        { label: 'Ligar o som de todas', click: () => each((i) => setMuted(i, false)) },
        { type: 'separator' },
        { label: 'Entrar com Google...', submenu: each((i) => ({ label: nameOf(i), click: () => openGoogleLoginWindow(i) })) },
        { label: 'Importar sessão manualmente do navegador...', submenu: each((i) => ({ label: nameOf(i), click: () => importGoogleLogin(i) })) },
        { label: 'Copiar login para o celular (Mefislink Lite)', submenu: each((i) => ({ label: nameOf(i), click: () => copyLoginForPhone(i) })) },
      ],
    },
    {
      label: 'Lives',
      submenu: [
        // ligar/desligar Twitch e Kick e os pontos da Kick ficam nos botões de cada conta
        { label: 'Ver lives abertas (todas as contas)', click: showLives },
        { label: 'Verificar agora', click: () => { checkLives(); } },
        { type: 'separator' },
        {
          label: 'Kick leve (sem imagens, vídeo mínimo)',
          type: 'checkbox',
          checked: kickLeve,
          click: (item) => setKickLeve(item.checked),
        },
        {
          label: 'Modo das lives da Twitch',
          submenu: [
            { label: 'Conexão direta de chat — levíssimo (experimental)', type: 'radio', checked: twitchModo === 'irc', click: () => setTwitchModo('irc') },
            { label: 'Só o chat — mais leve (recomendado)', type: 'radio', checked: twitchModo === 'chat', click: () => setTwitchModo('chat') },
            { label: 'Só o vídeo — médio', type: 'radio', checked: twitchModo === 'player', click: () => setTwitchModo('player') },
            { label: 'Página completa (vídeo + chat) — mais pesado', type: 'radio', checked: twitchModo === 'completo', click: () => setTwitchModo('completo') },
          ],
        },
        { type: 'separator' },
        ...each((i) => ({
          label: `Logins — ${nameOf(i)}`,
          submenu: [
            { label: 'Entrar na Twitch...', click: () => openLiveLogin(i, 'twitch') },
            { label: 'Entrar na Kick...', click: () => openLiveLogin(i, 'kick') },
            { label: 'Importar login da Kick do navegador...', click: () => importKickLogin(i) },
          ],
        })),
      ],
    },
    {
      label: 'PvP',
      submenu: each((i) => ({ label: `Análise de PvP — ${nameOf(i)}`, click: () => openPvp(i) })),
    },
    {
      label: 'Ajuda',
      submenu: [
        { label: 'Extensões (/hunt, Rotom Sniper)', click: showExtensions },
        { label: 'Gerar relatório do PvP (tracker)', submenu: each((i) => ({ label: nameOf(i), click: () => captureTracker(i) })) },
        { type: 'separator' },
        { label: 'Sobre o Mefislink', click: showAbout },
        { label: 'Termos de Uso', click: showTerms },
        { label: 'Gerar relatório de erro', submenu: each((i) => ({ label: nameOf(i), click: () => saveOutline(i) })) },
        { type: 'separator' },
        { label: 'Reiniciar o Mefislink', accelerator: 'CmdOrCtrl+Shift+R', click: restartApp },
        { label: 'Encerrar o Mefislink', accelerator: 'CmdOrCtrl+Q', click: () => { isQuitting = true; app.quit(); } },
      ],
    },
  ];
  if (DEV) {
    // só aparece rodando pelo código, nunca no .exe
    template.push({
      label: 'Desenvolvedor',
      submenu: [
        { label: 'Abrir pasta do app', click: () => shell.openPath(__dirname) },
        { label: 'Ferramentas de desenvolvedor: F12 na tela desejada', enabled: false },
      ],
    });
  }

  appMenu = Menu.buildFromTemplate(template);
  // o menu continua registrado: atalhos (Ctrl+1, F11, Ctrl+0...) seguem funcionando
  Menu.setApplicationMenu(appMenu);
  sendTitleState();
}

async function showAbout() {
  const r = await uiDialog({
    about: true, // cabeçalho com o ícone, o nome e a versão
    title: 'Sobre o Mefislink',
    message: 'Plataforma Mefislink.',
    detail:
      'O Mefislink foi desenvolvido para melhorar a qualidade de vida de quem joga com 4 contas no mesmo computador, ' +
      'reunindo todas em uma única janela.\n\n' +
      'O Mefislink é uma plataforma independente. Mefis é o desenvolvedor do Mefislink, não do PokeIdle, ' +
      'e não tem vínculo com a equipe do jogo. Se preferir jogar sem a plataforma, use o site oficial: www.pokeidle.io',
    note: 'O uso de mais de 4 contas está sujeito a banimento no jogo. O Mefislink foi feito para no máximo 4 contas.',
    foot: 'Versão beta: se algo der errado, use Ajuda > Gerar relatório de erro.',
    buttons: ['Fechar', 'Direitos e marcas', 'Abrir www.pokeidle.io'],
    defaultId: 0,
    cancelId: 0,
  });
  if (r.response === 1) showRights();
  if (r.response === 2) shell.openExternal('https://www.pokeidle.io');
}

async function showRights() {
  const contato = SUPPORT_CONTACT
    ? '\n\nPedido de remoção: se você é titular de direitos sobre algo presente no Mefislink e quer que seja removido, ' +
      `escreva para ${SUPPORT_CONTACT}. Pedidos legítimos são atendidos sem necessidade de ordem judicial.`
    : '';
  const r = await uiDialog({
    type: 'info',
    title: 'Direitos e marcas',
    message: 'Projeto de fã, independente e não oficial.',
    detail:
      'Pokémon e todos os elementos da franquia são marcas e obras de Nintendo, Game Freak, Creatures e ' +
      'The Pokémon Company. O PokeIdle e seu conteúdo pertencem à equipe do PokeIdle.\n\n' +
      'O Mefislink não tem vínculo com nenhum deles. O jogo exibido nas janelas é carregado diretamente de ' +
      'www.pokeidle.io: o Mefislink não copia, hospeda nem distribui esse conteúdo.\n\n' +
      'O código e a interface do Mefislink são de autoria de Mefis.' + contato,
    note: 'O uso de extensões ou automações pode não ser permitido pelas regras do PokeIdle. ' +
      'Confira os termos do jogo antes de usar. O uso é por sua conta e risco.',
    buttons: ['Voltar', 'Fechar'],
    defaultId: 0,
    cancelId: 1,
  });
  if (r.response === 0) showAbout();
}
ipcMain.on('show-about', showAbout);

// ---------- Pop-ups no tema do app ----------
// Mesmo formato do dialog.showMessageBox do Electron: uiDialog({ type, title, message, detail, buttons, defaultId, cancelId })
// devolve uma Promise com { response } = índice do botão clicado.
const dlgWait = new Map();
let dlgSeq = 0;
let dialogOpen = false;
function uiDialog(o) {
  o = o || {};
  const canDraw = titleBar && !titleBar.webContents.isDestroyed() && !titleBar.webContents.isLoading()
    && win && !win.isDestroyed() && !win.isFullScreen() && !win.isMinimized();
  if (!canDraw) return dialog.showMessageBox(o); // tela cheia/minimizado: usa o do Windows
  const id = ++dlgSeq;
  const pr = new Promise((resolve) => {
    dlgWait.set(id, resolve);
    dialogOpen = true;
    layout();
    titleBar.webContents.focus();
    titleBar.webContents.send('title-dialog', {
      id,
      type: o.type || 'info',
      title: o.title || APP_NAME,
      message: o.message || '',
      detail: o.detail || '',
      note: o.note || '',  // aviso destacado (só nos pop-ups do app)
      foot: o.foot || '',  // texto pequeno no fim
      table: o.table || null, // { head: [...], rows: [[...], ...] }
      form: o.form || null,
      cards: o.cards || null, // [{ title, chips, big, bigSub, stats: [[rótulo, valor]] }]
      lives: o.lives || null, // painel das lives (showLives)   // [{ section } | { id, label, hint, type: 'check'|'number'|'select', options, value }]
      buttons: o.buttons && o.buttons.length ? o.buttons : ['OK'],
      defaultId: Number.isInteger(o.defaultId) ? o.defaultId : 0,
      cancelId: Number.isInteger(o.cancelId) ? o.cancelId : null,
      about: o.about ? { name: APP_NAME, version: APP_VERSION, channel: APP_CHANNEL, icon: customIconUrl() } : null,
    });
  });
  pr.id = id; // permite fechar este pop-up pelo código (uiDialogClose)
  return pr;
}
// fecha um pop-up aberto pelo código (ex.: o aviso de "gerando..." quando o trabalho termina)
function uiDialogClose(p) {
  if (p && p.id && titleBar && !titleBar.webContents.isDestroyed()) titleBar.webContents.send('title-dialog-close', p.id);
}
const showError = (title, text) => uiDialog({ type: 'error', title, message: title, detail: text });

// menuzinho de escolha no tema do app (ex.: Desempenho). Devolve o "value" escolhido ou null.
let popSeq = 0;
const popWait = new Map();
function uiPopup(o) {
  return new Promise((resolve) => {
    const id = ++popSeq;
    popWait.set(id, resolve);
    dialogOpen = true; // a barra de título cresce para cobrir a janela
    layout();
    titleBar.webContents.focus();
    titleBar.webContents.send('title-popup', Object.assign({ id }, o));
  });
}
ipcMain.on('title-popup-reply', (_, id, value) => {
  const done = popWait.get(id);
  if (!done) return;
  popWait.delete(id);
  dialogOpen = dlgWait.size > 0 || popWait.size > 0 || cfgPanels.size > 0;
  layout();
  done(value == null ? null : value);
});
ipcMain.on('title-dialog-reply', (_, id, response, values) => {
  const done = dlgWait.get(id);
  if (!done) return;
  dlgWait.delete(id);
  dialogOpen = dlgWait.size > 0 || popWait.size > 0 || cfgPanels.size > 0;
  layout();
  done({ response: Number(response) || 0, values: values && typeof values === 'object' ? values : null });
});

// F12 ou Ctrl+Shift+I abre as ferramentas de desenvolvedor da tela em que você clicou por último
// Ctrl+0 (as 4 contas) e Ctrl+1..4 (ampliar conta) funcionam em qualquer parte da janela
function viewKeys(wc) {
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.shift || input.alt) return;
    const k = String(input.key);
    if (k === '0') { e.preventDefault(); setFocus(-1); }
    else if (/^[1-4]$/.test(k) && Number(k) <= ACCOUNTS.length) { e.preventDefault(); setFocus(Number(k) - 1); }
  });
}
function devKeys(wc) {
  viewKeys(wc);
  if (!DEV) return; // no .exe não existe atalho para as ferramentas de desenvolvedor
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = String(input.key).toLowerCase();
    if (k === 'f12' || (input.control && input.shift && k === 'i')) {
      e.preventDefault();
      wc.toggleDevTools();
    }
  });
}

// ---------- Barra de título customizada ----------
function sendTitleState() {
  if (!titleBar || titleBar.webContents.isDestroyed() || !appMenu) return;
  titleBar.webContents.send('title-state', {
    title: APP_NAME,
    icon: customIconUrl(),
    version: APP_VERSION,
    channel: APP_CHANNEL,
    menus: serializeMenu(appMenu),
  });
}

// transforma o Menu do Electron em dados simples para a barra desenhar os menus em HTML
const prettyAccel = (a) => (a ? String(a).replace(/CmdOrCtrl|CommandOrControl/g, 'Ctrl') : '');
function serializeMenu(menu) {
  return menu.items.map((it) => ({
    label: it.label,
    type: it.type,
    checked: !!it.checked,
    enabled: it.enabled !== false,
    visible: it.visible !== false,
    accel: prettyAccel(it.accelerator),
    submenu: it.submenu ? serializeMenu(it.submenu) : null,
  }));
}

ipcMain.on('title-ready', sendTitleState);
ipcMain.on('title-open', (_, open) => {
  menuOpen = !!open;
  layout();
});
// clique num item: chega o "caminho" de índices até ele (ex.: [1, 4, 2] = Contas > Som por conta > 3º item)
ipcMain.on('title-click', (_, pathIdx) => {
  if (!appMenu || !Array.isArray(pathIdx)) return;
  let items = appMenu.items;
  let item = null;
  for (const n of pathIdx) {
    item = items && items[n];
    if (!item) return;
    items = item.submenu && item.submenu.items;
  }
  if (!item || item.submenu || item.enabled === false || item.type === 'separator') return;
  item.click({}); // checkbox: o próprio Electron inverte o "checked" antes de chamar o click
  sendTitleState(); // atualiza os ✓ na barra
});

// ---------- Lives: bônus da Twitch e pontos da Kick ----------
// Cada conta do jogo usa o próprio login da Twitch/Kick (mesma sessão da conta: persist:contaN).
// Twitch e Kick ligam separadas, cada uma com o seu botão na barra da conta.
// Quando um canal oficial entra ao vivo, a live abre escondida com a GUIA mutada (o player segue
// tocando, como uma janela visível) e sem economia de segundo plano; quando a live acaba, ela fecha.
const LIVE_CHANNELS = {
  twitch: ['tftoddy', 'clovaobengala', 'patopapao', 'rodil', 'matta', 'cogu', 'biscoitao', 'xdaren_', 'luccatv', 'faasii', 'axtlol', 'surskity11', 'guaxilol1', 'faturetosl', 'fatureto'],
  // lista oficial completa da Kick (painel "Bônus na Kick" do jogo)
  kick: ['rodil', 'clovaobengalalol', 'axt', 'xdaren', 'yetz', 'patopapao2', 'biscoitao', 'matta', 'cogu', 'tftoddy', 'luccatv', 'surskity', 'faturetosl', 'fatureto', 'guaxilol1', 'guaxi'],
};
// Máximo de lives abertas POR CONTA em cada plataforma (cada live gasta ~200-300 MB).
// Kick: abre todas as lives oficiais ao vivo (até 6 por conta). A janela de Resgate marca
// "sem render" quando uma live aberta há 20+ min não ganhou nenhum ponto (ex.: limite da Kick).
const LIVE_MAX = { twitch: 99, kick: 6 };
const LIVE_PLATS = () => Object.keys(LIVE_CHANNELS).filter((p) => LIVE_MAX[p] > 0 && lives[p].some(Boolean));
const LIVE_CHECK_MIN = 3; // de quantos em quantos minutos verificar quem está ao vivo
const PLAT = {
  // Twitch em 3 modos (Lives > Modo da Twitch): página completa, só o player (vídeo) ou só o chat
  twitch: {
    name: 'Twitch', login: 'https://www.twitch.tv/login',
    url: (c) => (twitchModo === 'chat' ? `https://www.twitch.tv/popout/${c}/chat?popout=`
      : twitchModo === 'player' ? `https://player.twitch.tv/?channel=${c}&parent=twitch.tv&muted=false&quality=160p30`
        : `https://www.twitch.tv/${c}`),
  },
  kick: { name: 'Kick', url: (c) => `https://kick.com/${c}`, login: 'https://kick.com/' },
};
// Identificação de navegador igual à de um Chrome normal, com a MESMA versão do Chromium que roda por dentro.
// Antes era um "Chrome 124" fixo enquanto o motor era outra versão: essa diferença faz sites com proteção
// anti-robô (como a Kick) recusarem o login com "Muitas tentativas".
const LIVE_UA = CLEAN_UA;

// ----- canais novos: aprendidos quando o painel de bônus do jogo está aberto -----
const learnedFile = () => path.join(app.getPath('userData'), 'lives-canais.json');
function loadLearnedChannels() {
  try {
    const j = JSON.parse(fs.readFileSync(learnedFile(), 'utf8'));
    for (const p of Object.keys(LIVE_CHANNELS)) {
      (j[p] || []).forEach((c) => { if (!LIVE_CHANNELS[p].includes(c)) LIVE_CHANNELS[p].push(c); });
    }
  } catch {}
}
// lê a lista "CANAIS OFICIAIS" (Twitch) e "CANAIS OFICIAIS NA KICK" do painel aberto no jogo
const LIVE_DISCOVER = `(() => {
  const read = (headRe) => {
    const head = [...document.querySelectorAll('div,span,p,h1,h2,h3,h4,b,strong')]
      .find((e) => headRe.test((e.textContent || '').trim()) && e.getClientRects().length);
    if (!head) return [];
    let box = head.parentElement;
    for (let k = 0; k < 4 && box && !/AO VIVO|OFFLINE/i.test(box.innerText || ''); k++) box = box.parentElement;
    if (!box) return [];
    const skip = /^(OFFLINE|AO VIVO|COPIAR|CANAIS)$/i;
    const out = [];
    for (const e of box.querySelectorAll('*')) {
      if (e.children.length) continue;
      const t = (e.textContent || '').trim();
      if (!/^[A-Za-z0-9_]{2,25}$/.test(t) || !/[A-Za-z]/.test(t) || skip.test(t)) continue;
      let row = e.parentElement;
      for (let k = 0; k < 3 && row && !/AO VIVO|OFFLINE/i.test(row.textContent || ''); k++) row = row.parentElement;
      if (!(row && row !== box && /AO VIVO|OFFLINE/i.test(row.textContent || ''))) continue;
      // o nome mostrado pode ser diferente do endereço do canal: usa o link, se a linha tiver um
      const a = row.querySelector('a[href*="kick.com/"], a[href*="twitch.tv/"]') || row.closest('a[href]');
      const m = a ? String(a.href).match(/(?:kick\\.com|twitch\\.tv)\\/([A-Za-z0-9_-]+)/i) : null;
      out.push({ name: t, slug: (m ? m[1] : t).toLowerCase(), live: /AO VIVO/i.test(row.textContent || '') });
    }
    return out;
  };
  return { twitch: read(/^CANAIS OFICIAIS$/i), kick: read(/^CANAIS OFICIAIS NA KICK$/i) };
})()`;
// "ao vivo" segundo o painel do jogo (quando ele estiver aberto): ajuda quando a Kick/Twitch não responde
const gameLive = { twitch: new Map(), kick: new Map() }; // slug -> horário em que o jogo mostrou AO VIVO
async function discoverChannels() {
  const found = await Promise.all(views.map((v) => (v && !v.webContents.isDestroyed()
    ? withTimeout(v.webContents.executeJavaScript(LIVE_DISCOVER), 3000).catch(() => ({})) : {})));
  let j = null;
  for (const p of Object.keys(LIVE_CHANNELS)) {
    const rows = found.flatMap((f) => (f && f[p]) || []).map((r) => (typeof r === 'string' ? { slug: r.toLowerCase(), live: false } : r));
    for (const r of rows) if (r.live) gameLive[p].set(r.slug, Date.now()); else gameLive[p].delete(r.slug);
    const novos = [...new Set(rows.map((r) => r.slug))]
      .filter((c) => !LIVE_CHANNELS[p].includes(c));
    if (!novos.length) continue;
    LIVE_CHANNELS[p].push(...novos);
    if (!j) { try { j = JSON.parse(fs.readFileSync(learnedFile(), 'utf8')); } catch { j = {}; } }
    j[p] = [...new Set([...(j[p] || []), ...novos])];
  }
  if (j) { try { fs.writeFileSync(learnedFile(), JSON.stringify(j)); } catch {} }
  return !!j;
}

// junta canais novos (de qualquer fonte) na lista e guarda
function addChannels(novos) {
  let mudou = false;
  let j = null;
  for (const p of Object.keys(LIVE_CHANNELS)) {
    const add = [...(novos[p] || [])].map((c) => String(c).toLowerCase()).filter((c) => /^[a-z0-9_]{2,25}$/.test(c) && !LIVE_CHANNELS[p].includes(c));
    if (!add.length) continue;
    LIVE_CHANNELS[p].push(...add);
    if (!j) { try { j = JSON.parse(fs.readFileSync(learnedFile(), 'utf8')); } catch { j = {}; } }
    j[p] = [...new Set([...(j[p] || []), ...add])];
    mudou = true;
  }
  if (j) { try { fs.writeFileSync(learnedFile(), JSON.stringify(j)); } catch {} }
  return mudou;
}

// Aprende canais pelas respostas que o próprio jogo recebe do servidor (lista de parceiros),
// sem depender do painel "Bônus Twitch/Kick" estar aberto.
// Procura, no JSON, listas onde a maioria dos nomes já é de canais conhecidos e pega os outros nomes da mesma lista.
function learnFromJson(json) {
  const out = { twitch: new Set(), kick: new Set() };
  const so = (p) => { const outro = p === 'twitch' ? 'kick' : 'twitch'; return LIVE_CHANNELS[p].filter((c) => !LIVE_CHANNELS[outro].includes(c)); };
  const exclusivos = { twitch: so('twitch'), kick: so('kick') };
  const walk = (o, d) => {
    if (!o || typeof o !== 'object' || d > 7) return;
    if (Array.isArray(o)) {
      const objs = o.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
      const strs = o.filter((x) => typeof x === 'string');
      const listas = [];
      if (strs.length >= 2) listas.push({ vals: strs, objs: null });
      if (objs.length >= 2) {
        for (const key of Object.keys(objs[0])) {
          const vals = objs.map((x) => x[key]);
          if (vals.filter((v) => typeof v === 'string' && /^[A-Za-z0-9_]{2,25}$/.test(v)).length >= objs.length * 0.8) listas.push({ vals, objs });
        }
      }
      for (const { vals, objs: os } of listas) {
        const low = vals.map((v) => (typeof v === 'string' ? v.toLowerCase() : ''));
        const conhecidos = low.filter((v) => LIVE_CHANNELS.twitch.includes(v) || LIVE_CHANNELS.kick.includes(v)).length;
        if (conhecidos < 2) continue;
        low.forEach((v, k) => {
          if (!/^[a-z0-9_]{2,25}$/.test(v)) return;
          // plataforma: pelo campo do próprio item (ex.: plataforma: "kick"), senão pelos nomes exclusivos da lista
          const item = os ? JSON.stringify(os[k]).toLowerCase() : '';
          let p = /"(?:plataforma|platform|tipo|type|provedor|origem)"\s*:\s*"kick"/.test(item) ? 'kick'
            : /"(?:plataforma|platform|tipo|type|provedor|origem)"\s*:\s*"twitch"/.test(item) ? 'twitch' : null;
          if (!p) {
            const tw = low.filter((x) => exclusivos.twitch.includes(x)).length;
            const kk = low.filter((x) => exclusivos.kick.includes(x)).length;
            p = tw > kk ? 'twitch' : kk > tw ? 'kick' : null;
          }
          if (p) out[p].add(v);
        });
      }
      o.forEach((x) => walk(x, d + 1));
    } else Object.values(o).forEach((v) => walk(v, d + 1));
  };
  walk(json, 0);
  return out;
}
const apiUrls = new Set(); // respostas do jogo que podem ter a lista de parceiros
function watchGameApi(i) {
  const ses = session.fromPartition(`persist:conta${i + 1}`);
  try {
    ses.webRequest.onCompleted({ urls: ['https://pokeidle.io/*', 'https://*.pokeidle.io/*'] }, (d) => {
      if (d.method !== 'GET' || d.statusCode !== 200 || !/xhr|fetch/i.test(d.resourceType || '')) return;
      if (!/twitch|kick|stream|live|parceir|canais|canal|bonus|b%C3%B4nus/i.test(d.url)) return;
      if (apiUrls.size < 30 && !apiUrls.has(d.url)) { apiUrls.add(d.url); setTimeout(learnFromApi, 2000); }
    });
  } catch {}
}
let apiLearning = false;
async function learnFromApi() {
  if (apiLearning || !apiUrls.size) return;
  apiLearning = true;
  try {
    const ses = session.fromPartition('persist:conta1');
    let achou = false;
    for (const u of apiUrls) {
      try {
        const r = await withTimeout(ses.fetch(u, { headers: { Accept: 'application/json' } }), 10000);
        if (!r.ok) continue;
        const j = await r.json().catch(() => null);
        if (j && addChannels(learnFromJson(j))) achou = true;
      } catch {}
    }
    if (achou) checkLives(); // canal novo: já confere se está ao vivo e abre
  } finally { apiLearning = false; }
}

// ----- quais contas estão com Twitch / Kick ligadas -----
const livesFile = () => path.join(app.getPath('userData'), 'lives.json');
// "chat" = só o chat (padrão: testado, conta o bônus e é bem mais leve)
// "player" = só o vídeo · "completo" = página do canal (vídeo + chat)
let twitchModo = 'chat';
function setTwitchModo(m) {
  if (twitchModo === m) return;
  twitchModo = m;
  saveLives();
  buildMenu();
  // fecha tudo da Twitch e reabre no modo novo
  ACCOUNTS.forEach((_, i) => {
    for (const slot of liveOpen[i].twitch.values()) closeLive(slot);
    liveOpen[i].twitch.clear();
    closeIrc(i);
  });
  syncLives();
}

// ---------- Twitch por conexão direta de chat (modo "irc") ----------
// Em vez de abrir uma página de chat por canal (~100+ MB cada), cada conta mantém UMA conexão de chat
// da Twitch, com o próprio login da conta, e entra nos chats dos canais oficiais ao vivo (JOIN).
const ircs = ACCOUNTS.map(() => null); // { view, joined: Set }
const ircState = ACCOUNTS.map(() => '');
function closeIrc(i) {
  const c = ircs[i];
  ircs[i] = null;
  ircState[i] = '';
  try { if (c && c.view && !c.view.webContents.isDestroyed()) c.view.webContents.close(); } catch {}
}
const IRC_JS = (token, nick, chans) => `(() => {
  try { if (window.__irc) window.__irc.close(); } catch (e) {}
  const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  window.__irc = ws; window.__ircState = 'conectando';
  ws.onopen = () => {
    ws.send('CAP REQ :twitch.tv/membership');
    ws.send('PASS oauth:' + ${JSON.stringify(token)});
    ws.send('NICK ' + ${JSON.stringify(nick)});
    for (const c of ${JSON.stringify(chans)}) ws.send('JOIN #' + c);
  };
  ws.onmessage = (e) => {
    for (const l of String(e.data).split('\\r\\n')) {
      if (l.startsWith('PING')) ws.send('PONG' + l.slice(4));
      else if (/ 001 /.test(l)) window.__ircState = 'ok';
      else if (/Login authentication failed|Improperly formatted auth/i.test(l)) window.__ircState = 'erro de login';
    }
  };
  ws.onclose = () => { if (window.__ircState !== 'erro de login') window.__ircState = 'fechado'; };
  return true;
})()`;
let ircBusy = ACCOUNTS.map(() => false);
async function ensureIrc(i, chans) {
  if (ircBusy[i]) return;
  ircBusy[i] = true;
  try {
    if (!chans.length || !lives.twitch[i]) { closeIrc(i); return; }
    const ses = accountSession(i);
    const cookies = await ses.cookies.get({ url: 'https://www.twitch.tv' });
    const tok = (cookies.find((c) => c.name === 'auth-token') || (await ses.cookies.get({ domain: 'twitch.tv', name: 'auth-token' }))[0] || {}).value;
    const nick = (cookies.find((c) => c.name === 'login') || (await ses.cookies.get({ domain: 'twitch.tv', name: 'login' }))[0] || {}).value;
    if (!tok || !nick) { ircState[i] = 'sem login'; return; }
    let c = ircs[i];
    if (!c || c.view.webContents.isDestroyed()) {
      const v = new WebContentsView({ webPreferences: { partition: `persist:conta${i + 1}`, backgroundThrottling: false } });
      await v.webContents.loadURL('about:blank').catch(() => {});
      c = ircs[i] = { view: v, joined: new Set() };
    }
    const wc = c.view.webContents;
    const st = await withTimeout(wc.executeJavaScript('window.__ircState || ""'), 3000).catch(() => '');
    ircState[i] = st;
    if (st !== 'ok' && st !== 'conectando') {
      if (st === 'erro de login') return; // não insiste com login inválido
      await withTimeout(wc.executeJavaScript(IRC_JS(tok, nick.toLowerCase(), chans)), 5000).catch(() => {});
      c.joined = new Set(chans);
      return;
    }
    // entra nos canais novos e sai dos que não estão mais ao vivo
    const cmds = [];
    for (const ch of chans) if (!c.joined.has(ch)) { cmds.push('JOIN #' + ch); c.joined.add(ch); }
    for (const ch of [...c.joined]) if (!chans.includes(ch)) { cmds.push('PART #' + ch); c.joined.delete(ch); }
    if (cmds.length) await withTimeout(wc.executeJavaScript(`(() => { for (const m of ${JSON.stringify(cmds)}) window.__irc.send(m); return true; })()`), 3000).catch(() => {});
  } finally { ircBusy[i] = false; }
}
const lives = { twitch: ACCOUNTS.map(() => false), kick: ACCOUNTS.map(() => false) };
// canais da Kick escolhidos para farmar em cada conta (vazio = automático)
const kickSel = ACCOUNTS.map(() => []);
function loadLives() {
  try {
    const j = JSON.parse(fs.readFileSync(livesFile(), 'utf8'));
    const tw = Array.isArray(j.twitch) ? j.twitch : Array.isArray(j.on) ? j.on : []; // "on" = versão antiga (só Twitch)
    tw.forEach((v, i) => { if (i < ACCOUNTS.length) lives.twitch[i] = !!v; });
    (Array.isArray(j.kick) ? j.kick : []).forEach((v, i) => { if (i < ACCOUNTS.length) lives.kick[i] = !!v; });
    (Array.isArray(j.kickSel) ? j.kickSel : []).forEach((v, i) => { if (i < ACCOUNTS.length && Array.isArray(v)) kickSel[i] = v.map(String); });
    if (['completo', 'player', 'chat', 'irc'].includes(j.twitchModo)) twitchModo = j.twitchModo;
    if (typeof j.kickLeve === 'boolean') kickLeve = j.kickLeve;
  } catch {}
}
const saveLives = () => { try { fs.writeFileSync(livesFile(), JSON.stringify({ twitch: lives.twitch, kick: lives.kick, kickSel, twitchModo, kickLeve })); } catch {} };

const liveNow = { twitch: new Set(), kick: new Set() };                        // canais ao vivo agora
const liveOpen = ACCOUNTS.map(() => ({ twitch: new Map(), kick: new Map() })); // canal -> live escondida
let liveChecking = false;
let liveLastCheck = 0;
let liveErrors = 0;

const checkSession = () => session.fromPartition('persist:lives-check');
const accountSession = (i) => session.fromPartition(`persist:conta${i + 1}`);
async function isLive(plat, c) {
  if (plat === 'twitch') {
    const r = await withTimeout(checkSession().fetch(`https://www.twitch.tv/${c}`, { headers: { 'User-Agent': LIVE_UA } }), 15000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return /"isLiveBroadcast"\s*:\s*true/.test(await r.text());
  }
  // Kick: tenta pela sessão de uma conta logada (passa pela proteção anti-robô da Kick) e depois pela sessão neutra
  const sess = [...ACCOUNTS.map((_, i) => i).filter((i) => lives.kick[i]).map(accountSession), checkSession()];
  let lastErr = null;
  for (const ses of sess) {
    try {
      const r = await withTimeout(ses.fetch(`https://kick.com/api/v2/channels/${c}`, {
        headers: { 'User-Agent': LIVE_UA, Accept: 'application/json' },
      }), 15000);
      if (!r.ok) { lastErr = new Error('HTTP ' + r.status); continue; }
      const j = await r.json();
      return !!(j && j.livestream && j.livestream.is_live !== false);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('sem resposta');
}

async function twitchLogged(i) {
  try {
    const ses = accountSession(i);
    const c1 = await ses.cookies.get({ url: 'https://www.twitch.tv', name: 'auth-token' });
    if (c1 && c1.length > 0) return true;
    const c2 = await ses.cookies.get({ domain: 'twitch.tv', name: 'auth-token' });
    if (c2 && c2.length > 0) return true;
    return false;
  } catch { return false; }
}
async function kickLogged(i) {
  const ses = accountSession(i);
  try {
    const r = await withTimeout(ses.fetch('https://kick.com/api/v1/user', { headers: { 'User-Agent': LIVE_UA, Accept: 'application/json' } }), 10000);
    if (r.ok) { const j = await r.json().catch(() => null); if (j && (j.username || j.id)) return true; }
    if (r.status === 401) return false;
  } catch {}
  // a Kick não respondeu direito: usa o cookie de sessão como referência
  try { return (await ses.cookies.get({ domain: 'kick.com' })).some((c) => /session_token/i.test(c.name)); }
  catch { return false; }
}
const isLogged = (i, plat) => (plat === 'twitch' ? twitchLogged(i) : kickLogged(i));

const TWITCH_GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

async function checkTwitchLiveChannels(channels) {
  if (!channels || !channels.length) return new Set();
  const chunkSize = 10;
  const chunks = [];
  for (let i = 0; i < channels.length; i += chunkSize) {
    chunks.push(channels.slice(i, i + chunkSize));
  }

  const liveSet = new Set();
  let succeeded = false;

  await Promise.all(chunks.map(async (chunk) => {
    const fields = chunk.map((c, idx) => `c${idx}: user(login: "${c}") { login stream { id type title game { name } } }`).join('\n');
    const query = `query {\n${fields}\n}`;

    try {
      const r = await withTimeout(fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: {
          'Client-Id': TWITCH_GQL_CLIENT_ID,
          'Content-Type': 'application/json',
          'User-Agent': LIVE_UA,
        },
        body: JSON.stringify({ query }),
      }), 10000);

      if (!r.ok) return;
      const json = await r.json();
      const data = (json && json.data) || {};
      succeeded = true;

      for (const key of Object.keys(data)) {
        const u = data[key];
        if (!u || !u.stream) continue;
        const s = u.stream;
        if (s.type === 'live') {
          liveSet.add(u.login.toLowerCase());
        }
      }
    } catch {}
  }));

  return succeeded ? liveSet : null;
}

async function checkLives() {
  if (liveChecking) return;
  liveChecking = true;
  let errs = 0;
  try {
    // 1) Twitch: consulta rápida e garantida via GraphQL em lotes de até 10 canais
    try {
      const twSet = await checkTwitchLiveChannels(LIVE_CHANNELS.twitch);
      if (twSet != null) {
        liveNow.twitch.clear();
        for (const c of twSet) liveNow.twitch.add(c);
      }
    } catch { errs++; }

    // 2) Kick: verifica quem está online na Kick
    try {
      await discoverChannels();
      await Promise.all(LIVE_CHANNELS.kick.map(async (c) => {
        try { (await isLive('kick', c)) ? liveNow.kick.add(c) : liveNow.kick.delete(c); }
        catch {
          errs++;
          const t = gameLive.kick.get(c);
          if (t && Date.now() - t < 15 * 60 * 1000) liveNow.kick.add(c);
        }
      }));
    } catch { errs++; }
  } finally {
    liveChecking = false;
    liveErrors = errs;
    liveLastCheck = Date.now();
  }
  syncLives();
}

function openLive(i, plat, c) {
  const v = new WebContentsView({ webPreferences: { partition: `persist:conta${i + 1}`, backgroundThrottling: false } });
  const wc = v.webContents;
  wc.setAudioMuted(true); // igual a "mutar guia": ninguém ouve, mas o player segue tocando normalmente
  if (plat === 'kick') {
    // modo leve da Kick: menos coisas carregando e desenhando na página da live
    kickViewIds.add(wc.id);
    wc.once('destroyed', () => kickViewIds.delete(wc.id));
    wc.on('dom-ready', () => { if (kickLeve) wc.insertCSS(KICK_LEVE_CSS).catch(() => {}); });
  }
  if (win && !win.isDestroyed()) {
    // As lives da Kick e Twitch rodam DENTRO da janela, por baixo de uma "capa" escura e das contas do jogo.
    // Ninguém vê, mas para as plataformas elas estão abertas e ativas na tela, garantindo que o chat e os pontos funcionem.
    try {
      ensureLiveCover();
      win.contentView.addChildView(v, 0); // fica por baixo da capa
      v.setBounds({ x: 0, y: TITLE_H, width: 1024, height: 576 });
      slotAttached.add(v);
    } catch {}
  }
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (plat === 'twitch' && twitchModo !== 'chat') {
    // menor qualidade possível (160p) para gastar pouco; na 1ª vez recarrega para aplicar
    wc.on('dom-ready', () => {
      wc.executeJavaScript(`(() => { try {
        const before = localStorage.getItem('video-quality');
        localStorage.setItem('video-quality', JSON.stringify({ default: '160p30' }));
        localStorage.setItem('video-muted', JSON.stringify({ default: false }));
        return before;
      } catch (e) { return 'erro'; } })()`).then((before) => {
        if (before === null && !wc.isDestroyed()) wc.reload();
      }).catch(() => {});
    });
  }
  wc.loadURL(PLAT[plat].url(c), { userAgent: LIVE_UA }).catch(() => {});
  return v;
}
// As lives abrem uma de cada vez, para não travar o PC abrindo dezenas de páginas no mesmo segundo.
const LIVE_OPEN_GAP = 1500;
let liveOpenAt = 0;
function scheduleLive(i, plat, c) {
  const now = Date.now();
  liveOpenAt = Math.max(liveOpenAt, now);
  const slot = { view: null, timer: null, openedAt: Date.now() + (liveOpenAt - now), miss: 0 };
  slot.timer = setTimeout(() => { slot.timer = null; slot.view = openLive(i, plat, c); }, liveOpenAt - now);
  liveOpenAt += LIVE_OPEN_GAP;
  return slot;
}
const slotAttached = new Set(); // lives que estão dentro da janela (Kick)
// capa escura por cima das lives da Kick (e por baixo das contas do jogo), para elas nunca aparecerem
let liveCover = null;
function ensureLiveCover() {
  if (liveCover || !win) return;
  liveCover = new View();
  liveCover.setBackgroundColor('#15151a');
  win.contentView.addChildView(liveCover, 0);
  const { width, height } = win.getContentBounds();
  liveCover.setBounds({ x: 0, y: 0, width, height });
}
// ---------- Kick leve ----------
// A Kick só conta pontos com o player tocando numa página visível, então não dá para tirar o vídeo.
// Mas dá para cortar o resto: imagens (miniaturas, avatares, emotes), fontes, rastreadores/anúncios,
// animações, e deixar o vídeo minúsculo (o player tende a escolher a menor qualidade).
let kickLeve = true;
const kickViewIds = new Set();
const KICK_LEVE_CSS = `
  *, *::before, *::after { animation: none !important; transition: none !important; }
  video { width: 192px !important; height: 108px !important; max-width: 192px !important; object-fit: contain; }
  img { visibility: hidden !important; }
`;
const KICK_BLOQUEIO = /doubleclick|googlesyndication|google-analytics|googletagmanager|datadoghq|sentry\.io|amplitude|hotjar|facebook\.net|clarity\.ms|onetrust|cookielaw/i;
function watchKickRequests(i) {
  const ses = session.fromPartition(`persist:conta${i + 1}`);
  try {
    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (d, cb) => {
      if (kickLeve && kickViewIds.has(d.webContentsId) &&
          (d.resourceType === 'image' || d.resourceType === 'font' || KICK_BLOQUEIO.test(d.url))) return cb({ cancel: true });
      cb({});
    });
  } catch {}
}
function setKickLeve(on) {
  kickLeve = !!on;
  saveLives();
  buildMenu();
  // recarrega as lives da Kick para aplicar
  ACCOUNTS.forEach((_, i) => { for (const sl of liveOpen[i].kick.values()) { try { if (sl.view) sl.view.webContents.reload(); } catch {} } });
}

function closeLive(slot) {
  if (slot.timer) clearTimeout(slot.timer);
  const v = slot.view;
  if (v && slotAttached.has(v)) { try { win.contentView.removeChildView(v); } catch {} slotAttached.delete(v); }
  try { if (v && !v.webContents.isDestroyed()) v.webContents.close(); } catch {}
}

// abre/fecha as lives de cada conta conforme quem está ao vivo, o que está ligado e os limites
function syncLives() {
  ACCOUNTS.forEach((_, i) => {
    for (const plat of Object.keys(LIVE_CHANNELS)) {
      const open = liveOpen[i][plat];
      let want = [];
      if (lives[plat][i]) {
        const aoVivo = LIVE_CHANNELS[plat].filter((c) => liveNow[plat].has(c));
        if (plat === 'kick' && kickSel[i].length) {
          // você escolheu os canais: abre só eles (quando estiverem ao vivo)
          want = kickSel[i].filter((c) => liveNow.kick.has(c)).slice(0, LIVE_MAX.kick);
        } else if (plat === 'kick') {
          // mantém as que já estão abertas (reabrir zera o tempo assistido) e completa com os canais
          // que já têm mais pontos: concentrar num canal chega antes nos 300/500/1.000 de cada bônus
          const pts = (c) => (kickPts[i][c] && kickPts[i][c].pts) || 0;
          const ganho = (c) => (kickPts[i][c] && kickPts[i][c].pts != null ? kickPts[i][c].pts - kickPts[i][c].base : 0);
          const abertas = aoVivo.filter((c) => open.has(c)).sort((a, b) => ganho(b) - ganho(a)); // as que estão rendendo primeiro
          const resto = aoVivo.filter((c) => !open.has(c)).sort((a, b) => pts(b) - pts(a));
          want = [...abertas, ...resto].slice(0, LIVE_MAX.kick);
        } else {
          want = aoVivo.slice(0, LIVE_MAX[plat]);
        }
      }
      for (const [c, v] of open) {
        if (want.includes(c)) { v.miss = 0; continue; }
        // Fecha NA HORA quando foi você que tirou (plataforma desligada, canal desativado, fora do limite).
        // Só espera 2 verificações quando o motivo é o canal ter aparecido offline (pode ser falha momentânea
        // da Kick/Twitch, e reabrir zeraria o tempo assistido).
        const tiradoPorVoce = !lives[plat][i] ||
          (plat === 'kick' && kickSel[i].length && !kickSel[i].includes(c)) ||
          !liveNow[plat].has(c);
        v.miss = (v.miss || 0) + 1;
        if (tiradoPorVoce || v.miss >= 2) { closeLive(v); open.delete(c); }
      }
      if (plat === 'twitch' && twitchModo === 'irc') {
        // modo conexão direta: nenhuma página por canal, só uma conexão de chat por conta
        for (const c of want) if (!open.has(c)) open.set(c, { view: null, timer: null, openedAt: Date.now(), miss: 0 });
        ensureIrc(i, [...open.keys()]);
      } else {
        for (const c of want) if (!open.has(c)) open.set(c, scheduleLive(i, plat, c));
      }
    }
  });
  sendState();
  if (titleBar && !titleBar.webContents.isDestroyed()) titleBar.webContents.send('lives-update'); // painel das lives
}

function livesState() {
  return {
    twitch: lives.twitch,
    kick: lives.kick,
    open: liveOpen.map((o) => ({ twitch: [...o.twitch.keys()], kick: [...o.kick.keys()] })),
    checked: liveLastCheck > 0,
  };
}

// liga/desliga Twitch ou Kick de uma conta; só liga se a conta estiver logada naquela plataforma
async function setLivesOn(i, plat, on) {
  if (!PLAT[plat]) return;
  if (on && !(await isLogged(i, plat))) {
    sendState(); buildMenu(); // mantém o botão e o menu desligados
    const nm = PLAT[plat].name;
    const r = await uiDialog({
      type: 'warning',
      title: nm,
      message: `${nameOf(i)} não está conectada na ${nm}.`,
      detail: `Para ${plat === 'twitch' ? 'o bônus' : 'os pontos'} contar${plat === 'twitch' ? '' : 'em'}, as lives precisam abrir com a conta da ${nm} vinculada a esta conta do jogo.\n\n` +
        `Entre na ${nm} e o botão liga sozinho quando você fechar a janela de login.`,
      buttons: plat === 'kick' ? ['Importar login do navegador', `Entrar na ${nm}`, 'Cancelar'] : [`Entrar na ${nm}`, 'Cancelar'],
      defaultId: 0,
      cancelId: plat === 'kick' ? 2 : 1,
    });
    if (plat === 'kick') {
      // o login direto na Kick costuma ser recusado pela proteção anti-robô dela; importar do navegador funciona
      if (r.response === 0) importKickLogin(i);
      if (r.response === 1) openLiveLogin(i, plat, true);
    } else if (r.response === 0) openLiveLogin(i, plat, true);
    return;
  }
  lives[plat][i] = !!on;
  saveLives();
  buildMenu();
  if (on) checkLives(); else syncLives();
  // avisa o painel de pontos da Kick (o liga/desliga também fica lá)
  if (titleBar && !titleBar.webContents.isDestroyed()) titleBar.webContents.send('kick-update');
  if (kickWin && !kickWin.isDestroyed()) kickWin.webContents.send('kick-update');
}
ipcMain.on('lives-set', (_, i, plat, on) => {
  if (!Number.isInteger(i) || i < 0 || i >= ACCOUNTS.length) return;
  if (typeof plat === 'boolean') { on = plat; plat = 'twitch'; } // compatível com a barra antiga
  setLivesOn(i, plat, !!on);
});

// janela para entrar na Twitch/Kick com a sessão daquela conta
function openLiveLogin(i, plat, enableAfter) {
  const w = new BrowserWindow({
    width: 560, height: 780, title: `${PLAT[plat].name} — ${nameOf(i)}`,
    backgroundColor: '#0e1424', autoHideMenuBar: true,
    ...(customIconPath() ? { icon: customIconPath() } : {}),
    webPreferences: { partition: `persist:conta${i + 1}` },
  });
  w.setMenu(null);
  // janelinhas que o login abre (captcha, "entrar com..."): abrem de verdade, na mesma sessão, como num navegador
  w.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { width: 520, height: 700, autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: { partition: `persist:conta${i + 1}` } },
  }));
  w.loadURL(PLAT[plat].login, { userAgent: LIVE_UA });
  // Twitch: quando o login termina, fecha a janela sozinha
  const ses = accountSession(i);
  const onCookie = (_, cookie, cause, removed) => {
    if (plat === 'twitch' && !removed && cookie.name === 'auth-token' && /twitch\.tv$/.test(cookie.domain)) {
      setTimeout(() => { if (!w.isDestroyed()) w.close(); }, 1500);
    }
  };
  ses.cookies.on('changed', onCookie);
  // ao fechar, recarrega as lives abertas dessa conta para já contarem com o login
  w.on('closed', async () => {
    ses.cookies.removeListener('changed', onCookie);
    for (const slot of liveOpen[i][plat].values()) { try { if (slot.view) slot.view.webContents.reload(); } catch {} }
    if (enableAfter) {
      if (await isLogged(i, plat)) setLivesOn(i, plat, true);
      else uiDialog({ type: 'info', title: PLAT[plat].name, message: `O login na ${PLAT[plat].name} não foi concluído.`, detail: 'As lives desta conta continuam desligadas.' });
    }
  });
}

function livesOverview() {
  return {
    contas: ACCOUNTS.map((_, i) => ({
      i, name: nameOf(i),
      plats: Object.keys(LIVE_CHANNELS).map((p) => ({ p, name: PLAT[p].name, on: !!lives[p][i], open: [...liveOpen[i][p].keys()] })),
    })),
    aoVivo: Object.keys(LIVE_CHANNELS).map((p) => ({ p, name: PLAT[p].name, list: [...liveNow[p]] })),
    quando: liveLastCheck ? new Date(liveLastCheck).toLocaleTimeString('pt-BR') : '',
    erros: liveErrors,
  };
}
ipcMain.handle('lives-get', () => livesOverview());
ipcMain.handle('lives-check-now', async () => { await checkLives(); return livesOverview(); });

// painel "Lives" no estilo do painel da Kick (desenhado pela barra de título)
async function showLives() {
  const canDraw = titleBar && !titleBar.webContents.isDestroyed() && win && !win.isFullScreen() && !win.isMinimized();
  if (canDraw) {
    const id = ++cfgPanelSeq;
    cfgPanels.add(id);
    dialogOpen = true;
    layout();
    titleBar.webContents.focus();
    titleBar.webContents.send('title-lives', { id });
    return;
  }
  const o = livesOverview();
  const r = await uiDialog({
    type: 'info',
    title: 'Lives',
    message: 'Lives abertas em segundo plano',
    detail: 'Clique num canal aberto para ver a live com a sua conta.',
    lives: o,
    buttons: ['Fechar', 'Verificar agora'],
    defaultId: 0,
    cancelId: 0,
  });
  if (r.response === 1) { await checkLives(); showLives(); }
}

// abre a live numa janela visível, com a sessão da conta (para conferir os pontos da Kick, por exemplo)
const livePageWins = new Map();
function openLivePage(i, plat, c) {
  if (!PLAT[plat] || !Number.isInteger(i) || i < 0 || i >= ACCOUNTS.length) return;
  const key = `${i}|${plat}|${c}`;
  const old = livePageWins.get(key);
  if (old && !old.isDestroyed()) { old.focus(); return; }
  const w = new BrowserWindow({
    width: 1200, height: 820, title: `${PLAT[plat].name} — ${c} — ${nameOf(i)}`,
    backgroundColor: '#0b0b0e', autoHideMenuBar: true,
    ...(customIconPath() ? { icon: customIconPath() } : {}),
    webPreferences: { partition: `persist:conta${i + 1}` },
  });
  w.setMenu(null);
  w.webContents.setAudioMuted(true); // a live escondida já está tocando; esta só serve para olhar
  w.on('page-title-updated', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  w.loadURL(PLAT[plat].url(c), { userAgent: LIVE_UA });
  w.on('closed', () => livePageWins.delete(key));
  livePageWins.set(key, w);
}
ipcMain.on('live-page-open', (_, i, plat, c) => openLivePage(i, plat, String(c)));

// ---------- Extensões do Chrome dentro do Mefislink ----------
// O Mefislink baixa cada extensão da Chrome Web Store no PC do usuário (não vem dentro do Mefislink),
// guarda em %APPDATA%\Mefislink\extensoes\<id> e carrega nas 4 contas. Atualizam sozinhas.
// Para adicionar outra, basta incluir aqui o id dela (o código no fim do link da Chrome Web Store).
const EXTENSIONS = [
  { id: 'mhnplloljgchpfpcpbhmcokmnefodjnh', nome: '/hunt for PokeIdle', autor: 'Liang',
    sobre: 'Mostra, acima do pokémon em campo, as melhores hunts por XP/h e ouro/h. Clique na barra /hunt dentro do jogo.' },
  { id: 'olccbpdjdkbfgondiiaicmlifhbcggmk', nome: 'Rotom Sniper', autor: '', botao: 'Sniper',
    sobre: 'Cockpit Auto-Sniper: regras de compra no mercado da comunidade, radar de pokémon, estatísticas de farm.' },
];
const extUrl = (id) => 'https://clients2.google.com/service/update2/crx?response=redirect' +
  `&prodversion=${process.versions.chrome}&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;
const extRoot = (id) => path.join(app.getPath('userData'), 'extensoes', id);
const extState = Object.fromEntries(EXTENSIONS.map((e) => [e.id, { version: null, error: null, name: null }]));

// .crx = cabeçalho do Chrome + um .zip
function crxToZip(buf) {
  if (buf.toString('ascii', 0, 4) !== 'Cr24') throw new Error('o arquivo baixado não é uma extensão');
  const v = buf.readUInt32LE(4);
  if (v === 3) return buf.subarray(12 + buf.readUInt32LE(8));
  if (v === 2) return buf.subarray(16 + buf.readUInt32LE(8) + buf.readUInt32LE(12));
  throw new Error('formato de extensão desconhecido');
}
// descompacta um .zip (sem bibliotecas extras)
function unzipTo(zip, dir) {
  const zlib = require('zlib');
  let eocd = -1;
  for (let p = zip.length - 22; p >= Math.max(0, zip.length - 65557); p--) {
    if (zip.readUInt32LE(p) === 0x06054b50) { eocd = p; break; }
  }
  if (eocd < 0) throw new Error('zip inválido');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const base = path.resolve(dir);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('zip inválido');
    const method = zip.readUInt16LE(p + 10);
    const csize = zip.readUInt32LE(p + 20);
    const nlen = zip.readUInt16LE(p + 28), xlen = zip.readUInt16LE(p + 30), clen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    const dest = path.resolve(base, name);
    if (!dest.startsWith(base + path.sep)) continue; // nunca escreve fora da pasta
    if (name.endsWith('/')) { fs.mkdirSync(dest, { recursive: true }); continue; }
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + csize);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, method === 0 ? data : zlib.inflateRawSync(data));
  }
}
function localExt(id) {
  try {
    const vs = fs.readdirSync(extRoot(id)).filter((v) => fs.existsSync(path.join(extRoot(id), v, 'manifest.json')) && /^\d/.test(v));
    vs.sort((a, b) => compareVersions(b, a));
    return vs.length ? { id, version: vs[0], dir: path.join(extRoot(id), vs[0]) } : null;
  } catch { return null; }
}
async function downloadExt(id) {
  const r = await withTimeout(session.fromPartition('persist:lives-check').fetch(extUrl(id)), 30000);
  if (!r.ok) throw new Error('Chrome Web Store respondeu ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  const tmp = path.join(extRoot(id), '_baixando');
  fs.rmSync(tmp, { recursive: true, force: true });
  unzipTo(crxToZip(buf), tmp);
  const version = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8')).version;
  const dir = path.join(extRoot(id), version);
  if (fs.existsSync(path.join(dir, 'manifest.json'))) fs.rmSync(tmp, { recursive: true, force: true });
  else { fs.rmSync(dir, { recursive: true, force: true }); fs.renameSync(tmp, dir); }
  for (const v of fs.readdirSync(extRoot(id))) if (v !== version) fs.rmSync(path.join(extRoot(id), v), { recursive: true, force: true });
  sanitizeExt(dir);
  return { id, version, dir };
}
function sanitizeExt(dir) {
  try {
    const uiJs = path.join(dir, 'src', 'ui.js');
    if (fs.existsSync(uiJs)) {
      let code = fs.readFileSync(uiJs, 'utf8');
      if (code.includes('pih-apoiar') || code.includes('blocoApoio()')) {
        code = code.replace(/<button type="button" class="pih-btn pih-apoiar"[\s\S]*?<\/button>\s*/, '');
        code = code.replace(/\$\{blocoApoio\(\)\}/g, '');
        fs.writeFileSync(uiJs, code, 'utf8');
      }
    }
    const uiCss = path.join(dir, 'src', 'ui.css');
    if (fs.existsSync(uiCss)) {
      let css = fs.readFileSync(uiCss, 'utf8');
      if (!css.includes('.pih-apoiar')) {
        css += '\n.pih-cab .pih-apoiar, #pih-apoio, .pih-apoiar { display: none !important; }\n';
        fs.writeFileSync(uiCss, css, 'utf8');
      }
    }
  } catch {}
}
async function loadExtInto(ext) {
  sanitizeExt(ext.dir);
  const st = extState[ext.id];
  for (let i = 0; i < ACCOUNTS.length; i++) {
    const api = (() => { const ses = session.fromPartition(`persist:conta${i + 1}`); return ses.extensions || ses; })();
    try {
      // tira versões antigas desta mesma extensão (mesma pasta-base)
      for (const e of api.getAllExtensions()) if (e.path !== ext.dir && e.path && e.path.startsWith(extRoot(ext.id))) api.removeExtension(e.id);
      if (!api.getAllExtensions().some((e) => e.path === ext.dir)) {
        const loaded = await api.loadExtension(ext.dir, { allowFileAccess: false });
        if (loaded && loaded.name) st.name = loaded.name;
      }
    } catch (e) { st.error = e.message; }
  }
  st.version = ext.version;
}
// carrega as cópias locais (antes das contas abrirem); devolve quais extensões ainda não tinham cópia
// extensões desligadas pelo usuário (Ajuda > Extensões)
const extCfgFile = () => path.join(app.getPath('userData'), 'extensoes.json');
const extOff = new Set();
try { (JSON.parse(fs.readFileSync(extCfgFile(), 'utf8')).desligadas || []).forEach((id) => extOff.add(id)); } catch {}
const saveExtCfg = () => { try { fs.writeFileSync(extCfgFile(), JSON.stringify({ desligadas: [...extOff] })); } catch {} };
const extBusy = new Map(); // id -> 'atualizando' | 'reinstalando' | ...

async function loadLocalExtensions() {
  const faltando = [];
  for (const e of EXTENSIONS) {
    if (extOff.has(e.id)) continue;
    const loc = localExt(e.id);
    if (loc) await loadExtInto(loc); else faltando.push(e.id);
  }
  return faltando;
}
// em segundo plano: baixa as que faltam (e recarrega as contas) e atualiza as outras para o próximo início
async function updateExtensions(faltando) {
  let novas = false;
  for (const e of EXTENSIONS) {
    if (extOff.has(e.id)) continue;
    try {
      const ext = await downloadExt(e.id);
      extState[e.id].error = null;
      if (faltando.includes(e.id)) { await loadExtInto(ext); novas = true; }
    } catch (err) { extState[e.id].error = err.message; }
  }
  if (novas) views.forEach((_, i) => reloadAccount(i)); // 1ª vez: recarrega para as extensões aparecerem
}
// No Chrome, a extensão abre pelo botão dela na barra do navegador (uma janelinha). O Mefislink não tem essa
// barra, então abre a mesma página da extensão numa janela própria, com a sessão (login) daquela conta.
const extWins = new Map();
function openExtPage(i, id) {
  const def = EXTENSIONS.find((e) => e.id === id);
  if (!def || !Number.isInteger(i) || i < 0 || i >= ACCOUNTS.length) return;
  const key = `${i}|${id}`;
  const old = extWins.get(key);
  if (old && !old.isDestroyed()) { old.show(); old.focus(); return; }
  const ses = session.fromPartition(`persist:conta${i + 1}`);
  const api = ses.extensions || ses;
  const loc = localExt(id);
  const ext = loc && api.getAllExtensions().find((e) => e.path === loc.dir);
  if (!ext) {
    uiDialog({ type: 'warning', title: def.nome, message: `${def.nome} ainda não está instalada.`, detail: 'Ela é baixada sozinha ao abrir o Mefislink. Confira em Ajuda → Extensões.' });
    return;
  }
  const m = ext.manifest || {};
  let page = (m.action && m.action.default_popup) || (m.browser_action && m.browser_action.default_popup) ||
    (m.side_panel && m.side_panel.default_path) || m.options_page || (m.options_ui && m.options_ui.page);
  let grande = false;
  if (!page) {
    // Sem janelinha: no Chrome, o clique no ícone faz a extensão abrir uma página própria (ex.: o "Cockpit").
    // Procura essa página: primeiro as citadas no código de fundo da extensão, depois pelo nome do arquivo.
    try {
      const norm = (f) => String(f).replace(/\\/g, '/').replace(/^\//, '');
      const htmls = fs.readdirSync(loc.dir, { recursive: true }).map(norm).filter((f) => /\.html?$/i.test(f));
      const bg = m.background && (m.background.service_worker || (m.background.scripts || [])[0]);
      let citadas = [];
      if (bg) {
        const code = fs.readFileSync(path.join(loc.dir, bg), 'utf8');
        citadas = [...code.matchAll(/['"`]\/?([\w\-/.]+\.html?)/g)].map((x) => norm(x[1]));
      }
      page = citadas.find((c) => htmls.includes(c)) ||
        htmls.find((f) => /cockpit|dashboard|painel|panel|sniper|app|index|main/i.test(f)) || htmls[0];
      grande = !!page;
    } catch {}
  }
  if (!page) {
    uiDialog({ type: 'info', title: def.nome, message: `${def.nome} funciona direto dentro do jogo.`, detail: 'Ela não tem uma janela própria: os recursos dela aparecem na página do jogo.' });
    return;
  }
  const w = new BrowserWindow({
    width: grande ? 1180 : 460, height: grande ? 800 : 700, minWidth: 320, minHeight: 400, title: `${def.botao || def.nome} — ${nameOf(i)}`,
    backgroundColor: '#0e1424', autoHideMenuBar: true,
    ...(customIconPath() ? { icon: customIconPath() } : {}),
    webPreferences: { session: ses },
  });
  w.setMenu(null);
  w.on('page-title-updated', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  w.loadURL(`chrome-extension://${ext.id}/${String(page).replace(/^\//, '')}`).catch(() => {});
  w.on('closed', () => extWins.delete(key));
  extWins.set(key, w);
}
ipcMain.on('ext-open', (_, i, id) => openExtPage(i, String(id)));

// tira a extensão das 4 contas (sem apagar os arquivos)
function unloadExt(id) {
  for (let i = 0; i < ACCOUNTS.length; i++) {
    const ses = session.fromPartition(`persist:conta${i + 1}`);
    const api = ses.extensions || ses;
    try { for (const e of api.getAllExtensions()) if (e.path && e.path.startsWith(extRoot(id))) api.removeExtension(e.id); } catch {}
  }
  extState[id].version = null;
}
const reloadAllAccounts = () => views.forEach((_, i) => reloadAccount(i));

// ligar / desligar / atualizar / reinstalar uma extensão
async function extAction(id, acao) {
  if (!extState[id] || extBusy.has(id)) return;
  extBusy.set(id, { on: 'ativando', off: 'desativando', update: 'atualizando', reinstall: 'reinstalando' }[acao] || acao);
  notifyExts();
  try {
    if (acao === 'off') {
      extOff.add(id); saveExtCfg();
      unloadExt(id);
      reloadAllAccounts();
    } else if (acao === 'on') {
      extOff.delete(id); saveExtCfg();
      let ext = localExt(id);
      if (!ext) ext = await downloadExt(id);
      await loadExtInto(ext);
      reloadAllAccounts();
    } else if (acao === 'update' || acao === 'reinstall') {
      unloadExt(id);
      if (acao === 'reinstall') fs.rmSync(extRoot(id), { recursive: true, force: true }); // apaga a cópia local
      const ext = await downloadExt(id);
      extOff.delete(id); saveExtCfg();
      await loadExtInto(ext);
      reloadAllAccounts();
    }
    extState[id].error = null;
  } catch (e) {
    extState[id].error = e.message;
    // se a reinstalação falhou no download, tenta voltar a cópia que tiver
    const loc = !extOff.has(id) && localExt(id);
    if (loc) { try { await loadExtInto(loc); } catch {} }
  } finally {
    extBusy.delete(id);
    sendState(); // atualiza o botão Sniper na barra
    notifyExts();
  }
}
function extOverview() {
  return EXTENSIONS.map((e) => ({
    id: e.id, nome: extState[e.id].name || e.nome, autor: e.autor, sobre: e.sobre,
    on: !extOff.has(e.id), version: extState[e.id].version || (localExt(e.id) || {}).version || null, error: extState[e.id].error, busy: extBusy.get(e.id) || null,
  }));
}
function notifyExts() { if (titleBar && !titleBar.webContents.isDestroyed()) titleBar.webContents.send('exts-update'); }
ipcMain.handle('ext-get', () => extOverview());
ipcMain.on('ext-action', (_, id, acao) => { extAction(String(id), String(acao)); });

function showExtensions() {
  const canDraw = titleBar && !titleBar.webContents.isDestroyed() && win && !win.isFullScreen() && !win.isMinimized();
  if (canDraw) {
    const id = ++cfgPanelSeq;
    cfgPanels.add(id);
    dialogOpen = true;
    layout();
    titleBar.webContents.focus();
    titleBar.webContents.send('title-exts', { id });
    return;
  }
  showExtensionsDialog();
}
function showExtensionsDialog() {
  const linhas = EXTENSIONS.map((e) => {
    const st = extState[e.id];
    return `${st.version ? '✓' : '✗'} ${st.name || e.nome}${st.version ? ' ' + st.version : ' (ainda não instalada)'}` +
      (e.autor ? ` · por ${e.autor}` : '') + `\n   ${e.sobre}` + (st.error ? `\n   Último erro: ${st.error}` : '');
  });
  uiDialog({
    type: EXTENSIONS.every((e) => extState[e.id].version) ? 'info' : 'warning',
    title: 'Extensões',
    message: 'Extensões ativas nas 4 contas',
    detail: linhas.join('\n\n') + '\n\nBaixadas da Chrome Web Store e atualizadas automaticamente.',
  });
}

// ---------- PvP: captura dos dados do tracker (1º passo da análise de duelos) ----------
// Abre o tracker do jogo (pokeidle.io/tracker/j/<nick>) escondido, com a sessão da conta, e salva
// tudo o que a página recebe (respostas JSON) + o texto da página num arquivo na Área de Trabalho.
// Com esse arquivo dá para montar a leitura dos duelos e o painel de análise.
async function captureTracker(i) {
  const nick = nameOf(i);
  if (/^Conta \d$/.test(nick)) {
    uiDialog({ type: 'warning', title: 'PvP', message: 'Ainda não sei o nick desta conta.', detail: 'Espere a conta carregar o jogo e tente de novo.' });
    return;
  }
  const url = `https://pokeidle.io/tracker/j/${encodeURIComponent(nick.toLowerCase())}`;
  // avisa na hora que começou (antes não aparecia nada até terminar)
  const aviso = uiDialog({
    type: 'info', title: 'PvP', message: `Gerando o relatório do PvP de ${nick}...`,
    detail: 'Leva uns 15 segundos. Um novo aviso aparece quando o arquivo estiver pronto.',
  });
  // Página escondida numa sessão própria (o tracker é público). Usar a sessão da conta podia
  // conflitar com o jogo aberto e a janela era fechada no meio ("Object has been destroyed").
  const v = new WebContentsView({ webPreferences: { partition: 'persist:tracker', backgroundThrottling: false } });
  const wc = v.webContents;
  v.setBounds({ x: 0, y: 0, width: 1400, height: 1000 });
  const log = [];
  const nota = (t) => log.push(`${new Date().toISOString().slice(11, 19)} ${t}`);
  wc.on('did-start-loading', () => nota('carregando'));
  wc.on('did-finish-load', () => nota('carregou'));
  wc.on('did-fail-load', (_, code, desc, u) => nota(`falhou ${code} ${desc} ${u}`));
  wc.on('did-navigate', (_, u) => nota('navegou ' + u));
  wc.on('render-process-gone', (_, d) => nota('página caiu: ' + d.reason));
  wc.on('destroyed', () => nota('página destruída'));
  wc.on('console-message', (...args) => { const m = args[0] && args[0].message ? args[0].message : args[2]; if (m) nota('console: ' + String(m).slice(0, 200)); });
  wc.setWindowOpenHandler(({ url: u }) => { nota('tentou abrir ' + u); return { action: 'deny' }; });
  const alive = () => !wc.isDestroyed();
  const dbg = wc.debugger;
  const reqs = new Map();
  const respostas = [];
  try {
    dbg.attach('1.3');
    await withTimeout(dbg.sendCommand('Network.enable'), 3000);
    dbg.on('message', async (_, method, p) => {
      if (method === 'Network.responseReceived' && /json|text\/plain/i.test(p.response.mimeType || '')) reqs.set(p.requestId, p.response.url);
      if (method === 'Network.loadingFinished' && reqs.has(p.requestId) && alive()) {
        try {
          const b = await dbg.sendCommand('Network.getResponseBody', { requestId: p.requestId });
          respostas.push({ url: reqs.get(p.requestId), body: b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body });
        } catch {}
      }
    });
  } catch (e) { nota('sem captura de rede: ' + e.message); }
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  // cada leitura tem limite de tempo: com a página ainda carregando, o executeJavaScript podia ficar esperando para sempre
  const ler = () => (alive() ? withTimeout(wc.executeJavaScript('document.body ? document.body.innerText : ""'), 2500).catch(() => '') : Promise.resolve(''));
  let texto = '', turno = '';
  try {
    wc.loadURL(url).catch((e) => nota('loadURL: ' + e.message)); // não espera o "fim do carregamento"
    for (let k = 0; k < 10; k++) { await espera(1000); const t = await ler(); if (t) texto = t; } // guarda o que tiver a cada segundo
    nota(texto ? `texto lido (${texto.length} letras)` : 'texto vazio');
    if (alive()) {
      await withTimeout(wc.executeJavaScript(`(() => {
        const b = [...document.querySelectorAll('button,a,[role=button]')].find((e) => /turno a turno/i.test(e.textContent || ''));
        if (b) b.click(); return !!b;
      })()`), 3000).then((ok) => nota(ok ? 'abriu turno a turno' : 'botão turno a turno não encontrado')).catch(() => {});
      await espera(4000);
      turno = await ler();
    }
  } catch (e) {
    nota('erro: ' + e.message);
  } finally {
    try { dbg.detach(); } catch {}
    try { if (alive()) wc.close(); } catch {}
  }
  // salva na Área de Trabalho; se não der, na pasta Downloads; e sempre uma cópia na pasta de dados do app
  const nome = `pvp-tracker-${nick}.json`;
  const dados = JSON.stringify({ versao: APP_VERSION, nick, url, data: new Date().toISOString(), log, respostas, texto, turno }, null, 1);
  let f = null;
  for (const dir of ['desktop', 'downloads', 'userData']) {
    try { const p = path.join(app.getPath(dir), nome); fs.writeFileSync(p, dados, 'utf8'); f = p; break; } catch {}
  }
  uiDialogClose(aviso); // fecha o "gerando..." e mostra o resultado
  if (!f) { showError('PvP', 'Não consegui salvar o relatório em nenhuma pasta.'); return; }
  const r = await uiDialog({
    type: 'info', title: 'PvP', message: 'Relatório do PvP pronto.',
    detail: `Arquivo: ${f}\n\n${respostas.length} resposta(s) do tracker capturadas` +
      (texto ? '' : ' (a página do tracker não carregou o texto)') + '. Envie esse arquivo para montar a análise dos duelos.',
    buttons: ['Mostrar o arquivo', 'OK'],
    defaultId: 0,
    cancelId: 1,
  });
  if (r.response === 0) shell.showItemInFolder(f);
}

// ---------- PvP: histórico e análise dos duelos (dados do tracker do jogo) ----------
// O tracker (pokeidle.io/tracker/j/<nick>) mostra só as últimas 20 partidas. O Mefislink lê o tracker
// de cada conta de tempos em tempos e guarda cada partida nova em %APPDATA%\Mefislink\pvp,
// montando um histórico maior para calcular vitórias/derrotas por adversário e dar sugestões.
const PVP_EVERY_MIN = 15;
const pvpDir = () => path.join(app.getPath('userData'), 'pvp');
const pvpFile = (nick) => path.join(pvpDir(), nick.toLowerCase().replace(/[^a-z0-9_-]/g, '_') + '.json');
const pvpBusy = new Set();
const TYPES = ['NORMAL', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'ICE', 'FIGHTING', 'POISON', 'GROUND', 'FLYING',
  'PSYCHIC', 'BUG', 'ROCK', 'GHOST', 'DRAGON', 'DARK', 'STEEL', 'FAIRY'];
const splitTypes = (t) => (String(t).toUpperCase().match(new RegExp(TYPES.join('|'), 'g')) || []);
// tabela de tipos (ataque -> defesa): 2 = super efetivo, 0.5 = pouco efetivo, 0 = imune
const TYPE_CHART = {
  NORMAL: { ROCK: 0.5, GHOST: 0, STEEL: 0.5 },
  FIRE: { FIRE: 0.5, WATER: 0.5, GRASS: 2, ICE: 2, BUG: 2, ROCK: 0.5, DRAGON: 0.5, STEEL: 2 },
  WATER: { FIRE: 2, WATER: 0.5, GRASS: 0.5, GROUND: 2, ROCK: 2, DRAGON: 0.5 },
  GRASS: { FIRE: 0.5, WATER: 2, GRASS: 0.5, POISON: 0.5, GROUND: 2, FLYING: 0.5, BUG: 0.5, ROCK: 2, DRAGON: 0.5, STEEL: 0.5 },
  ELECTRIC: { WATER: 2, GRASS: 0.5, ELECTRIC: 0.5, GROUND: 0, FLYING: 2, DRAGON: 0.5 },
  ICE: { FIRE: 0.5, WATER: 0.5, GRASS: 2, ICE: 0.5, GROUND: 2, FLYING: 2, DRAGON: 2, STEEL: 0.5 },
  FIGHTING: { NORMAL: 2, ICE: 2, POISON: 0.5, FLYING: 0.5, PSYCHIC: 0.5, BUG: 0.5, ROCK: 2, GHOST: 0, DARK: 2, STEEL: 2, FAIRY: 0.5 },
  POISON: { GRASS: 2, POISON: 0.5, GROUND: 0.5, ROCK: 0.5, GHOST: 0.5, STEEL: 0, FAIRY: 2 },
  GROUND: { FIRE: 2, GRASS: 0.5, ELECTRIC: 2, POISON: 2, FLYING: 0, BUG: 0.5, ROCK: 2, STEEL: 2 },
  FLYING: { GRASS: 2, ELECTRIC: 0.5, FIGHTING: 2, BUG: 2, ROCK: 0.5, STEEL: 0.5 },
  PSYCHIC: { FIGHTING: 2, POISON: 2, PSYCHIC: 0.5, DARK: 0, STEEL: 0.5 },
  BUG: { FIRE: 0.5, GRASS: 2, FIGHTING: 0.5, POISON: 0.5, FLYING: 0.5, PSYCHIC: 2, GHOST: 0.5, DARK: 2, STEEL: 0.5, FAIRY: 0.5 },
  ROCK: { FIRE: 2, ICE: 2, FIGHTING: 0.5, GROUND: 0.5, FLYING: 2, BUG: 2, STEEL: 0.5 },
  GHOST: { NORMAL: 0, PSYCHIC: 2, GHOST: 2, DARK: 0.5 },
  DRAGON: { DRAGON: 2, STEEL: 0.5, FAIRY: 0 },
  DARK: { FIGHTING: 0.5, PSYCHIC: 2, GHOST: 2, DARK: 0.5, FAIRY: 0.5 },
  STEEL: { FIRE: 0.5, WATER: 0.5, ELECTRIC: 0.5, ICE: 2, ROCK: 2, STEEL: 0.5, FAIRY: 2 },
  FAIRY: { FIRE: 0.5, FIGHTING: 2, POISON: 0.5, DRAGON: 2, DARK: 2, STEEL: 0.5 },
};
const eff = (atk, defTypes) => defTypes.reduce((m, d) => m * ((TYPE_CHART[atk] || {})[d] ?? 1), 1);
const bestHit = (atkTypes, defTypes) => Math.max(...atkTypes.map((a) => eff(a, defTypes)), 0);
const num = (t) => { const s = String(t).trim().toLowerCase(); const n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  if (!isFinite(n)) return 0; return /mi$/.test(s) ? n * 1e6 : /k$/.test(s) ? n * 1e3 : n; };
const fmtN = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' mi' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.', ',') + ' k' : String(Math.round(n)));

// "há 4 min" / "há 2 h" / "há 3 dias" / "agora" -> horário aproximado
function agoToTime(t, now) {
  const m = String(t).match(/(\d+)\s*(s|min|h|dia)/i);
  if (!m) return now;
  const n = Number(m[1]);
  const mult = { s: 1e3, min: 6e4, h: 36e5, dia: 864e5 }[m[2].toLowerCase()] || 6e4;
  return now - n * mult;
}

// transforma o texto da página do tracker em dados
function parseTracker(text) {
  const tk = String(text).split(/[\n\t]/).map((x) => x.trim()).filter(Boolean);
  const out = { summary: {}, counters: [], presas: [], mons: [], matches: [] };
  const idx = (re) => tk.findIndex((x) => re.test(x));
  // cabeçalho
  for (const x of tk.slice(0, 40)) {
    let m;
    if (!out.summary.pr && (m = x.match(/^([\d.]+) PR$/))) out.summary.pr = num(m[1]);
    else if (!out.summary.rank && (m = x.match(/^(\d+)º$/))) out.summary.rank = Number(m[1]);
    else if (out.summary.wins == null && (m = x.match(/^([\d.]+)V$/))) out.summary.wins = num(m[1]);
    else if (out.summary.losses == null && (m = x.match(/^([\d.]+)D$/))) out.summary.losses = num(m[1]);
    else if (!out.summary.level && (m = x.match(/^Nível ([\d.]+)$/))) out.summary.level = num(m[1]);
  }
  // listas "nome / TIPOS / partidas / %"
  const readList = (startRe, endRe) => {
    const a = idx(startRe); if (a < 0) return [];
    let b = tk.findIndex((x, k) => k > a && endRe.test(x)); if (b < 0) b = tk.length;
    const seg = tk.slice(a + 1, b).filter((x) => !/^(ADVERSÁRIO|PARTIDAS|VITÓRIAS)$/i.test(x));
    const res = [];
    for (let k = 0; k + 3 < seg.length + 1; k++) {
      if (splitTypes(seg[k + 1]).length && /^[A-Z]+$/.test(seg[k + 1]) && /^[\d.]+$/.test(seg[k + 2] || '') && /%$/.test(seg[k + 3] || '')) {
        res.push({ name: seg[k], types: splitTypes(seg[k + 1]), games: num(seg[k + 2]), wr: num(seg[k + 3]) });
        k += 3;
      }
    }
    return res;
  };
  out.counters = readList(/^MAIORES COUNTERS$/i, /^PRESAS FAVORITAS$/i);
  out.presas = readList(/^PRESAS FAVORITAS$/i, /^GOLPES$/i);
  // os seus pokémon: nome / TIPOS / partidas / % / dano / abates
  {
    const a = idx(/^OS SEUS POKÉMON$/i); const b = idx(/^ÚLTIMAS 20 PARTIDAS$/i);
    if (a >= 0) {
      const seg = tk.slice(a + 1, b > a ? b : tk.length);
      for (let k = 0; k + 5 < seg.length + 1; k++) {
        if (/^[A-Z]+$/.test(seg[k + 1] || '') && splitTypes(seg[k + 1]).length && /^[\d.]+$/.test(seg[k + 2] || '') && /%$/.test(seg[k + 3] || '')) {
          out.mons.push({ name: seg[k], types: splitTypes(seg[k + 1]), games: num(seg[k + 2]), wr: num(seg[k + 3]), dmg: num(seg[k + 4]), kills: num(seg[k + 5]) });
          k += 5;
        }
      }
    }
  }
  // partidas: "Vitória|Derrota" / "há X · 1:49" / "contra NICK 1.930 PR" / "+9 ▼" / (detalhes, se abertos)
  {
    const now = Date.now();
    const a = idx(/^ÚLTIMAS 20 PARTIDAS$/i);
    const seg = a >= 0 ? tk.slice(a + 1) : [];
    const starts = [];
    seg.forEach((x, k) => { if (/^(Vitória|Derrota)$/.test(x) && /^contra /.test(seg[k + 2] || '')) starts.push(k); });
    starts.forEach((k, n) => {
      const end = n + 1 < starts.length ? starts[n + 1] : seg.length;
      const blk = seg.slice(k, end);
      const t = (blk[1] || '').match(/^(.*?)\s*·\s*(\d+:\d+)$/);
      const c = (blk[2] || '').match(/^contra (.+?) ([\d.]+) PR$/);
      const d = (blk[3] || '').match(/^([+-]\d+)/);
      if (!c) return;
      const match = {
        win: blk[0] === 'Vitória', opp: c[1], oppPr: num(c[2]), delta: d ? Number(d[1]) : 0,
        dur: t ? t[2] : '', time: agoToTime(t ? t[1] : '', now),
      };
      // times (aparecem quando a partida é aberta): nome seguido de "Nv 100 · caiu"
      const det = blk.slice(4);
      const cut = det.findIndex((x) => /^O TIME DE /i.test(x));
      const team = (part) => {
        const r = [];
        part.forEach((x, j) => {
          const nv = (part[j + 1] || '').match(/^Nv\s*([\d.]+)\s*·?\s*(.*)$/i);
          if (!nv) return;
          const nums = part.slice(j + 2, j + 6).filter((y) => /^[\d.,]+\s*(k|mi)?$/i.test(y)).slice(0, 3).map(num);
          r.push({ name: x, lv: num(nv[1]), fainted: /caiu/i.test(nv[2]), dmg: nums[0] || 0, taken: nums[1] || 0, kills: nums[2] || 0 });
        });
        return r;
      };
      if (cut >= 0) { match.mine = team(det.slice(0, cut)); match.theirs = team(det.slice(cut)); }
      match.key = [match.opp, match.oppPr, match.delta, match.dur, match.win ? 'V' : 'D'].join('|');
      out.matches.push(match);
    });
  }
  return out;
}

// abre o tracker escondido (sessão própria), abre todas as partidas e devolve o texto da página
async function loadTrackerText(nick) {
  const url = `https://pokeidle.io/tracker/j/${encodeURIComponent(nick.toLowerCase())}`;
  const v = new WebContentsView({ webPreferences: { partition: 'persist:tracker', backgroundThrottling: false } });
  const wc = v.webContents;
  v.setBounds({ x: 0, y: 0, width: 1400, height: 1000 });
  const alive = () => !wc.isDestroyed();
  const js = (code, ms = 3000) => (alive() ? withTimeout(wc.executeJavaScript(code), ms).catch(() => null) : Promise.resolve(null));
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  let text = '';
  try {
    wc.loadURL(url).catch(() => {});
    for (let k = 0; k < 15; k++) {
      await espera(1000);
      text = (await js('document.body ? document.body.innerText : ""')) || '';
      if (/ÚLTIMAS 20 PARTIDAS/i.test(text) && /contra /.test(text)) break;
    }
    // abre (▼) cada partida para aparecerem os times
    await js(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const alvos = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && /▼/.test(e.textContent || '') && e.getClientRects().length);
      for (const e of alvos) { (e.closest('button,[role=button],summary,[onclick]') || e).click(); await sleep(120); }
      return alvos.length;
    })()`, 15000);
    await espera(1500);
    const t2 = await js('document.body ? document.body.innerText : ""');
    if (t2) text = t2;
  } finally {
    try { if (alive()) wc.close(); } catch {}
  }
  return text;
}

function loadPvp(nick) {
  try { return JSON.parse(fs.readFileSync(pvpFile(nick), 'utf8')); } catch { return { nick, matches: [], tracker: null, updated: 0 }; }
}
function savePvp(data) {
  try { fs.mkdirSync(pvpDir(), { recursive: true }); fs.writeFileSync(pvpFile(data.nick), JSON.stringify(data)); } catch {}
}

// lê o tracker e junta as partidas novas no histórico
async function refreshPvp(nick) {
  if (!nick || /^Conta \d$/.test(nick) || pvpBusy.has(nick)) return null;
  pvpBusy.add(nick);
  try {
    const text = await loadTrackerText(nick);
    const p = parseTracker(text);
    if (!p.matches.length && !p.mons.length) return null;
    const data = loadPvp(nick);
    const known = new Map(data.matches.map((m) => [m.key, m]));
    for (const m of p.matches) {
      const old = known.get(m.key);
      if (!old) { data.matches.push(m); known.set(m.key, m); }
      else if (!old.mine && m.mine) Object.assign(old, { mine: m.mine, theirs: m.theirs }); // completa detalhes
    }
    data.matches.sort((a, b) => b.time - a.time);
    data.tracker = { summary: p.summary, counters: p.counters, presas: p.presas, mons: p.mons };
    data.updated = Date.now();
    savePvp(data);
    return data;
  } finally { pvpBusy.delete(nick); }
}

// análise: vitórias/derrotas por adversário + sugestões
function analyzePvp(data) {
  const t = data.tracker || { summary: {}, counters: [], presas: [], mons: [] };
  const byOpp = new Map();
  for (const m of data.matches) {
    const o = byOpp.get(m.opp) || { name: m.opp, w: 0, l: 0, last: 0, lastWin: false, pr: m.oppPr, ms: [] };
    m.win ? o.w++ : o.l++;
    if (m.time > o.last) { o.last = m.time; o.lastWin = m.win; o.pr = m.oppPr; }
    o.ms.push(m);
    byOpp.set(m.opp, o);
  }
  const opps = [...byOpp.values()].sort((a, b) => (b.w + b.l) - (a.w + a.l) || b.last - a.last);
  const sug = [];

  // 1) adversários difíceis
  const rivais = [];
  for (const o of opps.filter((x) => x.w + x.l >= 3 && x.w / (x.w + x.l) < 0.4).slice(0, 8)) {
    // o pokémon dele que mais causou dano nas suas derrotas
    const dano = new Map();
    for (const m of o.ms.filter((x) => !x.win && x.theirs)) for (const p of m.theirs) dano.set(p.name, (dano.get(p.name) || 0) + p.dmg);
    const top = [...dano.entries()].sort((a, b) => b[1] - a[1])[0];
    const nDer = Math.max(1, o.ms.filter((x) => !x.win && x.theirs).length);
    rivais.push({ nome: o.name, w: o.w, l: o.l, top: top ? top[0] : null, topDano: top ? fmtN(top[1] / nDer) : null });
    if (rivais.length > 3) continue;
    sug.push({ tipo: 'rival', texto: `${o.name} te vence com frequência (${o.w}V ${o.l}D).` +
      (top ? ` O maior problema é o ${top[0]} dele (${fmtN(top[1] / Math.max(1, o.ms.filter((x) => !x.win && x.theirs).length))} de dano por derrota).` : '') });
  }

  // 2) ordem do time contra cada adversário (quando há times registrados)
  const leads = [];
  for (const o of opps) {
    const comTime = o.ms.filter((m) => m.mine && m.mine.length);
    if (comTime.length < 2) continue;
    const porLead = new Map();
    for (const m of comTime) {
      const ld = m.mine[0].name;
      const r = porLead.get(ld) || { w: 0, l: 0, ordem: m.mine.map((p) => p.name) };
      m.win ? r.w++ : r.l++;
      porLead.set(ld, r);
    }
    const melhor = [...porLead.entries()].sort((a, b) => (b[1].w / (b[1].w + b[1].l)) - (a[1].w / (a[1].w + a[1].l)) || (b[1].w - a[1].w))[0];
    if (melhor && melhor[1].w > 0) leads.push({ opp: o.name, lead: melhor[0], w: melhor[1].w, l: melhor[1].l, ordem: melhor[1].ordem });
  }
  leads.sort((a, b) => (b.w + b.l) - (a.w + a.l));
  for (const ld of leads.slice(0, 3)) {
    sug.push({ tipo: 'ordem', texto: `Contra ${ld.opp}: começar com ${ld.lead} deu ${ld.w}V ${ld.l}D. Ordem que funcionou: ${ld.ordem.join(' → ')}.` });
  }

  // 3) quem do seu time cai sem render (nas partidas registradas com time)
  const caem = [];
  {
    const st = new Map();
    for (const m of data.matches.filter((x) => x.mine)) for (const p of m.mine) {
      const s = st.get(p.name) || { n: 0, caiu: 0, dmg: 0 };
      s.n++; if (p.fainted) s.caiu++; s.dmg += p.dmg; st.set(p.name, s);
    }
    const fracos = [...st.entries()].filter(([, s]) => s.n >= 5 && s.caiu / s.n > 0.85).sort((a, b) => a[1].dmg / a[1].n - b[1].dmg / b[1].n).slice(0, 2);
    for (const [nm, s] of fracos) caem.push({ nome: nm, pct: Math.round((s.caiu / s.n) * 100), dano: fmtN(s.dmg / s.n) });
    for (const [nm, s] of fracos) sug.push({ tipo: 'fraco', texto: `${nm} cai em ${Math.round((s.caiu / s.n) * 100)}% das partidas causando em média ${fmtN(s.dmg / s.n)} de dano. Vale testar outra posição ou trocar.` });
  }

  // 4) seus pokémon com rendimento baixo (dados da temporada do tracker)
  const mons = t.mons.filter((m) => m.games >= 50).map((m) => ({ ...m, dmgPer: m.dmg / m.games, killsPer: m.kills / m.games }));
  if (mons.length >= 3) {
    const media = mons.reduce((s, m) => s + m.wr, 0) / mons.length;
    for (const m of mons.filter((x) => x.wr < media - 5).sort((a, b) => a.wr - b.wr).slice(0, 2)) {
      sug.push({ tipo: 'fraco', texto: `${m.name} tem ${m.wr}% de vitórias em ${m.games} partidas, abaixo da média do seu time (${Math.round(media)}%).` });
    }
    const destaque = [...mons].sort((a, b) => b.dmgPer - a.dmgPer)[0];
    sug.push({ tipo: 'forte', texto: `${destaque.name} é quem mais rende: ${fmtN(destaque.dmgPer)} de dano e ${destaque.killsPer.toFixed(1).replace('.', ',')} abates por partida.` });
  }

  // 5) contra os maiores counters: quem do seu time bate forte e aguenta
  const counterTips = [];
  for (const c of t.counters.slice(0, 4)) {
    const bons = mons.map((m) => ({ m, atk: bestHit(m.types, c.types), def: bestHit(c.types, m.types) }))
      .filter((x) => x.atk >= 2 && x.def <= 1).sort((a, b) => b.atk - a.atk || a.def - b.def || b.m.wr - a.m.wr).slice(0, 2);
    const ruins = mons.filter((m) => bestHit(c.types, m.types) >= 2).map((m) => m.name).slice(0, 3);
    counterTips.push({ name: c.name, types: c.types, wr: c.wr, games: c.games, bons: bons.map((x) => x.m.name), ruins });
    if (bons.length) sug.push({ tipo: 'counter', texto: `Contra ${c.name} (${c.types.join('/')}, você vence só ${c.wr}%): ${bons.map((x) => x.m.name).join(' e ')} bate${bons.length > 1 ? 'm' : ''} forte e aguenta${bons.length > 1 ? 'm' : ''} os golpes dele.` +
      (ruins.length ? ` Evite deixar ${ruins.join(', ')} na frente dele.` : '') });
  }

  const recent = data.matches.slice(0, 20);
  return {
    nick: data.nick, updated: data.updated, total: data.matches.length,
    summary: t.summary, recentW: recent.filter((m) => m.win).length, recentL: recent.filter((m) => !m.win).length,
    opps: opps.slice(0, 40).map((o) => ({ name: o.name, w: o.w, l: o.l, pr: o.pr, last: o.last, lastWin: o.lastWin })),
    counters: counterTips, presas: t.presas, mons: mons.map((m) => ({ name: m.name, types: m.types, games: m.games, wr: m.wr, dmgPer: fmtN(m.dmgPer), killsPer: m.killsPer.toFixed(1).replace('.', ',') })),
    sug, hasTeams: data.matches.some((m) => m.mine && m.mine.length),
    rivais, leads: leads.slice(0, 12), caem,
  };
}

// janela do PvP
let pvpWin = null;
function openPvp(i) {
  if (pvpWin && !pvpWin.isDestroyed()) { pvpWin.webContents.send('pvp-account', i); pvpWin.show(); pvpWin.focus(); return; }
  pvpWin = new BrowserWindow({
    width: 1100, height: 820, minWidth: 760, minHeight: 560, title: 'PvP — Mefislink',
    backgroundColor: '#0e1424', autoHideMenuBar: true,
    titleBarStyle: 'hidden', titleBarOverlay: { color: TITLE_BG, symbolColor: TITLE_FG, height: TITLE_H },
    ...(customIconPath() ? { icon: customIconPath() } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  pvpWin.setMenu(null);
  pvpWin.loadFile(path.join(__dirname, 'bar.html'), { query: { mode: 'pvp', i: String(i) } });
  pvpWin.on('closed', () => { pvpWin = null; });
}
ipcMain.handle('pvp-get', async (_, i, force) => {
  if (!Number.isInteger(i) || i < 0 || i >= ACCOUNTS.length) return null;
  const nick = nameOf(i);
  if (/^Conta \d$/.test(nick)) return { erro: 'Ainda não sei o nick desta conta. Espere o jogo carregar.' };
  let data = loadPvp(nick);
  if (force || !data.updated || Date.now() - data.updated > 5 * 60 * 1000) data = (await refreshPvp(nick)) || data;
  if (!data.updated) return { erro: 'Não consegui ler o tracker desta conta. Confira a internet e tente "Atualizar".' };
  return Object.assign(analyzePvp(data), { contas: ACCOUNTS.map((_, k) => nameOf(k)), conta: i });
});
// coleta em segundo plano: guarda as partidas novas antes que saiam das "últimas 20"
async function pvpCollectAll() {
  for (let i = 0; i < ACCOUNTS.length; i++) {
    try { await refreshPvp(nameOf(i)); } catch {}
  }
}

// ---------- Importar o login da Kick de um navegador normal ----------
// A proteção anti-robô da Kick recusa o login feito dentro do Mefislink. Em vez de logar aqui,
// o usuário loga no Chrome/Edge, exporta os cookies da kick.com (extensão "Cookie-Editor" → Export → JSON)
// e cola no Mefislink. Os cookies ficam só na sessão daquela conta, neste PC.
function parseCookieText(txt) {
  const t = String(txt || '').trim();
  if (!t) return [];
  // 1) JSON (Cookie-Editor, EditThisCookie...)
  if (/^[\[{]/.test(t)) {
    try {
      const j = JSON.parse(t);
      const arr = Array.isArray(j) ? j : Array.isArray(j.cookies) ? j.cookies : [j];
      return arr.filter((c) => c && c.name).map((c) => ({
        name: String(c.name), value: String(c.value ?? ''), domain: c.domain || '.kick.com', path: c.path || '/',
        secure: c.secure !== false, httpOnly: !!c.httpOnly,
        expirationDate: Number(c.expirationDate || c.expires || 0) || undefined,
        sameSite: ({ no_restriction: 'no_restriction', none: 'no_restriction', lax: 'lax', strict: 'strict' })[String(c.sameSite || '').toLowerCase()] || 'unspecified',
      }));
    } catch {}
  }
  // 2) formato Netscape (cookies.txt): domínio  flag  caminho  seguro  expira  nome  valor
  const net = t.split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')).filter((p) => p.length >= 7);
  if (net.length) {
    return net.map((p) => ({ domain: p[0], path: p[2], secure: /true/i.test(p[3]), expirationDate: Number(p[4]) || undefined, name: p[5], value: p[6], httpOnly: false, sameSite: 'unspecified' }));
  }
  // 3) "nome=valor; nome2=valor2"
  return t.replace(/^cookie:\s*/i, '').split(';').map((x) => x.trim()).filter((x) => x.includes('='))
    .map((x) => { const k = x.indexOf('='); return { name: x.slice(0, k).trim(), value: x.slice(k + 1).trim(), domain: '.kick.com', path: '/', secure: true, httpOnly: false, sameSite: 'unspecified' }; });
}

async function importKickLogin(i) {
  const f = await uiDialog({
    type: 'question',
    title: `Kick — ${nameOf(i)}`,
    message: 'Importar o login da Kick do seu navegador',
    detail: '1. No Chrome ou Edge, instale a extensão "Cookie-Editor".\n' +
      '2. Entre em kick.com com a conta da Kick desta conta do jogo.\n' +
      '3. Clique na extensão → Export → JSON (copia sozinho).\n' +
      '4. Cole aqui embaixo e clique em Importar.\n\n' +
      'Isso é o seu login: cole só aqui no Mefislink e não mande para ninguém.',
    form: [{ id: 'cookies', label: 'Cookies da kick.com', hint: 'cole o texto copiado pela extensão', type: 'textarea', value: '' }],
    buttons: ['Importar', 'Cancelar'],
    defaultId: 0,
    cancelId: 1,
  });
  if (f.response !== 0 || !f.values) return;
  const list = parseCookieText(f.values.cookies).filter((c) => /kick\.com$/i.test(String(c.domain).replace(/^\./, '')));
  if (!list.length) {
    showError('Kick', 'Não encontrei cookies da kick.com no texto colado. Confira se você estava em kick.com ao exportar.');
    return;
  }
  const ses = accountSession(i);
  let ok = 0;
  for (const c of list) {
    const host = String(c.domain).replace(/^\./, '');
    try {
      await ses.cookies.set({
        url: `https://${host}${c.path || '/'}`, name: c.name, value: c.value,
        domain: c.domain.startsWith('.') || c.domain.includes('kick.com') ? c.domain : undefined,
        path: c.path || '/', secure: c.secure, httpOnly: c.httpOnly,
        expirationDate: c.expirationDate, sameSite: c.sameSite,
      });
      ok++;
    } catch {}
  }
  try { await ses.cookies.flushStore(); } catch {}
  if (await kickLogged(i)) {
    uiDialog({ type: 'info', title: 'Kick', message: `Login da Kick importado na ${nameOf(i)}.`, detail: `${ok} cookie(s) importados. O botão Kick desta conta foi ligado.` });
    setLivesOn(i, 'kick', true);
  } else {
    uiDialog({
      type: 'warning', title: 'Kick', message: 'Os cookies foram importados, mas a Kick ainda não reconheceu o login.',
      detail: `${ok} cookie(s) importados. Confira se você estava logado em kick.com ao exportar e exporte de novo.`,
    });
  }
}

// ---------- Pontos da Kick: leitura em tempo real + aviso + atalho para o resgate ----------
// O saldo de pontos de cada canal é lido de dentro das lives da Kick que já estão abertas
// escondidas (mesma conta). Primeiro pela API da própria página; se não der, pela tela do chat.
const KICK_GOALS = [
  { pts: 300, nome: '+15% XP' },
  { pts: 500, nome: '+15% Capture Boost' },
  { pts: 1000, nome: '+15% Secret Lure' },
];
const KICK_POLL_SEC = 60;
const kickPts = ACCOUNTS.map(() => ({})); // slug -> { pts, at, base, baseAt, via, avisado: {300: true...} }
const liveStatus = new Map(); // "conta|canal" -> { tocando, visivel }
const KICK_POINTS_JS = `(async () => {
  const slug = (location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
  const out = { slug, points: null, via: null, visivel: document.visibilityState, tocando: false };
  // o player precisa estar tocando para a Kick contar os pontos: se pausou, dá play de novo
  for (const v of document.querySelectorAll('video')) {
    if (v.paused) {
      try { await v.play(); } catch (e) {
        // o navegador recusou o play direto: tenta o botão de play do próprio player
        const b = [...document.querySelectorAll('button,[role=button]')].find((x) => /play|reproduzir|assistir/i.test((x.getAttribute('aria-label') || '') + ' ' + (x.title || '')));
        if (b) b.click();
      }
    }
    if (!v.paused && v.readyState >= 2) out.tocando = true;
  }
  out.erroPlay = document.querySelectorAll('video').length ? null : 'sem player na página';
  const parse = (t) => {
    const m = String(t).replace(/\\s/g, '').match(/^([\\d.,]+)([kKmM]?)$/);
    if (!m) return null;
    let n = parseFloat(m[1].replace(/\\.(?=\\d{3}(\\D|$))/g, '').replace(',', '.'));
    if (/k/i.test(m[2])) n *= 1e3; if (/m/i.test(m[2])) n *= 1e6;
    return isFinite(n) ? Math.round(n) : null;
  };
  // 1) API da Kick, de dentro da página (usa o login da própria página)
  try {
    const tok = decodeURIComponent((document.cookie.match(/(?:^|; )session_token=([^;]+)/) || [])[1] || '');
    const h = { Accept: 'application/json' };
    if (tok) h.Authorization = 'Bearer ' + tok;
    const find = (o, d) => {
      if (!o || typeof o !== 'object' || d > 5) return null;
      for (const [k, v] of Object.entries(o)) {
        if (/point/i.test(k) && typeof v === 'number') return v;
        if (/point/i.test(k) && v && typeof v === 'object' && typeof v.points === 'number') return v.points;
        const x = find(v, d + 1); if (x != null) return x;
      }
      return null;
    };
    for (const u of ['/api/v2/channels/' + slug + '/me', '/api/v2/channels/' + slug + '/points']) {
      const r = await fetch(u, { headers: h, credentials: 'include' });
      if (!r.ok) continue;
      const p = find(await r.json(), 0);
      if (p != null) { out.points = Math.round(p); out.via = 'api'; return out; }
    }
  } catch (e) {}
  // 2) tela: botão/elemento de pontos perto do chat
  const els = [...document.querySelectorAll('[aria-label],[title],[data-testid],[class*=point],[class*=Point]')]
    .filter((e) => /point|ponto/i.test([e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('data-testid'), e.className].join(' ')));
  for (const e of els) {
    const p = parse(e.textContent || '');
    if (p != null) { out.points = p; out.via = 'tela'; return out; }
    for (const s of e.querySelectorAll('*')) { const q = s.children.length ? null : parse(s.textContent || ''); if (q != null) { out.points = q; out.via = 'tela'; return out; } }
  }
  return out;
})()`;

const kickAll = ACCOUNTS.map(() => ({})); // slug -> pontos (todos os canais, não só os abertos)
const kickAllAt = ACCOUNTS.map(() => 0);
const KICK_ALL_JS = (slugs) => `(async () => {
  const tok = decodeURIComponent((document.cookie.match(/(?:^|; )session_token=([^;]+)/) || [])[1] || '');
  const h = { Accept: 'application/json' }; if (tok) h.Authorization = 'Bearer ' + tok;
  const out = {};
  for (const s of ${JSON.stringify([])}.concat(SLUGS)) {
    try { const r = await fetch('/api/v2/channels/' + s + '/points', { headers: h, credentials: 'include' });
      if (r.ok) { const j = await r.json(); const p = j && j.data && j.data.points; if (typeof p === 'number') out[s] = p; } } catch (e) {}
  }
  return out;
})()`.replace('SLUGS', JSON.stringify(slugs));
async function pollKickAll(i) {
  if (Date.now() - kickAllAt[i] < 5 * 60 * 1000) return;
  const slot = [...liveOpen[i].kick.values()].find((x) => x.view && !x.view.webContents.isDestroyed() && !x.view.webContents.isLoading());
  if (!slot) return;
  kickAllAt[i] = Date.now();
  try { Object.assign(kickAll[i], await withTimeout(slot.view.webContents.executeJavaScript(KICK_ALL_JS(LIVE_CHANNELS.kick)), 20000)); } catch {}
}

async function pollKickPoints() {
  for (let i = 0; i < ACCOUNTS.length; i++) {
    for (const [slug, slot] of liveOpen[i].kick) {
      const wc = slot.view && slot.view.webContents;
      if (!wc || wc.isDestroyed() || wc.isLoading()) continue;
      let r = null;
      try { r = await withTimeout(wc.executeJavaScript(KICK_POINTS_JS), 8000); } catch {}
      if (r) liveStatus.set(`${i}|${slug}`, { tocando: !!r.tocando, visivel: r.visivel, at: Date.now() });
      if (!r || r.points == null) continue;
      const now = Date.now();
      const s = kickPts[i][slug] || { base: r.points, baseAt: now, avisado: {} };
      if (r.points < (s.pts ?? r.points)) { s.base = r.points; s.baseAt = now; s.avisado = {}; } // resgatou: recomeça a contagem
      s.pts = r.points; s.at = now; s.via = r.via;
      kickPts[i][slug] = s;
      // avisa quando cruza 300 / 500 / 1.000
      const meta = [...KICK_GOALS].reverse().find((g) => r.points >= g.pts && !s.avisado[g.pts]);
      if (meta) {
        KICK_GOALS.forEach((g) => { if (r.points >= g.pts) s.avisado[g.pts] = true; });
        kickGoalAlert(i, slug, r.points, meta);
      }
    }
  }
  for (let i = 0; i < ACCOUNTS.length; i++) if (lives.kick[i]) await pollKickAll(i);
  if (kickWin && !kickWin.isDestroyed()) kickWin.webContents.send('kick-update');
  if (titleBar && !titleBar.webContents.isDestroyed()) titleBar.webContents.send('kick-update'); // painel da barra
}
async function kickGoalAlert(i, slug, pts, meta) {
  const r = await uiDialog({
    type: 'info',
    title: 'Pontos da Kick',
    message: `${nameOf(i)}: ${pts.toLocaleString('pt-BR')} pontos em ${slug}`,
    detail: `Já dá para resgatar ${meta.nome} (${meta.pts.toLocaleString('pt-BR')} pontos). ` +
      'O resgate é feito na live: abra os pontos do canal (embaixo do chat) e escolha o bônus. Em segundos ele aparece no jogo.',
    buttons: ['Resgatar na live', 'Depois'],
    defaultId: 0,
    cancelId: 1,
  });
  if (r.response === 0) openLivePage(i, 'kick', slug);
}
// leva até o resgate: amplia a conta e abre o painel "Bônus na Kick" do jogo
async function openKickRedeem(i) {
  setFocus(i);
  if (win) win.focus();
  const wc = views[i] && views[i].webContents;
  if (!wc || wc.isDestroyed()) return;
  const ok = await withTimeout(wc.executeJavaScript(`(() => {
    const b = document.querySelector('button.tr-ativo.kick') ||
      [...document.querySelectorAll('button,[role=button]')].find((e) => /kick/i.test((e.getAttribute('aria-label') || '') + ' ' + (e.textContent || '')));
    if (b) b.click(); return !!b;
  })()`), 3000).catch(() => false);
  if (!ok) uiDialog({ type: 'info', title: 'Pontos da Kick', message: 'Abra o painel "Bônus na Kick" no jogo para resgatar.', detail: 'Não achei o botão da Kick no painel do treinador desta conta.' });
}

function kickState() {
  return {
    goals: KICK_GOALS,
    poll: KICK_POLL_SEC,
    contas: ACCOUNTS.map((_, i) => ({
      i, name: nameOf(i), on: !!lives.kick[i],
      sel: kickSel[i],
      todos: LIVE_CHANNELS.kick.map((slug) => ({
        slug, live: liveNow.kick.has(slug), sel: kickSel[i].includes(slug),
        pts: kickPts[i][slug] && kickPts[i][slug].pts != null ? kickPts[i][slug].pts : (kickAll[i][slug] ?? null),
      })),
      canais: [...liveOpen[i].kick.keys()].map((slug) => {
        const s = kickPts[i][slug];
        const horas = s && s.at > s.baseAt ? (s.at - s.baseAt) / 36e5 : 0;
        const st = liveStatus.get(`${i}|${slug}`);
        const slot = liveOpen[i].kick.get(slug);
        return { slug, pts: s ? s.pts : null, via: s ? s.via : null, at: s ? s.at : 0, tocando: st ? st.tocando : null,
          aberta: slot && slot.view ? slot.openedAt : 0,
          // aberta há 20+ min e o saldo não subiu nada desde a 1ª leitura = não está rendendo
          semRender: !!(slot && slot.view && Date.now() - slot.openedAt > 20 * 60 * 1000 && s && s.pts != null && s.pts === s.base && Date.now() - s.baseAt > 15 * 60 * 1000),
          porHora: horas >= 0.1 ? Math.round((s.pts - s.base) / horas) : null };
      }),
    })),
  };
}
ipcMain.handle('kick-get', () => kickState());
ipcMain.handle('kick-refresh', async () => { await pollKickPoints(); return kickState(); });
ipcMain.on('kick-redeem', (_, i) => { if (Number.isInteger(i) && i >= 0 && i < ACCOUNTS.length) openKickRedeem(i); });
ipcMain.on('kick-redeem-live', (_, i, slug) => openLivePage(i, 'kick', String(slug)));
// escolher/desmarcar um canal para farmar
ipcMain.on('kick-sel', (_, i, slug) => {
  if (!Number.isInteger(i) || i < 0 || i >= ACCOUNTS.length) return;
  slug = String(slug).toLowerCase();
  if (!LIVE_CHANNELS.kick.includes(slug)) return;
  const k = kickSel[i].indexOf(slug);
  if (k >= 0) kickSel[i].splice(k, 1); else kickSel[i].push(slug);
  saveLives();
  syncLives();
  if (kickWin && !kickWin.isDestroyed()) kickWin.webContents.send('kick-update');
  if (titleBar && !titleBar.webContents.isDestroyed()) titleBar.webContents.send('kick-update'); // painel da barra
});
ipcMain.on('kick-open', (e, i, rect) => {
  if (!Number.isInteger(i)) return;
  // moedinha da barra: os pontos descem do botão como um painel (desenhado pela barra de título)
  const bi = bars.findIndex((b) => b.webContents === e.sender);
  const canDraw = titleBar && !titleBar.webContents.isDestroyed() && win && !win.isFullScreen() && !win.isMinimized();
  if (!canDraw || bi < 0 || !rect) { openKickWin(); return; }
  const b = bars[bi].getBounds();
  const id = ++cfgPanelSeq;
  cfgPanels.add(id);
  dialogOpen = true;
  layout();
  titleBar.webContents.focus();
  titleBar.webContents.send('title-kick', {
    id, conta: i, x: b.x + Math.round(rect.left) - 8, y: b.y + Math.round(rect.bottom) + 4, up: b.y + Math.round(rect.top) - 4,
  });
  pollKickPoints();
});
ipcMain.handle('kick-diag', async () => {
  // diagnóstico: o que a página da Kick mostra perto do chat (para ajustar a leitura dos pontos)
  for (let i = 0; i < ACCOUNTS.length; i++) {
    for (const [slug, slot] of liveOpen[i].kick) {
      const wc = slot.view && slot.view.webContents;
      if (!wc || wc.isDestroyed()) continue;
      const dump = await withTimeout(wc.executeJavaScript(`(async () => {
        const slug = ${JSON.stringify(slug)};
        const tok = decodeURIComponent((document.cookie.match(/(?:^|; )session_token=([^;]+)/) || [])[1] || '');
        const h = { Accept: 'application/json' }; if (tok) h.Authorization = 'Bearer ' + tok;
        const api = {};
        for (const u of ['/api/v2/channels/' + slug + '/me', '/api/v2/channels/' + slug + '/points']) {
          try { const r = await fetch(u, { headers: h, credentials: 'include' }); api[u] = r.status + ' ' + (await r.text()).slice(0, 3000); } catch (e) { api[u] = 'erro ' + e.message; }
        }
        const rot = [...document.querySelectorAll('[aria-label],[title],[data-testid]')].map((e) => e.tagName + ' | ' + [e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('data-testid')].filter(Boolean).join(' | ') + ' | ' + (e.textContent || '').trim().slice(0, 40)).slice(0, 400);
        const chat = document.querySelector('#chatroom-footer, [id*=chat] footer, [class*=chat-input], [class*=ChatInput]');
        const videos = [...document.querySelectorAll('video')].map((v) => ({ paused: v.paused, muted: v.muted, readyState: v.readyState, t: v.currentTime }));
        return { url: location.href, logado: !!tok, visivel: document.visibilityState, videos, api, rotulos: rot, chat: chat ? chat.outerHTML.slice(0, 8000) : null };
      })()`), 15000).catch((e) => ({ erro: e.message }));
      const f = path.join(app.getPath('desktop'), 'kick-diagnostico.json');
      try { fs.writeFileSync(f, JSON.stringify({ versao: APP_VERSION, conta: nameOf(i), slug, dump }, null, 1)); } catch { return null; }
      return f;
    }
  }
  return '';
});

// janela "Resgate" (pontos em tempo real)
let kickWin = null;
function openKickWin() {
  if (kickWin && !kickWin.isDestroyed()) { kickWin.show(); kickWin.focus(); return; }
  kickWin = new BrowserWindow({
    width: 980, height: 760, minWidth: 640, minHeight: 480, title: 'Pontos da Kick — Mefislink',
    backgroundColor: '#0e1424', autoHideMenuBar: true,
    titleBarStyle: 'hidden', titleBarOverlay: { color: TITLE_BG, symbolColor: TITLE_FG, height: TITLE_H },
    ...(customIconPath() ? { icon: customIconPath() } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  kickWin.setMenu(null);
  kickWin.loadFile(path.join(__dirname, 'bar.html'), { query: { mode: 'kick' } });
  kickWin.on('closed', () => { kickWin = null; });
  pollKickPoints();
}

// ---------- Entrar com Google direto em janela integrada segura ----------
function openGoogleLoginWindow(i) {
  if (!Number.isInteger(i) || i < 0 || i >= ACCOUNTS.length) return;
  const ses = session.fromPartition(`persist:conta${i + 1}`);
  applyGoogleLoginFix(ses);

  const w = new BrowserWindow({
    width: 520,
    height: 720,
    title: `Entrar com Google — ${nameOf(i)}`,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    ...(customIconPath() ? { icon: customIconPath() } : {}),
    webPreferences: {
      partition: `persist:conta${i + 1}`,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  w.setMenu(null);

  w.webContents.on('did-start-navigation', (_, url) => {
    if (/accounts\.google\.com/i.test(url)) {
      w.webContents.setUserAgent(GOOGLE_AUTH_UA);
    }
  });

  const checkFinish = async () => {
    if (w.isDestroyed()) return;
    const url = w.webContents.getURL();
    if (/pokeidle\.io\/app/i.test(url) || /pokeidle\.io\/auth\/google\/retorno/i.test(url)) {
      const sess = await w.webContents.executeJavaScript("localStorage.getItem('sessao')").catch(() => null);
      if (sess) {
        setTimeout(() => {
          if (!w.isDestroyed()) w.close();
          const wc = views[i] && views[i].webContents;
          if (wc && !wc.isDestroyed()) {
            wc.loadURL(GAME_URL).catch(() => {});
          }
        }, 800);
      }
    }
  };

  w.webContents.on('did-finish-load', checkFinish);

  w.loadURL('https://pokeidle.io/auth/google', { userAgent: GOOGLE_AUTH_UA }).catch(() => {});
}

// ---------- Entrar com Google pelo navegador oficial (Chrome / Edge / Firefox) ----------
async function importGoogleLogin(i) {
  const f = await uiDialog({
    type: 'question',
    title: `Login com Google — ${nameOf(i)}`,
    message: `Entrar com a conta Google na ${nameOf(i)}`,
    detail: 'Como o Google bloqueia logins em aplicativos externos (WebViews), o login é feito com segurança pelo seu navegador:\n\n' +
      'Passo 1: Clique em "Abrir no Navegador" abaixo e faça o login com o Google no seu Chrome/Edge.\n\n' +
      'Passo 2: Quando o jogo abrir no navegador (em https://pokeidle.io/app):\n' +
      '  • Pressione F12 no teclado (ou clique com o botão direito na página > Inspecionar).\n' +
      '  • Vá na aba "Console" e digite este comando:\n' +
      '    copy(localStorage.getItem(\'sessao\'))\n' +
      '  • Pressione Enter (o código do login será copiado sozinho!).\n\n' +
      'Passo 3: Cole o código copiado no campo abaixo e clique em "Aplicar Login".',
    form: [{ id: 'sessao', label: 'Código da sessão', hint: 'Cole aqui o código copiado pelo comando do Console', type: 'textarea', value: '' }],
    buttons: ['Aplicar Login', 'Abrir no Navegador', 'Cancelar'],
    defaultId: 0,
    cancelId: 2,
  });
  if (f.response === 1) {
    shell.openExternal('https://pokeidle.io/auth/google');
    setTimeout(() => importGoogleLogin(i), 1200);
    return;
  }
  if (f.response !== 0 || !f.values || !f.values.sessao) return;
  let raw = f.values.sessao.trim();
  raw = raw.replace(/^["']+|["']+$/g, '').trim();

  const wc = views[i] && views[i].webContents;
  if (!wc || wc.isDestroyed()) return;

  let sessionPayload = null;
  try {
    const data = JSON.parse(raw);
    if (data && (data.token || data.nick)) {
      sessionPayload = JSON.stringify(data);
    } else if (data && data.ls && data.ls.sessao) {
      sessionPayload = typeof data.ls.sessao === 'string' ? data.ls.sessao : JSON.stringify(data.ls.sessao);
    }
  } catch (e) {}

  if (!sessionPayload) {
    const m = raw.match(/sessao=([^&#\s]+)/i);
    sessionPayload = m ? decodeURIComponent(m[1]) : raw;
  }

  if (sessionPayload) {
    await wc.executeJavaScript(`
      try {
        localStorage.setItem('sessao', ${JSON.stringify(sessionPayload)});
        location.href = '/app';
      } catch(e) {}
    `);
    uiDialog({ type: 'info', title: nameOf(i), message: 'Login com Google aplicado com sucesso! A conta agora está conectada.' });
  } else {
    showError(nameOf(i), 'Não encontrei a sessão do jogo no texto informado.');
  }
}

// ---------- Levar o login de uma conta para o Mefislink Lite (Android) ----------
// O login com Google/Cloudflare é recusado dentro de apps no celular. Como aqui a conta já está logada,
// o Mefislink copia o login (cookies do pokeidle.io) e o usuário cola no app do celular.
async function copyLoginForPhone(i) {
  const c = await uiDialog({
    type: 'warning',
    title: 'Login para o celular',
    message: `Copiar o login da ${nameOf(i)}?`,
    detail: 'O texto copiado É o seu login no jogo: quem tiver ele entra na sua conta. Mande só para você mesmo ' +
      '(ex.: WhatsApp "mensagem para mim") e apague a mensagem depois de colar no Mefislink Lite.',
    buttons: ['Copiar', 'Cancelar'],
    defaultId: 0,
    cancelId: 1,
  });
  if (c.response !== 0) return;
  const ses = session.fromPartition(`persist:conta${i + 1}`);
  const list = (await ses.cookies.get({})).filter((k) => /(^|\.)pokeidle\.io$/i.test(String(k.domain).replace(/^\./, '')));
  // o login do jogo pode estar em cookies E no armazenamento da página (localStorage / IndexedDB)
  let store = { ls: {}, idb: [] };
  const wc = views[i] && views[i].webContents;
  if (wc && !wc.isDestroyed()) {
    try { store = JSON.parse(await withTimeout(wc.executeJavaScript(LOGIN_EXPORT_JS), 10000)); } catch {}
  }
  const nLs = Object.keys(store.ls || {}).length;
  const nIdb = (store.idb || []).reduce((s2, d) => s2 + d.stores.reduce((t, st) => t + st.items.length, 0), 0);
  if (!list.length && !nLs && !nIdb) { showError('Login para o celular', 'Esta conta não está logada no jogo.'); return; }
  const texto = JSON.stringify({
    v: 2,
    cookies: list.map((k) => ({ name: k.name, value: k.value, domain: k.domain, path: k.path, secure: k.secure, httpOnly: k.httpOnly, expirationDate: k.expirationDate })),
    ls: store.ls || {},
    idb: store.idb || [],
  });
  clipboard.writeText(texto);
  uiDialog({
    type: texto.length > 60000 ? 'warning' : 'info', title: 'Login para o celular', message: 'Login copiado.',
    detail: `${nameOf(i)}: ${list.length} cookie(s), ${nLs} item(ns) de armazenamento e ${nIdb} registro(s) de banco da página.\n\n` +
      'No Mefislink Lite: escolha a conta, toque em "Login" e cole.' +
      (texto.length > 60000 ? `\n\nO texto ficou grande (${Math.round(texto.length / 1000)} mil letras). Se o WhatsApp cortar, mande como arquivo .txt (cole no Bloco de Notas, salve e envie).` : ''),
  });
}
// lê o armazenamento da página do jogo (prioriza o que parece ser login)
const LOGIN_EXPORT_JS = `(async () => {
  const pri = /auth|token|session|user|login|firebase|sb-|supabase|jwt|account|conta|cred/i;
  const ls = {}; let size = 0;
  const keys = Object.keys(localStorage).sort((a, b) => (pri.test(b) ? 1 : 0) - (pri.test(a) ? 1 : 0));
  for (const k of keys) {
    const v = localStorage.getItem(k);
    if (v == null || v.length > 40000) continue;
    if (!pri.test(k) && size + v.length > 30000) continue;
    ls[k] = v; size += k.length + v.length;
  }
  const idb = [];
  try {
    const dbs = (indexedDB.databases ? await indexedDB.databases() : []).filter((d) => pri.test(d.name || ''));
    for (const d of dbs) {
      const r = await new Promise((res, rej) => { const q = indexedDB.open(d.name); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      const out = { name: d.name, version: r.version, stores: [] };
      for (const sn of r.objectStoreNames) {
        const st = r.transaction(sn, 'readonly').objectStore(sn);
        const vals = await new Promise((res) => { const q = st.getAll(); q.onsuccess = () => res(q.result); q.onerror = () => res([]); });
        const st2 = r.transaction(sn, 'readonly').objectStore(sn);
        const ks = await new Promise((res) => { const q = st2.getAllKeys(); q.onsuccess = () => res(q.result); q.onerror = () => res([]); });
        out.stores.push({ name: sn, keyPath: st.keyPath, autoIncrement: st.autoIncrement, items: vals.slice(0, 200).map((v, n) => ({ key: ks[n], value: v })) });
      }
      r.close();
      idb.push(out);
    }
  } catch (e) {}
  return JSON.stringify({ ls, idb });
})()`;

// ---------- Termos de Uso (aceite obrigatório na 1ª vez e quando os termos mudarem) ----------
// Mude TERMS_VERSION sempre que alterar o texto: todo mundo terá de aceitar de novo.
const TERMS_VERSION = '2';
const TERMS_TEXT = [
  'TERMOS DE USO DO MEFISLINK',
  '',
  '1. O que é o Mefislink',
  'O Mefislink é um programa independente e não oficial, criado por Mefis, que reúne contas do jogo PokeIdle em uma única janela. Ele não tem vínculo com a equipe do PokeIdle, com a Nintendo, Game Freak, Creatures, The Pokémon Company, Twitch, Kick ou Google. Todas as marcas citadas pertencem aos seus donos.',
  '',
  '2. Uso por sua conta e risco',
  'Recursos de suporte (abertura de lives para drops de recompensas, extensões e integrações) podem estar sujeitos às regras do jogo ou das plataformas de transmissão. Cabe a você conferir essas regras antes de usar. Advertências, suspensões, banimentos, perdas de itens, ouro, pontos ou progresso decorrentes do uso do Mefislink são de sua inteira responsabilidade.',
  '',
  '3. Suas contas e a segurança delas',
  'Os logins que você faz no Mefislink (jogo, Twitch, Kick e outros) ficam guardados apenas no seu computador. O desenvolvedor não recebe, não armazena e não tem acesso às suas senhas ou sessões. A segurança das contas é responsabilidade sua, incluindo: manter o computador livre de vírus e programas maliciosos, não compartilhar senhas e não compartilhar os textos de login exportados pelo Mefislink (eles dão acesso à conta).',
  '',
  '4. Seus dados',
  'O Mefislink não envia seus dados pessoais ao desenvolvedor. Para funcionar, ele se comunica diretamente com: pokeidle.io (o jogo e o tracker), Twitch, Kick, Chrome Web Store (extensões) e o endereço de atualizações do Mefislink. Cada um desses serviços tem suas próprias políticas de privacidade.',
  '',
  '5. Sem garantias',
  'O Mefislink foi testado, mas é fornecido "no estado em que se encontra", sem garantia de que funcionará sem erros, sem interrupções ou de que continuará compatível com o jogo e com as plataformas, que podem mudar a qualquer momento.',
  '',
  '6. Limitação de responsabilidade',
  'Na máxima extensão permitida pela lei, o desenvolvedor não se responsabiliza por danos diretos ou indiretos decorrentes do uso ou da impossibilidade de uso do Mefislink, incluindo perda ou invasão de contas, vazamento de dados causado por vírus, programas maliciosos, compartilhamento de logins ou falhas de segurança do seu computador, e ações de terceiros (jogo, plataformas, extensões).',
  '',
  '7. Extensões de terceiros',
  'As extensões que o Mefislink baixa da Chrome Web Store são feitas por terceiros. O desenvolvedor do Mefislink não controla nem responde pelo funcionamento delas. Você pode desativá-las em Ajuda > Extensões.',
  '',
  '8. Atualizações',
  'O Mefislink procura e instala atualizações assinadas pelo desenvolvedor. Ao usar o programa, você concorda em recebê-las.',
  '',
  '9. Mudanças nestes termos',
  'Estes termos podem mudar. Quando isso acontecer, o Mefislink pedirá um novo aceite. Se você não concordar, deve parar de usar o programa.',
  '',
  'Ao clicar em "Aceitar", você declara que leu, entendeu e concorda com estes Termos de Uso.',
].join('\n');
const termsFile = () => path.join(app.getPath('userData'), 'termos.json');
const termsAccepted = () => { try { return JSON.parse(fs.readFileSync(termsFile(), 'utf8')).versao === TERMS_VERSION; } catch { return false; } };
async function askTerms() {
  if (termsAccepted()) return true;
  for (;;) {
    const r = await uiDialog({
      type: 'info',
      title: 'Termos de Uso',
      message: 'Antes de começar, leia e aceite os Termos de Uso',
      detail: TERMS_TEXT,
      form: [{ id: 'li', label: 'Li e aceito os Termos de Uso', type: 'check', value: false }],
      buttons: ['Aceitar', 'Recusar e sair'],
      defaultId: 0,
      cancelId: 1,
    });
    if (r.response !== 0) { app.quit(); return false; }
    if (r.values && r.values.li) {
      try { fs.writeFileSync(termsFile(), JSON.stringify({ versao: TERMS_VERSION, em: new Date().toISOString(), app: APP_VERSION })); } catch {}
      return true;
    }
    await uiDialog({ type: 'warning', title: 'Termos de Uso', message: 'Marque "Li e aceito os Termos de Uso" para continuar.' });
  }
}
function showTerms() {
  uiDialog({ type: 'info', title: 'Termos de Uso', message: 'Termos de Uso do Mefislink', detail: TERMS_TEXT });
}

// ---------- Janela ----------
function createWindow() {
  loadRef();
  loadNicks();
  loadAuto();
  loadLives();
  loadLearnedChannels();
  win = new BaseWindow({
    width: 1600, height: 900, title: APP_NAME, backgroundColor: '#15151a',
    titleBarStyle: 'hidden', // esconde a barra nativa (título + menu)
    titleBarOverlay: { color: TITLE_BG, symbolColor: TITLE_FG, height: TITLE_H }, // mantém min/max/fechar
  });

  views = ACCOUNTS.map((name, i) => {
    const ses = session.fromPartition(`persist:conta${i + 1}`);
    applyGoogleLoginFix(ses);

    const view = new WebContentsView({
      webPreferences: {
        partition: `persist:conta${i + 1}`, // cookies/login próprios de cada conta
        backgroundThrottling: false,        // não pausa quando a view não está visível
      },
    });

    // Permite que popups de autenticação (como o login do Google do PokeIdle) abram com a sessão da conta
    view.webContents.setWindowOpenHandler(({ url }) => {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          autoHideMenuBar: true,
          webPreferences: {
            partition: `persist:conta${i + 1}`,
            nodeIntegration: false,
            contextIsolation: true,
          },
        },
      };
    });

    view.webContents.on('did-create-window', (childWin) => {
      applyGoogleLoginFix(childWin.webContents.session);
      childWin.webContents.on('did-start-navigation', (_, url) => {
        if (/accounts\.google\.com/i.test(url)) {
          childWin.webContents.setUserAgent(GOOGLE_AUTH_UA);
        } else if (/pokeidle\.io\/app/i.test(url) || /pokeidle\.io\/auth\/google\/retorno/i.test(url)) {
          setTimeout(async () => {
            const sess = await childWin.webContents.executeJavaScript("localStorage.getItem('sessao')").catch(() => null);
            if (sess) {
              if (!childWin.isDestroyed()) childWin.close();
              view.webContents.loadURL(GAME_URL).catch(() => {});
            }
          }, 800);
        }
      });
      childWin.webContents.on('dom-ready', () => {
        childWin.webContents.executeJavaScript(`
          try {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          } catch(e) {}
        `).catch(() => {});
      });
    });

    view.webContents.on('did-fail-load', () => {}); // ignora recursos bloqueados (ex: tracker)
    // ignora o "tem certeza que quer sair desta página?" do jogo (ele bloqueava o recarregar)
    view.webContents.on('will-prevent-unload', (e) => e.preventDefault());
    // se a página da conta travar de vez ou fechar sozinha, carrega de novo
    view.webContents.on('render-process-gone', (_, d) => {
      if (d.reason !== 'clean-exit' && !view.webContents.isDestroyed()) setTimeout(() => view.webContents.loadURL(GAME_URL).catch(() => {}), 1000);
    });
    // mostra na barra que a conta está carregando (ícone girando)
    view.webContents.on('did-start-loading', () => { if (!loading[i]) { loading[i] = true; sendState(); } });
    view.webContents.on('did-stop-loading', () => { if (loading[i]) { loading[i] = false; sendState(); } });
    view.webContents.on('did-start-navigation', (_, url) => {
      if (/accounts\.google\.com/i.test(url)) {
        view.webContents.setUserAgent(GOOGLE_AUTH_UA);
      }
    });
    view.webContents.on('did-finish-load', layout);
    view.webContents.on('did-finish-load', () => {
      const cur = view.webContents.getURL();
      if (!/accounts\.google\.com/i.test(cur)) {
        view.webContents.setUserAgent(CLEAN_UA);
      }
      setTimeout(() => readNick(i), 2500);
    });
    view.webContents.on('did-navigate', layout);
    view.webContents.on('dom-ready', () => {
      ecoCss[i] = null;
      applyLevel(i);
      view.webContents.insertCSS('.pih-cab .pih-apoiar, #pih-apoio, .pih-apoiar { display: none !important; }').catch(() => {});
      view.webContents.executeJavaScript(`
        try {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        } catch(e) {}
      `).catch(() => {});
    });
    devKeys(view.webContents);
    view.webContents.loadURL(GAME_URL);
    win.contentView.addChildView(view);
    return view;
  });

  bars = ACCOUNTS.map((name, i) => {
    const b = new WebContentsView({
      webPreferences: { preload: path.join(__dirname, 'preload.js') },
    });
    devKeys(b.webContents);
    b.webContents.loadFile(path.join(__dirname, 'bar.html'), { query: { i: String(i) } });
    win.contentView.addChildView(b);
    return b;
  });

  titleBar = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  titleBar.setBackgroundColor('#00000000'); // transparente: quando o menu abre, o jogo continua aparecendo atrás
  devKeys(titleBar.webContents);
  titleBar.webContents.loadFile(path.join(__dirname, 'bar.html'), { query: { mode: 'title' } });
  // termos de uso: pede o aceite assim que a barra de cima (que desenha o pop-up) estiver pronta
  titleBar.webContents.once('did-finish-load', () => setTimeout(askTerms, 600));
  win.contentView.addChildView(titleBar);

  applyWindowIcon(); // ícone personalizado também na barra de tarefas

  win.on('resize', layout);
  win.on('enter-full-screen', layout);
  win.on('leave-full-screen', layout);

  // Fecha para a bandeja (ícones ocultos): ao clicar no X, a janela é apenas ocultada
  // e o aplicativo continua rodando em segundo plano.
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
      if (!hasNotifiedTray && tray) {
        hasNotifiedTray = true;
        try {
          tray.displayBalloon({
            title: 'Mefislink',
            content: 'O Mefislink continua rodando em segundo plano nos ícones ocultos. Clique no ícone para reabrir.',
          });
        } catch {}
      }
    }
  });

  win.on('closed', () => {
    win = null;
    if (tray) {
      try { tray.destroy(); } catch {}
      tray = null;
    }
    if (!isQuitting) {
      isQuitting = true;
      app.quit();
    }
  });

  layout();

  buildMenu();

  startAutoBuyTimer();
  startNickTimer();

  // começa com as contas 2, 3 e 4 sem som
  muted.forEach((m, i) => views[i].webContents.setAudioMuted(m));
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.whenReady().then(async () => {
  applyGoogleLoginFix(session.defaultSession);
  // extensões: carrega as cópias locais antes das contas abrirem e procura atualização em segundo plano
  const extFaltando = await loadLocalExtensions();
  createWindow();
  createTray();
  updateExtensions(extFaltando);
  setTimeout(checkLives, 3000); // já verifica logo ao abrir
  setInterval(checkLives, LIVE_CHECK_MIN * 60 * 1000);
  sampleUsage(); setInterval(sampleUsage, 5000); // mede CPU/memória de cada conta
  // sincroniza lives com o estado do PokeIdle a cada 30 segundos
  setInterval(async () => { if (LIVE_PLATS().length) checkLives(); }, 30 * 1000);
  setInterval(learnFromApi, 10 * 60 * 1000);
  views.forEach((_, i) => watchGameApi(i));
  views.forEach((_, i) => watchKickRequests(i)); // Kick leve: corta imagens, fontes e rastreadores nas lives
  setTimeout(pvpCollectAll, 60 * 1000); // PvP: guarda as partidas novas de cada conta
  setTimeout(() => checkOnlineUpdate(false), 20 * 1000); // atualização online: confere ao abrir...
  setInterval(() => checkOnlineUpdate(false), UPDATE_CHECK_HOURS * 3600 * 1000); // ...e de tempos em tempos
  setInterval(pollKickPoints, KICK_POLL_SEC * 1000); // pontos da Kick em tempo real
  setInterval(pvpCollectAll, PVP_EVERY_MIN * 60 * 1000);
});
app.on('window-all-closed', () => {
  if (isQuitting) {
    app.quit();
  }
});