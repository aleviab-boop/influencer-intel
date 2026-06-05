// ============================================================
// Comment-to-DM automations service (Phase 1 — simulated runner).
//
// An automation watches a post for a keyword in comments. simulateComment()
// is the runner: it matches a (simulated) comment against an active automation
// and logs a run. In Phase 2 the same match → send logic gets driven by the
// real Instagram `comments` webhook + Send API instead of a manual test.
// ============================================================

import { getBolticClient } from '@influencer-intel/shared/db';
import { IGGraphClient } from '@influencer-intel/shared/ig-graph';
import type { Automation, AutomationRun, ConnectedAccount, TriggerType } from '@influencer-intel/shared/types';
import { getAccessToken } from './oauth-service';

export async function listAutomations(): Promise<Automation[]> {
  const db = getBolticClient();
  return db.query<Automation>(`SELECT * FROM automations ORDER BY created_at DESC`);
}

export async function createAutomation(input: {
  name: string;
  post_label?: string | null;
  media_id?: string | null;
  trigger_type?: TriggerType;
  keyword?: string | null;
  dm_message: string;
  comment_reply?: string | null;
  connected_account_id?: string | null;
}): Promise<Automation> {
  const db = getBolticClient();
  return db.insert<Automation>('automations', {
    name: input.name,
    post_label: input.post_label ?? null,
    media_id: input.media_id ?? null,
    trigger_type: input.trigger_type ?? 'keyword',
    keyword: input.keyword ?? null,
    dm_message: input.dm_message,
    comment_reply: input.comment_reply ?? null,
    connected_account_id: input.connected_account_id ?? null,
    status: 'active',
    reply_count: 0,
  });
}

export async function updateAutomation(
  id: string,
  patch: Partial<Pick<Automation, 'name' | 'post_label' | 'media_id' | 'trigger_type' | 'keyword' | 'dm_message' | 'comment_reply' | 'status'>>,
): Promise<Automation | null> {
  const db = getBolticClient();
  const set: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) set[k] = v;
  const rows = await db.update<Automation>('automations', { id }, set);
  return rows[0] ?? null;
}

export async function deleteAutomation(id: string): Promise<void> {
  const db = getBolticClient();
  await db.query(`DELETE FROM automations WHERE id = $1`, [id]);
}

export async function listRuns(automationId: string, limit = 10): Promise<AutomationRun[]> {
  const db = getBolticClient();
  return db.query<AutomationRun>(
    `SELECT * FROM automation_runs WHERE automation_id = $1 ORDER BY created_at DESC LIMIT ${Number(limit)}`,
    [automationId],
  );
}

function matches(a: Automation, comment: string): boolean {
  if (a.trigger_type === 'any') return true;
  if (!a.keyword) return false;
  return comment.toLowerCase().includes(a.keyword.toLowerCase());
}

// The runner. Given a (simulated) comment, decide whether the automation fires,
// log the run, and — when it fires on an active automation — record the DM that
// would be sent and bump the reply count.
export async function simulateComment(
  id: string,
  input: { comment: string; commenter?: string | null },
): Promise<{ matched: boolean; fired: boolean; dm_sent: string | null; run: AutomationRun } | null> {
  const db = getBolticClient();
  const automation = await db.findById<Automation>('automations', id);
  if (!automation) return null;

  const did = matches(automation, input.comment);
  const fired = did && automation.status === 'active';
  const dm_sent = fired ? automation.dm_message : null;
  const status: AutomationRun['status'] = fired ? 'simulated' : 'skipped';

  const run = await db.insert<AutomationRun>('automation_runs', {
    automation_id: id,
    commenter: input.commenter ?? null,
    comment_text: input.comment,
    matched: did,
    dm_sent,
    status,
  });

  if (fired) {
    await db.query(
      `UPDATE automations SET reply_count = reply_count + 1, last_active_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id],
    );
  }

  return { matched: did, fired, dm_sent, run };
}

// ============================================================
// Phase 2 — real runner driven by the Instagram comments webhook.
// ============================================================

export interface CommentEvent {
  ig_user_id: string;      // the account that received the comment
  media_id?: string | null;
  comment_id?: string | null;
  comment_text: string;
  commenter?: string | null;
}

// Find the connected account for the event, match active automations
// (by media + keyword), and send the DM via the IG Send API. Logs each run.
export async function runCommentEvent(ev: CommentEvent): Promise<{ fired: number }> {
  const db = getBolticClient();

  const accounts = await db.query<ConnectedAccount>(
    `SELECT * FROM connected_accounts WHERE ig_user_id = $1 AND connection_status = 'active' LIMIT 1`,
    [ev.ig_user_id],
  );
  const account = accounts[0];
  if (!account) return { fired: 0 }; // no connected account for this IG user — ignore

  const autos = await db.query<Automation>(
    `SELECT * FROM automations
     WHERE connected_account_id = $1 AND status = 'active'
       AND (media_id IS NULL OR media_id = $2)`,
    [account.id, ev.media_id ?? null],
  );

  let fired = 0;
  let token: string | null = null;

  for (const a of autos) {
    if (!matches(a, ev.comment_text)) continue;

    let status: AutomationRun['status'] = 'sent';
    try {
      token = token ?? (await getAccessToken(account.id));
      const client = new IGGraphClient(token);
      if (ev.comment_id) {
        await client.sendPrivateReply(ev.comment_id, a.dm_message);
        if (a.comment_reply) await client.replyToComment(ev.comment_id, a.comment_reply).catch(() => {});
      } else {
        status = 'failed';
      }
    } catch (err) {
      console.error('[automations] send failed:', (err as Error).message);
      status = 'failed';
    }

    await db.insert<AutomationRun>('automation_runs', {
      automation_id: a.id,
      commenter: ev.commenter ?? null,
      comment_text: ev.comment_text,
      matched: true,
      dm_sent: status === 'sent' ? a.dm_message : null,
      status,
    });
    if (status === 'sent') {
      await db.query(
        `UPDATE automations SET reply_count = reply_count + 1, last_active_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [a.id],
      );
      fired++;
    }
  }

  return { fired };
}
