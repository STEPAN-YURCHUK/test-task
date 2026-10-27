import { Module } from '@nestjs/common';
import { ClientCaptchaController } from './controllers/client.captcha.controller';
import { ClientCaptchaService } from './services/client.captcha.service';

@Module({
    controllers: [ClientCaptchaController],
    providers: [ClientCaptchaService],
    exports: [ClientCaptchaService],
})
export class CaptchaModule {}
