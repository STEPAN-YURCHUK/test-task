import { Module } from '@nestjs/common';
import { AcceptLanguageResolver, I18nJsonLoader, I18nModule, QueryResolver } from 'nestjs-i18n';
import * as path from 'path';

@Module({
    imports: [
        I18nModule.forRoot({
            fallbackLanguage: 'en',
            loader: I18nJsonLoader,
            loaderOptions: {
                path: path.join(__dirname, 'locales'),
                filePattern: '*.json',
                watch: process.env.NODE_ENV === 'development',
            },
            resolvers: [{ use: QueryResolver, options: ['lang'] }, AcceptLanguageResolver],
        }),
    ],
})
export class LocalizationModule {}
