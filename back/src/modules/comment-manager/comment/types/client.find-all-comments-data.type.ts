import { SortFieldCommentEnum } from '../enums/sort-field-comment.enum';
import { SortOrderEnum } from '../enums/sort-order.enum';

export type ClientFindAllCommentsData = {
    limit: number;
    offset: number;
    sortBy: SortFieldCommentEnum;
    sortOrder: SortOrderEnum;
};
