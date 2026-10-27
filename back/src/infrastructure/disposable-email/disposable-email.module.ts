import { Global, Module } from '@nestjs/common';
import { DisposableEmailService } from './services/disposable-email.service';

@Global()
@Module({
    providers: [DisposableEmailService],
    exports: [DisposableEmailService],
})
export class DisposableEmailModule {}
