/* AdaptaSys Painel (Windows): abre o painel de licenças numa janela própria e se atualiza sozinho.
   - O painel em si é sempre a versão mais nova publicada no GitHub Pages (nada fica "velho" no computador).
   - O programa (esta janela) busca atualização no GitHub Releases ao abrir e a cada 4 horas. */
const { app, BrowserWindow, Menu, shell, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');

const URL_PAINEL = 'https://adaptasystemas.github.io/licensekey/painel/';
const ORIGEM = new URL(URL_PAINEL).origin;
app.setAppUserModelId('br.com.adaptasys.painel');

const temTrava = app.requestSingleInstanceLock();
if (!temTrava) { app.quit(); }

let win = null;
const estadoFile = () => path.join(app.getPath('userData'), 'janela.json');
function lerEstado() { try { return JSON.parse(fs.readFileSync(estadoFile(), 'utf8')); } catch (e) { return {}; } }
function gravarEstado() {
  if (!win || win.isDestroyed()) return;
  try { const b = win.getNormalBounds(); fs.writeFileSync(estadoFile(), JSON.stringify({ ...b, max: win.isMaximized() })); } catch (e) {}
}

function criarJanela() {
  const s = lerEstado();
  win = new BrowserWindow({
    width: s.width || 1280, height: s.height || 800, x: s.x, y: s.y, minWidth: 380, minHeight: 520,
    title: 'AdaptaSys · Painel de licenças', backgroundColor: '#e9f0fb', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'adaptasys.ico'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  if (s.max) win.maximize();
  win.on('close', gravarEstado);
  win.on('page-title-updated', e => e.preventDefault());

  /* links de fora do painel (WhatsApp, etc.) abrem no navegador do Windows */
  const fora = u => { try { return new URL(u).origin !== ORIGEM; } catch (e) { return true; } };
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, u) => { if (u.startsWith('file:')) return; if (fora(u)) { e.preventDefault(); if (/^https?:/i.test(u)) shell.openExternal(u); } });

  /* sem internet: tela amigável com botão para tentar de novo */
  win.webContents.on('did-fail-load', (e, code, desc, u, principal) => {
    if (!principal || code === -3) return;
    win.loadFile(path.join(__dirname, 'offline.html'));
  });
  carregar();
}
function carregar() { win.loadURL(URL_PAINEL).catch(() => {}); }

/* ---------- atualização do programa ---------- */
let manual = false;
function iniciarAtualizador() {
  if (!app.isPackaged) return null;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', i => { if (manual) dialog.showMessageBox(win, { type: 'info', message: 'Nova versão ' + i.version, detail: 'Baixando agora. Avisamos quando terminar.' }); });
    autoUpdater.on('update-not-available', () => { if (manual) dialog.showMessageBox(win, { type: 'info', message: 'Você já está na versão mais recente (' + app.getVersion() + ').' }); manual = false; });
    autoUpdater.on('update-downloaded', i => {
      manual = false;
      dialog.showMessageBox(win, { type: 'info', buttons: ['Reiniciar agora', 'Depois'], defaultId: 0, cancelId: 1, message: 'AdaptaSys Painel ' + i.version + ' pronto', detail: 'Reinicie para usar a nova versão. Se escolher "Depois", ela é instalada quando você fechar o programa.' })
        .then(r => { if (r.response === 0) autoUpdater.quitAndInstall(); });
    });
    autoUpdater.on('error', e => { if (manual) dialog.showMessageBox(win, { type: 'warning', message: 'Não foi possível verificar atualização agora.', detail: 'Confira a internet e tente de novo mais tarde.' }); manual = false; });
    const chk = () => autoUpdater.checkForUpdates().catch(() => {});
    setTimeout(chk, 15000); setInterval(chk, 4 * 3600 * 1000);
    return autoUpdater;
  } catch (e) { return null; }
}

app.whenReady().then(async () => {
  if (!temTrava) return;
  try { await session.defaultSession.clearCache(); } catch (e) {}   /* sempre pega a versão mais nova do painel */
  const upd = iniciarAtualizador();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Painel', submenu: [
      { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: () => win && carregar() },
      { label: 'Recarregar do zero', accelerator: 'CmdOrCtrl+Shift+R', click: () => { if (win) { win.webContents.session.clearCache().finally(carregar); } } },
      { label: 'Tela cheia', accelerator: 'F11', click: () => win && win.setFullScreen(!win.isFullScreen()) },
      { type: 'separator' },
      { label: 'Aumentar', accelerator: 'CmdOrCtrl+Plus', click: () => win && win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5) },
      { label: 'Diminuir', accelerator: 'CmdOrCtrl+-', click: () => win && win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5) },
      { label: 'Tamanho normal', accelerator: 'CmdOrCtrl+0', click: () => win && win.webContents.setZoomLevel(0) },
      { type: 'separator' },
      { label: 'Verificar atualização', click: () => { if (!upd) { dialog.showMessageBox(win, { type: 'info', message: 'Versão ' + app.getVersion(), detail: 'A atualização automática funciona só no programa instalado.' }); return; } manual = true; upd.checkForUpdates().catch(() => { manual = false; }); } },
      { label: 'Sobre', click: () => dialog.showMessageBox(win, { type: 'info', message: 'AdaptaSys Painel', detail: 'Versão ' + app.getVersion() + '\nSistemas Inteligentes' }) },
      { type: 'separator' },
      { label: 'Sair', role: 'quit' } ] }
  ]));
  criarJanela();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
