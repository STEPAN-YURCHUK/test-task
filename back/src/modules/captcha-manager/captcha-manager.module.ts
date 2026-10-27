import { Module } from '@nestjs/common';
import { CaptchaModule } from './captcha/captcha.module';

@Module({
    imports: [CaptchaModule],
})
export class CaptchaManagerModule {}
