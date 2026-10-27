import { ConfigService } from '@nestjs/config';
import { SequelizeModuleOptions } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize';

// prettier-ignore
export const getPostgresConfig = (configService: ConfigService): SequelizeModuleOptions => {
    return {
        dialect: 'postgres',
        logging: false,
        autoLoadModels: true,
        // Схема создаётся из моделей; эталонный DDL — docs/db-schema.sql
        synchronize: configService.get<string>('DB_SYNCHRONIZE') !== 'false',
        define: {
            underscored: true,
        },
        pool: {
            max: 20,
            min: 0,
            idle: 10000,
        },
        host: configService.get<string>('POSTGRES_HOST'),
        port: configService.get<number>('POSTGRES_PORT'),
        username: configService.get<string>('POSTGRES_USER'),
        password: configService.get<string>('POSTGRES_PASSWORD'),
        database: configService.get<string>('POSTGRES_DB'),
        timezone: '+00:00',
        dialectOptions: {
            timezone: '+00:00',
        },
        models: [],
        hooks: {
            afterConnect(connection: Sequelize) {
                return connection.query("SET timezone = 'UTC';").then(() => {
                    console.log('\x1b[1m\x1b[30m\x1b[48;2;139;233;161m%s\x1b[0m', ' Successfully connected to the Postgres database. ');
                });
            },
        },
    };
};
