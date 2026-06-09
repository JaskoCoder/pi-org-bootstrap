/**
 * Mail system — send, receive, prune.
 */
import type { MailMessage } from "./types.js";
import { MAX_MAILBOX_SIZE } from "./constants.js";

/** Remove oldest READ messages until the array is at most MAX_MAILBOX_SIZE. Never prunes unread messages. */
export function pruneMailbox(inbox: MailMessage[]): void {
  if (inbox.length <= MAX_MAILBOX_SIZE) return;
  const toRemove = inbox.length - MAX_MAILBOX_SIZE;
  let removed = 0;
  for (let i = 0; i < inbox.length && removed < toRemove; ) {
    if (inbox[i].read) {
      inbox.splice(i, 1);
      removed++;
    } else {
      i++;
    }
  }
}

export interface MailSystem {
  sendMail(from: string, to: string, subject: string, body: string): MailMessage;
  getUnread(agent: string): MailMessage[];
  markRead(agent: string): number;
  allRecentMail(count: number): MailMessage[];
}

export function createMailSystem(
  mailboxes: Record<string, MailMessage[]>,
  globalInbox: MailMessage[],
  getCounter: () => number,
  setCounter: (n: number) => void,
): MailSystem {
  return {
    sendMail(from: string, to: string, subject: string, body: string): MailMessage {
      const counter = getCounter() + 1;
      setCounter(counter);
      const msg: MailMessage = { id: counter, from, to, subject, body, timestamp: Date.now(), read: false };
      if (to === "all") {
        globalInbox.push(msg);
        pruneMailbox(globalInbox);
      } else {
        if (!mailboxes[to]) mailboxes[to] = [];
        mailboxes[to].push(msg);
        pruneMailbox(mailboxes[to]);
      }
      return msg;
    },
    getUnread(agent: string): MailMessage[] {
      const direct = (mailboxes[agent] || []).filter(m => !m.read);
      const global = globalInbox.filter(m => !m.read && m.from !== agent);
      return [...direct, ...global];
    },
    markRead(agent: string): number {
      let count = 0;
      for (const m of (mailboxes[agent] || [])) { if (!m.read) { m.read = true; count++; } }
      for (const m of globalInbox) { if (!m.read && m.from !== agent) { m.read = true; count++; } }
      return count;
    },
    allRecentMail(count: number): MailMessage[] {
      const all: MailMessage[] = [...globalInbox];
      for (const k of Object.keys(mailboxes)) all.push(...mailboxes[k]);
      all.sort((a, b) => b.timestamp - a.timestamp);
      return all.slice(0, count);
    },
  };
}
