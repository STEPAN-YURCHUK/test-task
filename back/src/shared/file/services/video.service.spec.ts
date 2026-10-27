import { execFileSync } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { VideoService } from './video.service';

const hasFfmpeg = (() => {
    try {
        execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
        execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
})();

const createS3 = () => ({
    buildKey: jest.fn((...parts: string[]) => ['t', ...parts].join('/')),
    putPublicObject: jest.fn().mockResolvedValue(undefined),
    putPublicObjectFromPath: jest.fn().mockResolvedValue(undefined),
});

// Таблица совместимости с iOS/macOS — чистая логика, ffmpeg не нужен
describe('VideoService.isAppleCompatible', () => {
    const service = new VideoService(createS3() as any);
    const probe = (format = 'mov,mp4,m4a,3gp,3g2,mj2') => ({ streams: [], format: { format_name: format } });
    const video = (extra = {}) => ({
        codec_type: 'video',
        codec_name: 'h264',
        profile: 'High',
        pix_fmt: 'yuv420p',
        width: 1280,
        height: 720,
        ...extra,
    });
    const aac = { codec_type: 'audio', codec_name: 'aac', channels: 2 };

    it.each([
        ['H.264 High yuv420p + AAC в MP4', probe(), video(), aac, true],
        ['без звука', probe(), video(), undefined, true],
        ['Constrained Baseline, yuvj420p', probe(), video({ profile: 'Constrained Baseline', pix_fmt: 'yuvj420p' }), aac, true],
        ['вертикальное 720x1280', probe(), video({ width: 720, height: 1280 }), aac, true],
        ['MKV-контейнер', probe('matroska,webm'), video(), aac, false],
        ['HEVC', probe(), video({ codec_name: 'hevc', profile: 'Main' }), aac, false],
        ['10 бит', probe(), video({ pix_fmt: 'yuv420p10le' }), aac, false],
        ['4:2:2', probe(), video({ pix_fmt: 'yuv422p' }), aac, false],
        ['High 4:4:4 профиль', probe(), video({ profile: 'High 4:4:4 Predictive' }), aac, false],
        ['без профиля', probe(), video({ profile: undefined }), aac, false],
        ['без pix_fmt', probe(), video({ pix_fmt: undefined }), aac, false],
        ['контейнер только mov', probe('mov'), video(), aac, true],
        ['1080p больше лимита', probe(), video({ width: 1920, height: 1080 }), aac, false],
        ['Opus-звук', probe(), video(), { codec_type: 'audio', codec_name: 'opus' }, false],
        ['AAC 5.1', probe(), video(), { ...aac, channels: 6 }, false],
        ['AAC без channels — считается стерео', probe(), video(), { codec_type: 'audio', codec_name: 'aac' }, true],
    ])('%s → %s', (_, p, v, a, expected) => {
        expect(service.isAppleCompatible(p as any, v as any, a as any)).toBe(expected);
    });
});

const describeFfmpeg = hasFfmpeg ? describe : describe.skip;
if (!hasFfmpeg) console.warn('ffmpeg/ffprobe не найдены — интеграционные тесты VideoService пропущены');

describeFfmpeg('VideoService с настоящим ffmpeg', () => {
    jest.setTimeout(120_000);
    let dir: string;
    const make = (name: string, args: string[]) => {
        execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, join(dir, name)]);
        return join(dir, name);
    };
    const probeOut = (path: string) =>
        JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', path]).toString()).streams;
    // атомы верхнего уровня MP4: при faststart moov идёт до mdat
    const topAtoms = (buf: Buffer) => {
        const atoms: string[] = [];
        for (let o = 0; o + 8 <= buf.length && atoms.length < 6;) {
            const size = buf.readUInt32BE(o);
            atoms.push(buf.toString('ascii', o + 4, o + 8));
            if (size < 8) break;
            o += size;
        }
        return atoms;
    };

    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), 'video-spec-'));
    });
    afterAll(async () => rm(dir, { recursive: true, force: true }));
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    const runCase = async (source: string) => {
        const s3 = createS3();
        const work = await mkdtemp(join(dir, 'work-'));
        const result = await new VideoService(s3 as any).processAndUpload(source, work, 'vid-1');
        const output = await readFile(join(work, 'output.mp4'));
        return { s3, result, output, outPath: join(work, 'output.mp4') };
    };

    it('совместимый H.264/AAC MP4 → перепаковка без перекодирования', async () => {
        const src = make('compat.mp4', [
            '-f',
            'lavfi',
            '-i',
            'testsrc2=size=320x240:rate=15:duration=1',
            '-f',
            'lavfi',
            '-i',
            'sine=duration=1',
            '-c:v',
            'libx264',
            '-profile:v',
            'main',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-shortest',
        ]);
        const { result, output, s3, outPath } = await runCase(src);

        expect(result.transcoded).toBe(false);
        expect(result).toMatchObject({
            type: 'VIDEO',
            key: 't/files/videos/vid-1.mp4',
            mimeType: 'video/mp4',
            width: 320,
            height: 240,
            variants: null,
        });
        expect(result.video).toEqual({
            duration: expect.any(Number),
            posterPath: 't/files/videos/posters/vid-1.jpg',
            webpPosterPath: 't/files/videos/posters/vid-1.webp',
        });
        expect(result.video.duration).toBeCloseTo(1, 0);
        expect(topAtoms(output).indexOf('moov')).toBeLessThan(topAtoms(output).indexOf('mdat'));
        expect(probeOut(outPath)[0]).toMatchObject({ codec_name: 'h264', profile: 'Main', codec_tag_string: 'avc1' });
        expect(s3.putPublicObjectFromPath).toHaveBeenCalledWith('t/files/videos/vid-1.mp4', expect.any(String), 'video/mp4');
        expect(s3.putPublicObject).toHaveBeenCalledWith('t/files/videos/posters/vid-1.jpg', expect.any(Buffer), 'image/jpeg');
        expect(s3.putPublicObject).toHaveBeenCalledWith('t/files/videos/posters/vid-1.webp', expect.any(Buffer), 'image/webp');
    });

    it('HEVC 10 бит в MKV + Opus → H.264 High yuv420p avc1 + AAC, faststart, ужимается до 1280x720', async () => {
        const src = make('hevc.mkv', [
            '-f',
            'lavfi',
            '-i',
            'testsrc2=size=1920x1080:rate=10:duration=1',
            '-f',
            'lavfi',
            '-i',
            'sine=duration=1',
            '-c:v',
            'libx265',
            '-x265-params',
            'log-level=error',
            '-pix_fmt',
            'yuv420p10le',
            '-c:a',
            'libopus',
            '-shortest',
        ]);
        const { result, output, outPath } = await runCase(src);

        expect(result.transcoded).toBe(true);
        expect(result).toMatchObject({ width: 1280, height: 720 });
        const [video, audio] = probeOut(outPath);
        expect(video).toMatchObject({ codec_name: 'h264', profile: 'High', pix_fmt: 'yuv420p', codec_tag_string: 'avc1' });
        expect(audio).toMatchObject({ codec_name: 'aac', channels: 2 });
        expect(topAtoms(output).indexOf('moov')).toBeLessThan(topAtoms(output).indexOf('mdat'));
    });

    it('VP9 WebM без звука → H.264, нечётные размеры становятся чётными', async () => {
        const src = make('vp9.webm', [
            '-f',
            'lavfi',
            '-i',
            'testsrc2=size=321x241:rate=10:duration=1',
            '-c:v',
            'libvpx-vp9',
            '-b:v',
            '200k',
        ]);
        const { result, outPath } = await runCase(src);
        expect(result.transcoded).toBe(true);
        expect(result.width % 2).toBe(0);
        expect(result.height % 2).toBe(0);
        const streams = probeOut(outPath);
        expect(streams).toHaveLength(1);
        expect(streams[0].codec_name).toBe('h264');
    });

    it('вертикальное видео с поворотом при перепаковке — ширина и высота меняются местами', async () => {
        const plain = make('plain.mp4', [
            '-f',
            'lavfi',
            '-i',
            'testsrc2=size=640x360:rate=10:duration=1',
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
        ]);
        const rotated = join(dir, 'rotated.mp4');
        execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-display_rotation', '90', '-i', plain, '-c', 'copy', rotated]);
        const { result } = await runCase(rotated);
        expect(result.transcoded).toBe(false);
        expect(result).toMatchObject({ width: 360, height: 640 });
    });

    it('вертикальное HEVC с поворотом при перекодировании — поворот «запекается»', async () => {
        const plain = make('plain-hevc.mov', [
            '-f',
            'lavfi',
            '-i',
            'testsrc2=size=640x360:rate=10:duration=1',
            '-c:v',
            'libx265',
            '-x265-params',
            'log-level=error',
            '-tag:v',
            'hvc1',
        ]);
        const rotated = join(dir, 'rotated-hevc.mov');
        execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-display_rotation', '90', '-i', plain, '-c', 'copy', rotated]);
        const { result } = await runCase(rotated);
        expect(result.transcoded).toBe(true);
        expect(result.height).toBeGreaterThan(result.width);
    });

    it('не видео → 422 file_video_invalid', async () => {
        const fake = join(dir, 'fake.mp4');
        await writeFile(fake, 'not a video');
        await expect(new VideoService(createS3() as any).processAndUpload(fake, dir, 'x')).rejects.toMatchObject({
            message: 'file_video_invalid',
            status: 422,
        });
    });

    it('только звук (нет видеодорожки) → file_video_invalid', async () => {
        const audio = make('audio.m4a', ['-f', 'lavfi', '-i', 'sine=duration=1', '-c:a', 'aac']);
        await expect(new VideoService(createS3() as any).processAndUpload(audio, dir, 'x')).rejects.toThrow('file_video_invalid');
    });

    it('длиннее 5 минут → file_video_too_long (длительность из probe)', async () => {
        const service = new VideoService(createS3() as any);
        jest.spyOn(service, 'probe').mockResolvedValue({
            streams: [{ codec_type: 'video', codec_name: 'h264' }],
            format: { format_name: 'mp4', duration: '301' },
        } as any);
        await expect(service.processAndUpload('/x.mp4', dir, 'x')).rejects.toThrow('file_video_too_long');
    });

    it('без duration в probe — длительность 0', async () => {
        const service = new VideoService(createS3() as any);
        const src = make('nodur.mp4', [
            '-f',
            'lavfi',
            '-i',
            'testsrc2=size=160x120:rate=10:duration=1',
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
        ]);
        const realProbe = service.probe.bind(service);
        jest.spyOn(service, 'probe').mockImplementation(async (p) => {
            const result = await realProbe(p);
            delete result.format.duration;
            return result;
        });
        const work = await mkdtemp(join(dir, 'work-'));
        expect((await service.processAndUpload(src, work, 'x')).video.duration).toBe(0);
    });

    it('длительность неизвестна в исходнике, но результат длиннее 5 минут → file_video_too_long; ffmpeg обрезает по лимиту', async () => {
        const service = new VideoService(createS3() as any);
        const src = make('nodur-long.mp4', [
            '-f',
            'lavfi',
            '-i',
            'testsrc2=size=160x120:rate=10:duration=1',
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
        ]);
        const realProbe = service.probe.bind(service);
        jest.spyOn(service, 'probe')
            .mockImplementationOnce(async (p) => {
                const result = await realProbe(p);
                delete result.format.duration;
                return result;
            })
            .mockImplementationOnce(async (p) => {
                const result = await realProbe(p);
                result.format.duration = '301';
                return result;
            });
        const run = jest.spyOn(service as any, 'run');
        const work = await mkdtemp(join(dir, 'work-'));

        await expect(service.processAndUpload(src, work, 'x')).rejects.toThrow('file_video_too_long');
        const ffmpegArgs = run.mock.calls.find(([binary]) => binary === 'ffmpeg')![1] as string[];
        expect(ffmpegArgs[ffmpegArgs.indexOf('-t') + 1]).toBe('301');
    });

    it('ffmpeg упал при конвертации → file_video_invalid', async () => {
        const service = new VideoService(createS3() as any);
        const src = make('fail.mp4', [
            '-f',
            'lavfi',
            '-i',
            'testsrc2=size=160x120:rate=10:duration=1',
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
        ]);
        const run = (service as any).run.bind(service);
        jest.spyOn(service as any, 'run').mockImplementation((binary: string, args: string[]) =>
            binary.includes('ffmpeg') && !binary.includes('ffprobe')
                ? Promise.reject(new Error('ffmpeg exited with 1'))
                : run(binary, args),
        );
        await expect(service.processAndUpload(src, dir, 'x')).rejects.toThrow('file_video_invalid');
    });

    it('run: ненулевой код выхода → ошибка с хвостом stderr', async () => {
        await expect((new VideoService(createS3() as any) as any).run('ffprobe', ['/definitely/missing.mp4'])).rejects.toThrow(
            /ffprobe exited with 1/,
        );
    });

    it('run: зависший процесс убивается по таймауту', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
        try {
            const promise = (new VideoService(createS3() as any) as any).run('sleep', ['30']);
            jest.advanceTimersByTime(15 * 60_000);
            await expect(promise).rejects.toThrow(/sleep exited with null/);
        } finally {
            jest.useRealTimers();
        }
    });

    it('run: зависший процесс убивается по таймауту', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
        try {
            const promise = (new VideoService(createS3() as any) as any).run('sleep', ['30']);
            jest.advanceTimersByTime(15 * 60_000);
            await expect(promise).rejects.toThrow(/sleep exited with null/);
        } finally {
            jest.useRealTimers();
        }
    });
    it('run: бинарника нет → ошибка spawn', async () => {
        await expect((new VideoService(createS3() as any) as any).run('/no/such/binary', [])).rejects.toThrow(/ENOENT/);
    });

    it('displaySize: тег rotate=270 тоже меняет стороны, без поворота — как есть', () => {
        const service: any = new VideoService(createS3() as any);
        expect(service.displaySize({ width: 1920, height: 1080, tags: { rotate: '270' } })).toEqual({ width: 1080, height: 1920 });
        expect(service.displaySize({ width: 1920, height: 1080, tags: { rotate: '180' } })).toEqual({ width: 1920, height: 1080 });
        expect(service.displaySize({ width: 10, height: 20 })).toEqual({ width: 10, height: 20 });
    });
});
