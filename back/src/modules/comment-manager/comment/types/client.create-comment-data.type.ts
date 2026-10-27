export type ClientCreateCommentData = {
    userUuid: string;
    parentUuid: string | null;
    rootUuid: string | null;
    text: string;
    ipAddress: string | null;
    userAgent: string | null;
};
