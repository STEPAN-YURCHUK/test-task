import type { Comment, CommentFile, CommentList, TopLevelComment } from '@/types/comment';

let seq = 0;

export function makeComment(overrides: Partial<Comment> = {}): Comment {
  seq += 1;
  return {
    uuid: `c-${seq}`,
    parentUuid: null,
    rootUuid: null,
    text: `text ${seq}`,
    likesCount: 0,
    dislikesCount: 0,
    createdAt: new Date().toISOString(),
    user: { userName: `User${seq}`, email: `user${seq}@ex.com`, homePage: null },
    file: null,
    ...overrides,
  };
}

export function makeTopLevel(overrides: Partial<TopLevelComment> = {}): TopLevelComment {
  return { ...makeComment(overrides), replies: overrides.replies ?? [] };
}

// Цепочка ответов: каждый следующий — ответ на предыдущий
export function makeChain(root: Comment, length: number): Comment[] {
  const replies: Comment[] = [];
  let parent = root;
  for (let i = 0; i < length; i++) {
    const reply = makeComment({ parentUuid: parent.uuid, rootUuid: root.uuid, text: `level ${i + 1}` });
    replies.push(reply);
    parent = reply;
  }
  return replies;
}

export function makeList(items: TopLevelComment[], overrides: Partial<CommentList> = {}): CommentList {
  return { items, total: items.length, page: 1, pageSize: 25, totalPages: 1, ...overrides };
}

export const imageFile = (overrides: Partial<CommentFile> = {}): CommentFile => ({
  uuid: 'f1',
  type: 'IMAGE',
  url: 'https://cdn/original/f1.png',
  originalName: 'photo.png',
  mimeType: 'image/png',
  size: 6900,
  width: 320,
  height: 213,
  variants: {
    small: { url: 'https://cdn/small/f1.png', webpUrl: 'https://cdn/webp-small/f1.webp', width: 160, height: 107 },
    medium: { url: 'https://cdn/medium/f1.png', webpUrl: 'https://cdn/webp-medium/f1.webp', width: 240, height: 160 },
    original: { url: 'https://cdn/original/f1.png', webpUrl: 'https://cdn/webp-original/f1.webp', width: 320, height: 213 },
  },
  video: null,
  ...overrides,
});
