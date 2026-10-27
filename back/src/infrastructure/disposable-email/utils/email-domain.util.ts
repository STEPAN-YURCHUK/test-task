// Домен адреса в нижнем регистре; null — адрес без домена
export const getEmailDomain = (email: string): string | null => {
    const at = (email ?? '').lastIndexOf('@');
    if (at <= 0) return null;
    return (
        email
            .slice(at + 1)
            .trim()
            .toLowerCase() || null
    );
};

// Домен и все его родители без голого TLD: a.mail.example.co.uk → a.mail.example.co.uk, mail.example.co.uk,
// example.co.uk, co.uk. Поддомен одноразового сервиса тоже одноразовый
export const domainCandidates = (domain: string): string[] => {
    const parts = domain.split('.').filter(Boolean);
    return parts.slice(0, -1).map((_, i) => parts.slice(i).join('.'));
};

// Разбор domains.txt / .conf: по домену в строке, # и // — комментарии
export const parseDomainList = (text: string): Set<string> => {
    const domains = new Set<string>();
    for (const raw of (text ?? '').split('\n')) {
        const line = raw.trim().toLowerCase();
        if (!line || line.startsWith('#') || line.startsWith('//')) continue;
        // строка уже без пробелов по краям — первый токен не пустой
        domains.add(line.split(/\s+/)[0]);
    }
    return domains;
};
