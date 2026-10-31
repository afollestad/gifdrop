// Opens a URL in a browser on whichever OS this runs on, and returns a function
// that closes it. Set CHROME_PATH or FIREFOX_PATH to use a specific binary.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

const CHROME_PATHS = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
    win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
};

const FIREFOX_PATHS = {
    darwin: ['/Applications/Firefox.app/Contents/MacOS/firefox'],
    linux: ['firefox'],
    win32: ['C:\\Program Files\\Mozilla Firefox\\firefox.exe'],
};

const FIREFOX_PREFS = `
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
`;

function isAvailable(path) {
    if (isAbsolute(path)) return existsSync(path);
    return spawnSync('which', [path], { stdio: 'ignore' }).status === 0;
}

function findBinary(name, override, candidates) {
    const found = [override, ...(candidates[process.platform] ?? [])].find((path) => path && isAvailable(path));
    if (!found) throw new Error(`${name} wasn't found. Set its path in the environment.`);
    return found;
}

function spawnWithProfile(binary, args, prepareProfile) {
    const profile = mkdtempSync(join(tmpdir(), 'gifdrop-browser-'));
    prepareProfile?.(profile);
    const child = spawn(binary, args(profile), { stdio: 'ignore' });
    return () => {
        child.kill();
        // The browser can still be writing as it exits, and a leftover temp folder
        // shouldn't fail a run that passed.
        try {
            rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
        } catch (error) {
            console.warn(`Couldn't remove ${profile}: ${error.message}`);
        }
    };
}

function openChrome(url) {
    const binary = findBinary('Chrome', process.env.CHROME_PATH, CHROME_PATHS);
    // CI runners can't start Chrome's sandbox.
    const sandbox = process.env.CI ? ['--no-sandbox'] : [];
    return spawnWithProfile(binary, (profile) => ['--headless=new', ...sandbox, `--user-data-dir=${profile}`, '--no-first-run', url]);
}

function openFirefox(url) {
    const binary = findBinary('Firefox', process.env.FIREFOX_PATH, FIREFOX_PATHS);
    return spawnWithProfile(
        binary,
        (profile) => ['--headless', '--no-remote', '--profile', profile, url],
        (profile) => writeFileSync(join(profile, 'user.js'), FIREFOX_PREFS),
    );
}

function openSafari(url) {
    execFileSync('open', ['-a', 'Safari', url]);
    return () => {};
}

// Takes the newest iOS runtime's first iPhone, unless told which simulator to use.
function findSimulator() {
    const { devices } = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], { encoding: 'utf8' }));
    const runtimes = Object.keys(devices).filter((runtime) => runtime.includes('iOS')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const runtime of runtimes) {
        const iPhone = devices[runtime].find((device) => device.name.startsWith('iPhone'));
        if (iPhone) return iPhone.udid;
    }
    throw new Error('No iPhone simulator is available.');
}

function openIosSimulator(url, requestedUdid) {
    const udid = requestedUdid ?? findSimulator();
    // Boots it if needed, since an idle simulator can shut itself down.
    execFileSync('xcrun', ['simctl', 'bootstatus', udid, '-b'], { stdio: 'ignore' });
    execFileSync('xcrun', ['simctl', 'openurl', udid, url]);
    return () => {};
}

// `spec` is chrome, firefox, safari, ios, or ios=<simulator udid>.
export function openBrowser(spec, url) {
    const [name, detail] = spec.split('=');
    switch (name) {
        case 'chrome': return openChrome(url);
        case 'firefox': return openFirefox(url);
        case 'safari': return openSafari(url);
        case 'ios': return openIosSimulator(url, detail);
        default: throw new Error(`Unknown browser ${spec}`);
    }
}
