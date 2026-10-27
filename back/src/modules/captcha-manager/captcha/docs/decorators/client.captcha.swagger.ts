import { applyDecorators } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { CaptchaResponse } from '../responses/captcha.response';

export const ApiClientGenerateCaptchaDocs = () =>
    applyDecorators(
        ApiOperation({
            summary: 'Get a new CAPTCHA',
            description:
                'Returns an SVG image with 6 latin letters/digits and a signed token. The answer is never stored on the server: the token carries its HMAC. ' +
                'The token is **single-use** — after any `POST /comments` attempt request a new CAPTCHA. The answer is case-insensitive. Responses are not cached (`Cache-Control: no-store`).',
        }),
        ApiOkResponse({ description: 'New CAPTCHA', type: CaptchaResponse }),
    );
