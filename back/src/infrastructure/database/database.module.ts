import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import * as dotenv from 'dotenv';
import { getPostgresConfig } from 'src/config/postgres.config';
import { DatabaseService } from './services/database.service';
dotenv.config({ path: `${process.env.NODE_ENV ? '.' + process.env.NODE_ENV + '.env' : '.env'}`, quiet: true });

@Global()
@Module({
    imports: [
        SequelizeModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: getPostgresConfig,
        }),
    ],
    providers: [DatabaseService],
    exports: [DatabaseService],
})
export class DatabaseModule {}
