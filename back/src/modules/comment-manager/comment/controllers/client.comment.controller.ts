import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    Req,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import { FILE_LEGACY_UPLOAD_LIMIT_BYTES } from 'src/shared/file/constants/file.const';
import {
    ApiClientCreateCommentDocs,
    ApiClientFindAllCommentsDocs,
    ApiClientFindOneCommentDocs,
    ApiClientPreviewCommentDocs,
} from '../docs/decorators/client.comment.swagger';
import { ClientCreateCommentDto } from '../dtos/client.create-comment.dto';
import { ClientFindAllCommentsDto } from '../dtos/client.find-all-comments.dto';
import { ClientPreviewCommentDto } from '../dtos/client.preview-comment.dto';
import { SortFieldCommentEnum } from '../enums/sort-field-comment.enum';
import { SortOrderEnum } from '../enums/sort-order.enum';
import { TransformResponseClientCommentInterceptor } from '../interceptors/client.comment.interceptor';
import { ClientCommentService } from '../services/client.comment.service';
import { ClientCreateCommentInput } from '../types/client.create-comment-input.type';
import { ClientFindAllCommentsInput } from '../types/client.find-all-comments-input.type';

@ApiTags('[Client] Comment')
@Controller('comments')
export class ClientCommentController {
    constructor(private readonly clientCommentService: ClientCommentService) {}

    @ApiClientFindAllCommentsDocs()
    @UseInterceptors(TransformResponseClientCommentInterceptor)
    @Get()
    async findAll(@Query() dto: ClientFindAllCommentsDto) {
        const input = {
            page: dto.page ?? 1,
            sortBy: dto.sortBy ?? SortFieldCommentEnum.CREATED_AT,
            sortOrder: dto.sortOrder ?? SortOrderEnum.DESC,
        } satisfies ClientFindAllCommentsInput;

        return await this.clientCommentService.findAll(input);
    }

    @ApiClientPreviewCommentDocs()
    @HttpCode(HttpStatus.OK)
    @Post('preview')
    preview(@Body() dto: ClientPreviewCommentDto) {
        return this.clientCommentService.preview(dto.text);
    }

    @ApiClientFindOneCommentDocs()
    @UseInterceptors(TransformResponseClientCommentInterceptor)
    @Get(':commentUuid')
    async findOne(@Param('commentUuid', ParseUUIDPipe) commentUuid: string) {
        return await this.clientCommentService.findOne(commentUuid);
    }

    @ApiClientCreateCommentDocs()
    @UseGuards(ThrottlerGuard)
    @Throttle({ default: { limit: 10, ttl: 60_000 } })
    @UseInterceptors(
        FileInterceptor('file', { limits: { fileSize: FILE_LEGACY_UPLOAD_LIMIT_BYTES, files: 1 } }),
        TransformResponseClientCommentInterceptor,
    )
    @Post()
    async create(@Body() dto: ClientCreateCommentDto, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
        const input = {
            userName: dto.userName,
            email: dto.email,
            homePage: dto.homePage,
            text: dto.text,
            parentUuid: dto.parentUuid,
            captchaToken: dto.captchaToken,
            captcha: dto.captcha,
            file,
            uploadId: dto.uploadId,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
        } satisfies ClientCreateCommentInput;

        return await this.clientCommentService.create(input);
    }
}
