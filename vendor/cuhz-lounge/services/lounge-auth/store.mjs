/** Parameterized server-only database port; accepts pg/PGlite.query, never a
 * browser Supabase client. Database time controls expiry and CAS operations. */
export function createAuthStore(db) {
  const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0] ?? null;
  return {
    cleanup: async()=>{await db.query('delete from public.lounge_auth_flows where expires_at<=clock_timestamp()');await db.query("update public.lounge_auth_sessions set revoked_at=coalesce(revoked_at,clock_timestamp()),revision=revision+1,sealed_tokens=null,twitch_user_id=null,refresh_claim=null,refresh_started_at=null where sealed_tokens is not null and (revoked_at is not null or idle_expires_at<=clock_timestamp() or expires_at<=clock_timestamp())");await db.query("delete from public.lounge_auth_rate_limits where window_start<clock_timestamp()-interval '1 day'");return {ok:true};},
    enabled: async()=>!!(await one("select enabled from public.lounge_feature_flags where key='auth.broker_enabled'"))?.enabled,
    rate: async key=> (await one(`insert into public.lounge_auth_rate_limits(key_hash,attempts) values($1,1)
      on conflict(key_hash) do update set attempts=case when lounge_auth_rate_limits.window_start < clock_timestamp()-interval '10 minutes' then 1 else lounge_auth_rate_limits.attempts+1 end,
      window_start=case when lounge_auth_rate_limits.window_start < clock_timestamp()-interval '10 minutes' then clock_timestamp() else lounge_auth_rate_limits.window_start end returning attempts`,[key])).attempts<=10,
    // One database timestamp owns all lifetime boundaries. The original schema
    // used separate volatile defaults, occasionally exceeding its own maximum.
    createFlow: async f=>one(`with stamp as materialized (select clock_timestamp() as at)
      insert into public.lounge_auth_flows(state_hash,browser_hash,sealed_verifier,next_path,issued_at,expires_at)
      select $1,$2,$3,$4,at,at+interval '5 minutes' from stamp returning state_hash`,[f.stateHash,f.browserHash,f.sealedVerifier,f.next]),
    // Atomic DELETE returns the sealed verifier and removes the one-use state;
    // no later retry can exchange a paid/credential-bearing code twice.
    takeFlow: (state,browser)=>one(`delete from public.lounge_auth_flows where state_hash=$1 and browser_hash=$2 and consumed_at is null and expires_at>clock_timestamp() returning sealed_verifier,next_path`,[state,browser]),
    createSession: s=>one(`with old as (update public.lounge_auth_sessions set revoked_at=clock_timestamp(),revision=revision+1,sealed_tokens=null,twitch_user_id=null where session_hash=$7),
      stamp as materialized (select clock_timestamp() as at)
      insert into public.lounge_auth_sessions(id,session_hash,user_id,twitch_user_id,csrf_hash,sealed_tokens,issued_at,idle_expires_at,expires_at)
      select $1,$2,$3,$4,$5,$6,at,at+interval '30 minutes',at+interval '8 hours' from stamp returning id,revision`,[s.id,s.hash,s.userId,s.twitchId,s.csrfHash,s.sealedTokens,s.oldHash??'']),
    session: hash=>one(`select * from public.lounge_auth_sessions where session_hash=$1 and revoked_at is null and idle_expires_at>clock_timestamp() and expires_at>clock_timestamp() and exists(select 1 from public.lounge_feature_flags where key='auth.broker_enabled' and enabled)`,[hash]),
    touch: (id,revision)=>one(`update public.lounge_auth_sessions set idle_expires_at=least(expires_at,clock_timestamp()+interval '30 minutes') where id=$1 and revision=$2 and revoked_at is null and idle_expires_at>clock_timestamp() and expires_at>clock_timestamp() returning id`,[id,revision]),
    claimRefresh: (id,revision,claim,expectedSealed)=>one(`update public.lounge_auth_sessions set refresh_claim=$3,refresh_started_at=clock_timestamp() where id=$1 and revision=$2 and sealed_tokens=$4 and refresh_claim is null and revoked_at is null and idle_expires_at>clock_timestamp() and expires_at>clock_timestamp() returning id`,[id,revision,claim,expectedSealed]),
    settleRefresh: (id,revision,claim,sealed)=>one(`update public.lounge_auth_sessions set sealed_tokens=$4,refresh_claim=null,refresh_started_at=null where id=$1 and revision=$2 and refresh_claim=$3 and revoked_at is null and idle_expires_at>clock_timestamp() and expires_at>clock_timestamp() returning id`,[id,revision,claim,sealed]),
    revoke: hash=>one(`update public.lounge_auth_sessions set revoked_at=coalesce(revoked_at,clock_timestamp()),revision=revision+1,sealed_tokens=null,twitch_user_id=null,refresh_claim=null,refresh_started_at=null where session_hash=$1 returning id`,[hash]),
  };
}
