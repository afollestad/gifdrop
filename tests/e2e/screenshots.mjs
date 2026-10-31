// Captures every screen at phone, tablet and desktop widths in both themes, for checking
// layouts by eye. Drives Chrome over the DevTools protocol, using generated footage:
//   node tests/e2e/screenshots.mjs [output folder]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? join(HERE, 'out/screens'));
const VIDEO = join(HERE, '../fixtures/motion.mp4');
const SIZES = [['phone', 390, 844, true], ['small', 320, 640, true], ['tablet', 768, 1024, true], ['desktop', 1280, 800, false]];
const THEMES = ['light', 'dark'];

const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'google-chrome', 'chromium']
    .find((path) => path && (path.startsWith('/') ? existsSync(path) : spawnSync('which', [path], { stdio: 'ignore' }).status === 0));

mkdirSync(OUT, { recursive: true });

function launch() {
    const profile = mkdtempSync(join(tmpdir(), 'gifdrop-screens-'));
    const child = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const endpoint = new Promise((done, fail) => {
        let text = '';
        child.stderr.on('data', (chunk) => {
            text += chunk;
            const match = /DevTools listening on (ws:\S+)/.exec(text);
            if (match) done(match[1]);
        });
        child.on('exit', () => fail(new Error('Chrome exited')));
    });
    return { endpoint, close: () => { child.removeAllListeners('exit'); child.kill(); try { rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch {} } };
}

function connect(url) {
    const socket = new WebSocket(url);
    let nextId = 1;
    const pending = new Map();
    socket.onmessage = ({ data }) => {
        const message = JSON.parse(data);
        if (!message.id) return;
        const { resolve: done, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else done(message.result);
    };
    return new Promise((ready) => {
        socket.onopen = () => ready({
            send: (method, params = {}, sessionId) => new Promise((done, reject) => {
                const id = nextId++;
                pending.set(id, { resolve: done, reject });
                socket.send(JSON.stringify({ id, method, params, sessionId }));
            }),
            close: () => socket.close(),
        });
    });
}

const server = await startServer();
const chrome = launch();
const cdp = await connect(await chrome.endpoint);
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
const send = (method, params) => cdp.send(method, params, sessionId);
await send('Page.enable');
await send('DOM.enable');
await send('Runtime.enable');

const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
};

const until = async (expression, what, timeoutMs = 30000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        await new Promise((done) => setTimeout(done, 50));
    }
    throw new Error(`Timed out waiting for ${what}`);
};

const shoot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: undefined });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    const overflow = await evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    if (overflow > 0) console.log(`  ${name}: page scrolls sideways by ${overflow}px`);
};

const pickVideo = async () => {
    const { root } = await send('DOM.getDocument');
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-input' });
    await send('DOM.setFileInputFiles', { nodeId, files: [VIDEO] });
};

try {
    for (const [sizeName, width, height, mobile] of SIZES) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
        for (const theme of THEMES) {
            await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
            await send('Page.navigate', { url: `http://localhost:${server.port}/` });
            await until(`document.readyState === 'complete' && document.body.dataset.view === 'empty'`, 'the page');
            const name = `${sizeName}-${theme}`;
            await shoot(`${name}-1-empty`);

            await pickVideo();
            await until(`document.body.dataset.screen === 'editing' && /^About/.test(document.getElementById('estimate-value').textContent)`, 'the editor');
            await shoot(`${name}-2-editing`);

            await evaluate(`(() => { const radio = document.querySelector('input[name="aspect"][value="1"]'); radio.click(); })()`);
            await until(`!document.getElementById('crop-layer').hidden`, 'the crop tools');
            await shoot(`${name}-3-crop`);

            await evaluate(`document.getElementById('convert-button').click()`);
            await until(`document.body.dataset.screen === 'converting' && Number(document.getElementById('progress-bar').value) > 0.2`, 'progress');
            await shoot(`${name}-4-converting`);
            await until(`document.body.dataset.screen === 'done'`, 'the result', 60000);
            await shoot(`${name}-5-done`);
            console.log(`${name}: done`);
        }
    }
} finally {
    cdp.close();
    chrome.close();
    server.close();
}
console.log(`Saved to ${OUT}`);
