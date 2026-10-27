export type CommentFileType = 'IMAGE' | 'TEXT' | 'VIDEO';

export type ImageVariant = { url: string; webpUrl: string | null; width: number; height: number };

export type CommentFile = {
  uuid: string;
  type: CommentFileType;
  url: string;
  originalName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  // small / medium / original + webp-копии; null у текстовых файлов
  variants: { small: ImageVariant; medium: ImageVariant; original: ImageVariant } | null;
  // видео (H.264/AAC MP4, играет на iOS/macOS) + постер-кадр; null у картинок и текстов
  video: { duration: number | null; posterUrl: string; webpPosterUrl: string | null } | null;
};

export type CommentUser = {
  userName: string;
  email: string;
  homePage: string | null;
};

export type Comment = {
  uuid: string;
  parentUuid: string | null;
  rootUuid: string | null;
  text: string;
  likesCount: number;
  dislikesCount: number;
  createdAt: string;
  user: CommentUser;
  file: CommentFile | null;
};

export type TopLevelComment = Comment & { replies: Comment[] };

export type CommentList = {
  items: TopLevelComment[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type SortBy = 'createdAt' | 'userName' | 'email' | 'rating';
export type VoteValue = 1 | -1 | 0;
export type VoteCounters = { likesCount: number; dislikesCount: number; rating: number };
export type SortOrder = 'ASC' | 'DESC';

export type Captcha = { token: string; image: string };

export type UploadPart = { partNumber: number; size: number; url: string };
export type UploadInit = { uploadId: string; partSize: number; expiresIn: number; parts: UploadPart[] };
export type UploadStatus = {
  uploadId: string;
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  error: string | null;
  file: { type: CommentFileType; url: string; originalName: string; mimeType: string; size: number; width: number | null; height: number | null } | null;
};
