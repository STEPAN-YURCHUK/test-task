import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiClientGenerateCaptchaDocs } from '../docs/decorators/client.captcha.swagger';
import { ClientCaptchaService } from '../services/client.captcha.service';

@ApiTags('[Client] Captcha')
@Controller('captcha')
export class ClientCaptchaController {
    constructor(private readonly clientCaptchaService: ClientCaptchaService) {}

    @ApiClientGenerateCaptchaDocs()
    @Header('Cache-Control', 'no-store')
    @Get()
    generate() {
        return this.clientCaptchaService.generate();
    }
}
