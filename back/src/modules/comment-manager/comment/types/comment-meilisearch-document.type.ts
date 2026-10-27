// Документ индекса comments: денормализованный комментарий + поля только для сортировки
export type CommentMeilisearchDocument = {
    uuid: string;
    parentUuid: string | null;
    rootUuid: string | null;
    isRoot: boolean;
    text: string;
    likesCount: number;
    dislikesCount: number;
    rating: number;
    createdAt: string;
    createdAtTs: number;
    userNameSort: string;
    emailSort: string;
    userUuid: string | null;
    user: { userName: string; email: string; homePage: string | null };
    file: Record<string, any> | null;
};
