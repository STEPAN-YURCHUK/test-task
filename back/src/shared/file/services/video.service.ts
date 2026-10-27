import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { stat } from 'fs/promises';
import { join } from 'path';
import * as sharp from 'sharp';
import { AwsS3Service } from 'src/infrastructure/aws-s3/services/aws-s3.service';
import {
    IMAGE_WEBP_QUALITY,
    VIDEO_MAX_DURATION_SECONDS,
    VIDEO_MAX_HEIGHT,
    VIDEO_MAX_WIDTH,
    VIDEO_POSTER_MAX_HEIGHT,
    VIDEO_POSTER_MAX_WIDTH,
    VIDEO_PROCESS_TIMEOUT_MS,
} from '../constants/file.const';
import { TypeFileEnum } from '../enums/type-file.enum';
import { ProcessedFile } from '../types/processed-file.type';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

// ffmpeg/ffprobe не ходят в сеть: файл-«плейлист» со ссылками наружу не откроется
const SAFE_INPUT = ['-protocol_whitelist', 'file,pipe'];

// Профили H.264, которые аппаратно декодируют iPhone/iPad/Mac
const SAFE_H264_PROFILES = ['Constrained Baseline', 'Baseline', 'Main', 'High'];
const SAFE_PIX_FMTS = ['yuv420p', 'yuvj420p'];

type ProbeStream = {
    codec_type: string;
    codec_name: string;
    profile?: string;
    pix_fmt?: string;
    width?: number;
    height?: number;
    channels?: number;
    tags?: { rotate?: string };
    side_data_list?: { rotation?: number }[];
};
type Probe = { streams: ProbeStream[]; format: { format_name: string; duration?: string } };

@Injectable()
export class VideoService {
    private readonly logger = new Logger(VideoService.name);

    constructor(private readonly awsS3Service: AwsS3Service) {}

    private run(binary: string, args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '';
            let stderr = '';
            const timer = setTimeout(() => child.kill('SIGKILL'), VIDEO_PROCESS_TIMEOUT_MS);

            child.stdout.on('data', (chunk) => (stdout += chunk));
            child.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-4000)));
            child.on('error', (err) => (clearTimeout(timer), reject(err)));
            child.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0) resolve(stdout);
                else reject(new Error(`${binary} exited with ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`));
            });
        });
    }

    async probe(path: string): Promise<Probe> {
        try {
            const json = await this.run(FFPROBE, [
                ...SAFE_INPUT,
                '-v',
                'error',
                '-print_format',
                'json',
                '-show_streams',
                '-show_format',
                path,
            ]);
            return JSON.parse(json);
        } catch {
            throw new HttpException('file_video_invalid', HttpStatus.UNPROCESSABLE_ENTITY);
        }
    }

    // Совместимо «как есть», если это H.264 8 бит 4:2:0 безопасного профиля (+ AAC или без звука) в MP4/MOV
    // и разрешение уже в пределах лимита — тогда достаточно перепаковки без потери качества
    isAppleCompatible(probe: Probe, video: ProbeStream, audio: ProbeStream | undefined): boolean {
        const container = probe.format.format_name.split(',');
        return (
            (container.includes('mp4') || container.includes('mov')) &&
            video.codec_name === 'h264' &&
            SAFE_H264_PROFILES.includes(video.profile ?? '') &&
            SAFE_PIX_FMTS.includes(video.pix_fmt ?? '') &&
            Math.max(video.width, video.height) <= VIDEO_MAX_WIDTH &&
            Math.min(video.width, video.height) <= VIDEO_MAX_HEIGHT &&
            (!audio || (audio.codec_name === 'aac' && (audio.channels ?? 2) <= 2))
        );
    }

    async processAndUpload(sourcePath: string, workDir: string, uuid: string): Promise<ProcessedFile & { transcoded?: boolean }> {
        const probe = await this.probe(sourcePath);
        const video = probe.streams.find((s) => s.codec_type === 'video' && s.codec_name !== 'mjpeg' && s.codec_name !== 'png');
        const audio = probe.streams.find((s) => s.codec_type === 'audio');

        if (!video) throw new HttpException('file_video_invalid', HttpStatus.UNPROCESSABLE_ENTITY);
        // заявленная длительность — быстрый отказ; у WebM/MKV из MediaRecorder её в заголовке часто нет,
        // поэтому ниже результат ещё и обрезается по лимиту (-t) и длительность перепроверяется по готовому MP4
        const declaredDuration = Number(probe.format.duration ?? 0) || 0;
        if (declaredDuration > VIDEO_MAX_DURATION_SECONDS) throw new HttpException('file_video_too_long', HttpStatus.UNPROCESSABLE_ENTITY);

        const outputPath = join(workDir, 'output.mp4');
        const transcoded = !this.isAppleCompatible(probe, video, audio);
        const maps = ['-map', '0:v:0', ...(audio ? ['-map', '0:a:0'] : [])];

        const args = transcoded
            ? [
                  ...maps,
                  // вписать в 1280x720 без увеличения, стороны чётные (требование yuv420p)
                  '-vf',
                  `scale='min(${VIDEO_MAX_WIDTH},iw)':'min(${VIDEO_MAX_HEIGHT},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
                  '-c:v',
                  'libx264',
                  '-preset',
                  'veryfast',
                  '-crf',
                  '23',
                  '-profile:v',
                  'high',
                  '-level:v',
                  '4.0',
                  ...(audio ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : []),
              ]
            : [...maps, '-c', 'copy'];

        try {
            // avc1 (а не avc3) + moov в начале файла: Safari начинает играть до полной загрузки
            await this.run(FFMPEG, [
                '-y',
                ...SAFE_INPUT,
                '-i',
                sourcePath,
                // чуть больше лимита: по результату видно, что исходник длиннее, а работы не больше чем на 5 минут
                '-t',
                String(VIDEO_MAX_DURATION_SECONDS + 1),
                ...args,
                '-tag:v',
                'avc1',
                '-movflags',
                '+faststart',
                '-map_metadata',
                '-1',
                outputPath,
            ]);
        } catch (err) {
            this.logger.warn(`ffmpeg failed: ${err.message}`);
            throw new HttpException('file_video_invalid', HttpStatus.UNPROCESSABLE_ENTITY);
        }

        const output = await this.probe(outputPath);
        const duration = Number(output.format.duration ?? 0) || declaredDuration;
        if (duration > VIDEO_MAX_DURATION_SECONDS) throw new HttpException('file_video_too_long', HttpStatus.UNPROCESSABLE_ENTITY);
        const outVideo = output.streams.find((s) => s.codec_type === 'video');
        const { width, height } = this.displaySize(outVideo);

        // постер — кадр на 1-й секунде (или середина короткого ролика), в jpg и webp
        const framePath = join(workDir, 'poster.png');
        await this.run(FFMPEG, [
            '-y',
            ...SAFE_INPUT,
            '-ss',
            String(Math.min(1, duration / 2)),
            '-i',
            outputPath,
            '-frames:v',
            '1',
            framePath,
        ]);
        const resize = () =>
            sharp(framePath).resize(VIDEO_POSTER_MAX_WIDTH, VIDEO_POSTER_MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true });
        const [posterJpg, posterWebp] = await Promise.all([
            resize().jpeg({ quality: 82 }).toBuffer(),
            resize().webp({ quality: IMAGE_WEBP_QUALITY }).toBuffer(),
        ]);

        const key = this.awsS3Service.buildKey('files', 'videos', `${uuid}.mp4`);
        const posterPath = this.awsS3Service.buildKey('files', 'videos', 'posters', `${uuid}.jpg`);
        const webpPosterPath = this.awsS3Service.buildKey('files', 'videos', 'posters', `${uuid}.webp`);

        await Promise.all([
            this.awsS3Service.putPublicObjectFromPath(key, outputPath, 'video/mp4'),
            this.awsS3Service.putPublicObject(posterPath, posterJpg, 'image/jpeg'),
            this.awsS3Service.putPublicObject(webpPosterPath, posterWebp, 'image/webp'),
        ]);

        const { size } = await stat(outputPath);
        this.logger.log(
            `Video ${uuid}: ${transcoded ? 'transcoded' : 'remuxed'} → ${width}x${height}, ${duration.toFixed(1)}s, ${size} bytes`,
        );

        return {
            type: TypeFileEnum.VIDEO,
            key,
            mimeType: 'video/mp4',
            size,
            width,
            height,
            variants: null,
            video: { duration: Math.round(duration * 100) / 100, posterPath, webpPosterPath },
            transcoded,
        };
    }

    // при повороте 90/270 (вертикальное видео с телефона) ширина и высота меняются местами
    private displaySize(stream: ProbeStream): { width: number; height: number } {
        const rotation =
            Math.abs(Number(stream.tags?.rotate ?? stream.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0)) % 180;
        return rotation === 90 ? { width: stream.height, height: stream.width } : { width: stream.width, height: stream.height };
    }
}
