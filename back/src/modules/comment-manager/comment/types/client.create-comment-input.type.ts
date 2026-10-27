export type ClientCreateCommentInput = {
    userName: string;
    email: string;
    homePage?: string;
    text: string;
    parentUuid?: string;
    captchaToken: string;
    captcha: string;
    file?: Express.Multer.File;
    uploadId?: string;
    ipAddress: string;
    userAgent?: string;
};
