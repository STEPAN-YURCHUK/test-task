import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from './models/user.model';
import { ClientUserRepository } from './repositories/client.user.repository';

@Module({
    imports: [SequelizeModule.forFeature([User])],
    providers: [ClientUserRepository],
    exports: [ClientUserRepository],
})
export class UserModule {}
