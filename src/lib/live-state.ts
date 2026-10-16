// "What the agent knows": worked out by code from the conversation, shown beside each thread.
// Its own file so the page can use the type without reaching the live turn (and the model code) behind it.
export interface LiveState {
  balance: string;
  planOffered: boolean;
  promisedOn: string | null; // e.g. "Fri, Mar 13"
  contactAfter: string | null; // e.g. "6:00 PM"
  stopped: boolean;
  disputed: boolean;
  handedOff: boolean;
  lastSent: string | null; // local time of this reply, if one was sent
  nextFollowUp: string | null; // when this agent would follow up if the customer goes quiet; null once the thread has ended
}
