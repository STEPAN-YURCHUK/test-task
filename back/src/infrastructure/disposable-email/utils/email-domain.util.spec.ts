import { domainCandidates, getEmailDomain, parseDomainList } from './email-domain.util';

describe('email-domain.util', () => {
    it.each([
        ['John@Mail.Example.COM', 'mail.example.com'],
        ['a@b@c.io', 'c.io'],
        ['  x@site.dev  ', 'site.dev'],
        ['no-at', null],
        ['@domain.com', null],
        ['user@', null],
        ['', null],
        [undefined, null],
    ])('getEmailDomain(%j) → %j', (email, domain) => {
        expect(getEmailDomain(email as string)).toBe(domain);
    });

    it('domainCandidates: домен и родители без голого TLD', () => {
        expect(domainCandidates('a.mail.example.co.uk')).toEqual(['a.mail.example.co.uk', 'mail.example.co.uk', 'example.co.uk', 'co.uk']);
        expect(domainCandidates('mailinator.com')).toEqual(['mailinator.com']);
        expect(domainCandidates('localhost')).toEqual([]);
    });

    it('parseDomainList: нижний регистр, комментарии # и //, пустые строки, первый токен строки', () => {
        expect([...parseDomainList('# header\nMailinator.com\n\n// note\n  yopmail.com  trailing\r\n10minutemail.com\r')]).toEqual([
            'mailinator.com',
            'yopmail.com',
            '10minutemail.com',
        ]);
        expect(parseDomainList(undefined as any).size).toBe(0);
    });
});
