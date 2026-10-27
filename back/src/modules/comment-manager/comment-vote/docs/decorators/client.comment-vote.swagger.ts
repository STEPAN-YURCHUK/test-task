import { applyDecorators } from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ValidationErrorResponse } from 'src/shared/swagger/responses/validation-error.response';
import { errorExample } from 'src/shared/swagger/swagger-error.helper';
import { ApiAcceptLanguageHeader } from 'src/shared/swagger/swagger.headers';
import { VoteResultResponse, VoterTokenResponse } from '../responses/comment-vote.response';

const VoterGuardResponses = () =>
    applyDecorators(
        ApiBearerAuth('voter'),
        ApiUnauthorizedResponse({
            description: 'Missing, foreign or expired voter token — request a new one',
            ...errorExample(401, 'invalid_voter_token'),
        }),
        ApiAcceptLanguageHeader(),
    );

export const ApiClientIssueVoterTokenDocs = () =>
    applyDecorators(
        ApiOperation({
            summary: 'Get an anonymous voter token',
            description:
                'No registration: the token carries a random `voterId`. Send it as `Authorization: Bearer <token>` to vote. Limited to 10 per minute per IP.',
        }),
        ApiCreatedResponse({ description: 'New voter token', type: VoterTokenResponse }),
    );

export const ApiClientFindMyVotesDocs = () =>
    applyDecorators(
        ApiOperation({
            summary: 'My votes for the given comments',
            description: 'Pass the uuids of comments visible on the page (up to 1000). Comments without your vote are omitted.',
        }),
        ApiOkResponse({
            description: 'Map comment uuid → your vote',
            schema: {
                type: 'object',
                additionalProperties: { type: 'number', enum: [1, -1] },
                example: { '6f1c2c55-1111-4a4a-9b9b-1234567890ab': 1 },
            },
        }),
        ApiBadRequestResponse({ description: 'Not an array of uuids or more than 1000', type: ValidationErrorResponse }),
        VoterGuardResponses(),
    );

export const ApiClientVoteCommentDocs = () =>
    applyDecorators(
        ApiOperation({
            summary: 'Like, dislike or remove the vote',
            description:
                'Sets the desired state: `1` like, `-1` dislike, `0` remove. Repeating the same value changes nothing. ' +
                'Counters are updated in one transaction with a row lock and pushed to everyone over WebSocket (`comment_voted`). Limited to 60 per minute.',
        }),
        ApiOkResponse({ description: 'New counters', type: VoteResultResponse }),
        ApiBadRequestResponse({ description: '`value` is not 1, -1 or 0', type: ValidationErrorResponse }),
        ApiNotFoundResponse({ description: 'Comment not found', ...errorExample(404, 'comment_not_found') }),
        VoterGuardResponses(),
    );
