import { ClientCommentVoteController } from './client.comment-vote.controller';

describe('ClientCommentVoteController', () => {
    const service = { issueVoterToken: jest.fn().mockReturnValue({ token: 't' }), findMyVotes: jest.fn(), vote: jest.fn() };
    const controller = new ClientCommentVoteController(service as any);
    const req = { voter: { voterId: 'v1' } };

    it('issueVoterToken', () => {
        expect(controller.issueVoterToken()).toEqual({ token: 't' });
    });

    it('findMyVotes берёт voterId из токена', async () => {
        await controller.findMyVotes({ uuids: ['a'] }, req);
        expect(service.findMyVotes).toHaveBeenCalledWith('v1', ['a']);
    });

    it('vote собирает input', async () => {
        await controller.vote('c1', { value: -1 }, req);
        expect(service.vote).toHaveBeenCalledWith({ commentUuid: 'c1', voterId: 'v1', value: -1 });
    });
});
