import { SortFieldCommentEnum } from '../enums/sort-field-comment.enum';
import { SortOrderEnum } from '../enums/sort-order.enum';

export type ClientFindAllCommentsInput = {
    page: number;
    sortBy: SortFieldCommentEnum;
    sortOrder: SortOrderEnum;
};
