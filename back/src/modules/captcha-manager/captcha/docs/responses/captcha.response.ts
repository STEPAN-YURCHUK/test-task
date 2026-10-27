import { ApiProperty } from '@nestjs/swagger';

export class CaptchaResponse {
    @ApiProperty({
        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOi…',
        description: 'Single-use signed token: send it back as `captchaToken`. Lives 5 minutes',
    })
    token: string;

    @ApiProperty({
        example: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0…',
        description: 'CAPTCHA image as an SVG data URI — use it directly as `<img src>`',
    })
    image: string;
}
