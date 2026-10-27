import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as sharp from 'sharp';

export const png = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: { r: 120, g: 80, b: 200 } } })
        .png()
        .toBuffer();

export const jpeg = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: { r: 20, g: 160, b: 90 } } })
        .jpeg()
        .toBuffer();

// анимированный GIF из 3 кадров
export const gif = async (width: number, height: number) => {
    const frame = (r: number) =>
        sharp({ create: { width, height, channels: 4, background: { r, g: 0, b: 0, alpha: 1 } } })
            .raw()
            .toBuffer();
    const frames = Buffer.concat([await frame(255), await frame(128), await frame(30)]);
    return sharp(frames, { raw: { width, height: height * 3, channels: 4, pageHeight: height } })
        .gif({ delay: [100, 100, 100] })
        .toBuffer();
};

const ffmpeg = process.env.FFMPEG_PATH || ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find(existsSync);
export const hasFfmpeg = !!ffmpeg;

// крошечный тестовый ролик: args — параметры кодирования ffmpeg
export function video(name: string, args: string[]): Buffer {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-video-'));
    const out = join(dir, name);
    execFileSync(ffmpeg, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=640x360:rate=24:duration=1',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1',
        ...args,
        out,
    ]);
    return readFileSync(out);
}
