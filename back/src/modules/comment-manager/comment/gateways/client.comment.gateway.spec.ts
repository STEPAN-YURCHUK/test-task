import { Logger } from '@nestjs/common';
import { ClientCommentGateway } from './client.comment.gateway';

describe('ClientCommentGateway', () => {
    const interceptor: any = { transform: jest.fn((c) => ({ ...c, transformed: true })) };
    const gateway = new ClientCommentGateway(interceptor);
    const emit = jest.fn();
    gateway.server = { emit } as any;

    beforeEach(() => jest.clearAllMocks());

    it('comment_created — трансформированный комментарий', () => {
        gateway.handleCommentCreated({ comment: { uuid: 'c1' } as any });
        expect(emit).toHaveBeenCalledWith('comment_created', { uuid: 'c1', transformed: true });
    });

    it('comment_voted — счётчики как есть', () => {
        const event = { commentUuid: 'c1', likesCount: 1, dislikesCount: 0, rating: 1 };
        gateway.handleCommentVoted(event);
        expect(emit).toHaveBeenCalledWith('comment_voted', event);
    });

    it('connect/disconnect логируются', () => {
        const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
        gateway.handleConnection({ id: 's1' } as any);
        gateway.handleDisconnect({ id: 's1' } as any);
        expect(debug).toHaveBeenCalledTimes(2);
        debug.mockRestore();
    });
});
