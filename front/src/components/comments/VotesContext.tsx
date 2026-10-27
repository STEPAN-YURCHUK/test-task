'use client';

import { createContext, useContext } from 'react';
import type { VoteValue } from '@/types/comment';

type VotesContextValue = {
  myVotes: Record<string, VoteValue>;
  vote: (commentUuid: string, value: VoteValue) => void;
};

export const VotesContext = createContext<VotesContextValue>({ myVotes: {}, vote: () => {} });

export const useVotes = () => useContext(VotesContext);
