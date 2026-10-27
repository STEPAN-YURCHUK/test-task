import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function start() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);
    const PORT = app.get(ConfigService).get('PORT') || 4000;

    await configureApp(app);

    await app.listen(PORT, () => console.log('\x1b[1m\x1b[30m\x1b[48;2;187;154;247m%s\x1b[0m', ` Server started on port ${PORT} `));
}
start();
