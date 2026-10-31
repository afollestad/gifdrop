// Runs one real video through a spread of settings, for judging speed, estimates and
// quality on footage the fixtures can't stand in for.
import { convert } from '/scripts/app/converter.js';
import { fullCrop } from '/scripts/app/crop-math.js';
import { estimate } from '/scripts/app/estimator.js';
import { SIZE_LIMITS } from '/scripts/app/limits.js';
import { outputSize, planFrames } from '/scripts/app/plan.js';
import { canSeekNearEnd } from '/scripts/app/video-seeker.js';
import { isHdr, loadVideo, releaseVideo } from '/scripts/app/video-source.js';

const reportName = new URLSearchParams(location.search).get('report') ?? 'footage';

const SETTINGS = [
    { name: 'default', width: 480, seconds: 5, quality: 'balanced' },
    { name: 'small', width: 480, seconds: 5, quality: 'small' },
    { name: 'high', width: 480, seconds: 5, quality: 'high' },
    { name: 'narrow', width: 270, seconds: 5, quality: 'balanced' },
    { name: 'boomerang', width: 270, seconds: 3, quality: 'balanced', loop: 'boomerang' },
    { name: '2x speed', width: 270, seconds: 8, quality: 'balanced', speed: 2 },
    { name: 'from the middle', width: 270, seconds: 4, start: 0.5, quality: 'balanced' },
    { name: 'whole clip', width: 240, seconds: Infinity, quality: 'balanced', fps: 10 },
];

function log(line) {
    document.getElementById('log').textContent += `${line}\n`;
}

async function post(name, ext, body) {
    await fetch(`/report?name=${encodeURIComponent(name)}&ext=${ext}`, { method: 'POST', body });
}

const seconds = (began) => Number(((performance.now() - began) / 1000).toFixed(2));

const video = document.createElement('video');
document.getElementById('stage').append(video);

const report = { userAgent: navigator.userAgent, results: [] };
try {
    const fetched = performance.now();
    const blob = await (await fetch('/footage')).blob();
    report.fetchSeconds = seconds(fetched);
    report.fileBytes = blob.size;
    const url = URL.createObjectURL(new File([blob], 'footage', { type: blob.type }));

    const began = performance.now();
    await loadVideo(video, url);
    report.loadSeconds = seconds(began);
    report.size = [video.videoWidth, video.videoHeight];
    report.duration = video.duration;
    report.hdr = isHdr(video);

    const checked = performance.now();
    report.seeksToEnd = await canSeekNearEnd(video);
    report.seekCheckSeconds = seconds(checked);
    log(JSON.stringify(report));

    const crop = fullCrop(video.videoWidth, video.videoHeight);
    for (const [index, setting] of SETTINGS.entries()) {
        const { name, width, quality, loop = 'forever', speed = 1, fps = 15 } = setting;
        const trimStart = (setting.start ?? 0) * video.duration;
        const trimEnd = Math.min(video.duration, trimStart + setting.seconds);
        const plan = planFrames({ trimStart, trimEnd, fps, speed });
        const size = outputSize(crop, width, SIZE_LIMITS);
        const result = { name, index, size, loop, planned: plan.times.length };
        log(`Running ${name}...`);
        try {
            const estimated = performance.now();
            result.estimate = await estimate({ video, plan, crop, size, quality, loop });
            result.estimateSeconds = seconds(estimated);

            const converted = performance.now();
            const output = await convert({ video, plan, crop, size, quality, loop });
            result.seconds = seconds(converted);
            result.bytes = output.bytes;
            result.frames = output.frames;
            result.stats = output.stats;
            await post(`${reportName}-${index}`, 'gif', output.blob);
        } catch (error) {
            result.error = String(error);
        }
        report.results.push(result);
        await post(`${reportName}-progress`, 'json', JSON.stringify(report));
    }
    releaseVideo(video);
    URL.revokeObjectURL(url);
} catch (error) {
    report.error = String(error);
}
await post(reportName, 'json', JSON.stringify(report));
log('Done.');
