/**
 * Логотип для сайдбара Scalar (иконка-пузырь из шапки фронта), вшитый data-URI:
 * рендерер Scalar грузится с CDN и не может обратиться к нашей статике.
 * Два варианта: текст под светлую и под тёмную тему (иконка с градиентом одинаковая).
 */
const logo = (textColor: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="40" viewBox="0 0 220 40">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d4aff"/><stop offset=".55" stop-color="#a35bff"/><stop offset="1" stop-color="#ff6bb5"/></linearGradient></defs>
<rect width="40" height="40" rx="12" fill="url(#g)"/>
<path d="M30 20a9 9 0 0 1-13 8l-6 1 1-5.2A9 9 0 1 1 30 20Z" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>
<text x="52" y="27" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="19" font-weight="650" fill="${textColor}">Comments API</text>
</svg>`;

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

export const LOGO_DATA_URI = toDataUri(logo('#16161f'));
export const LOGO_DARK_DATA_URI = toDataUri(logo('#f2f2f8'));
