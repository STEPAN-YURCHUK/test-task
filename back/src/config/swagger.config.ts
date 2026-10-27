import { DocumentBuilder } from '@nestjs/swagger';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require('../../package.json');

const description = `
Backend of the **SPA Comments** app: threaded comments with unlimited nesting, attachments
(images, text files, videos) uploaded straight to S3, CAPTCHA, likes/dislikes and real-time
updates over WebSocket. Every REST endpoint lives under \`/api/v1\`.

There is **no registration**: an author is identified by the pair *User Name + E-mail*, which is
stored together with the IP address and User-Agent of every comment. All tags are \`[Client]\`.

## Posting a comment — the whole flow

1. \`GET /captcha\` → \`{ token, image }\`. Show \`image\` (an SVG data URI) and keep \`token\`.
2. *(optional, if there is an attachment)* upload the file directly to S3 — see **Attachments** below —
   and wait for \`status: READY\` to get an \`uploadId\`.
3. \`POST /comments\` as \`multipart/form-data\` with \`userName\`, \`email\`, \`homePage?\`, \`text\`,
   \`parentUuid?\` (reply), \`captchaToken\`, \`captcha\` (the text from the image) and \`uploadId?\`.
4. Every open client receives the new comment over WebSocket (\`comment_created\`).

The CAPTCHA token is **single-use**: after any attempt, successful or not, request a new image.
Temporary (disposable) e-mail domains are rejected with \`disposable_email_not_allowed\` before the CAPTCHA is checked.

## Message text

Only these tags are allowed: \`<a href="" title="">\`, \`<code>\`, \`<i>\`, \`<strong>\`. Tags must be
closed in the right order (valid XHTML), \`href\` must be \`http(s)://\`, any other \`<\` is stored as text.
The server stores and returns a **canonical, already escaped** HTML fragment, so the client can render
\`text\` as HTML. \`POST /comments/preview\` returns exactly what will be saved.

## Comments list

\`GET /comments\` returns 25 top-level comments per page; each item carries **all** replies of its thread
in \`replies\` as a flat list — build the tree by \`parentUuid\`. Default order is **newest first**
(\`sortBy=createdAt&sortOrder=DESC\`); also \`userName\`, \`email\`, \`rating\` (likes − dislikes), in both directions.

## Attachments (direct multipart upload to S3)

Bytes never pass through the API: the browser puts them into S3 using presigned URLs.

| Step | Request | Result |
|---|---|---|
| 1 | \`POST /uploads { filename, size }\` | \`uploadId\` + a presigned \`PUT\` URL for every 5 MiB part |
| 2 | \`PUT <part url>\` with the part bytes (to S3, not to the API) | repeat for every part; retry a failed part |
| 3 | \`POST /uploads/{uploadId}/complete\` | parts are verified and assembled, processing is queued |
| 4 | \`GET /uploads/{uploadId}\` until \`READY\` or \`FAILED\` | \`READY\` → pass \`uploadId\` to \`POST /comments\` (once) |

Part URLs live one hour — \`POST /uploads/{uploadId}/parts\` re-signs them. \`DELETE /uploads/{uploadId}\` cancels.

| Type | Limit | Processing |
|---|---|---|
| JPG, PNG, GIF | 20 MB | proportionally fitted into **320×240**; variants \`small\` ≤160×120, \`medium\` ≤240×180, \`original\` ≤320×240, each also as **WebP** (animated GIF stays animated) |
| TXT | 100 KB | checked for binary content, served as \`text/plain; charset=utf-8\` |
| MP4, MOV, M4V, WEBM, MKV, AVI | 200 MB, 5 min | made playable everywhere incl. iOS/macOS: H.264 + AAC MP4 with faststart (already compatible files are only remuxed), poster frame in JPG + WebP |

The file type is detected by **content**, not by extension. A file can also be sent in the
\`file\` field of \`POST /comments\` (images and TXT up to 5 MB, processed synchronously) — but not together with \`uploadId\`.

## Votes

Anonymous: \`POST /comments/voters\` issues a long-lived voter token. Click **Authorize**, pick \`voter\`
and paste the token without the \`Bearer\` prefix. \`PUT /comments/{uuid}/vote\` with \`{ value: 1 | -1 | 0 }\`
sets the desired state (0 removes the vote). One vote per voter per comment.

## Errors and language

Every error is \`{ status, code, message }\`: \`code\` is a stable i18n key for client logic,
\`message\` is already localized. Validation failures add \`errors\`:
\`{ status: 400, code: 'not_valid_data', message, errors: { field: [messages] } }\`.
The language comes from \`Accept-Language\` or \`?lang=\` — \`en\` (default) or \`ru\`.

Creating comments is limited to 10 requests per minute per IP, voting to 60, starting uploads to 20.

## WebSocket

Socket.IO namespace \`/comments\` on the **same port** as HTTP. Public, no authentication;
server → client only. Payloads reuse the REST shapes.

\`\`\`js
const socket = io(\`\${API_HOST}/comments\`, { transports: ['websocket'] });
socket.on('comment_created', (comment) => { /* insert into the list */ });
\`\`\`

| Event | Payload | When |
|---|---|---|
| \`comment_created\` | same as \`POST /comments\` response | any new comment or reply |
| \`comment_voted\` | \`{ commentUuid, likesCount, dislikesCount, rating }\` | a vote changed the counters |
| \`comment_file_updated\` | \`{ commentUuid, file }\` | reserved for asynchronously processed attachments |
`.trim();

export const swaggerConfig = new DocumentBuilder()
    .setTitle('Comments API')
    .setDescription(description)
    .setVersion(version)
    .addBearerAuth(
        {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Anonymous voter token from `POST /comments/voters`',
        },
        'voter',
    )
    .build();
