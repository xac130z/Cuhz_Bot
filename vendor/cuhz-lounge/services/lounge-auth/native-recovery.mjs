const paths=new Set(['/api/lounge/v2/stage/ops','/api/lounge/v2/stage/ops/emergency',
 '/api/lounge/v2/stage-bridge/ops','/api/lounge/v2/stage-bridge/curated/ops','/api/lounge/v2/bookings/ops']);
const expired=new Set(['AUTH_REQUIRED','SIGN_IN_REQUIRED','AUTH_IDENTITY_CHANGED','SESSION_RECHECK_REQUIRED','SESSION_INVALID']);

/** A denied document can offer sign-in without changing its status or authority.
 * No supplied return URL, automatic redirect, script, mutation or receipt clear. */
export function nativeSignInRecovery(req,code){
 const url=new URL(req.url);
 if(!expired.has(code)||req.method!=='GET'||url.search||!paths.has(url.pathname)
  ||req.headers.get('sec-fetch-mode')!=='navigate'||req.headers.get('sec-fetch-dest')!=='document'
  ||!['none','same-origin'].includes(req.headers.get('sec-fetch-site'))
  ||(req.headers.has('origin')&&req.headers.get('origin')!==url.origin)
  ||/prefetch|prerender/i.test(`${req.headers.get('purpose')||''} ${req.headers.get('sec-purpose')||''}`))return null;
 const next=encodeURIComponent(url.pathname);
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CUHZ Lounge — Sign in again</title><link rel="stylesheet" href="/api/lounge/v2/stage/tokens.css"><link rel="stylesheet" href="/api/lounge/v2/stage/style.css"></head><body class="ops native-recovery"><main><p>PLANET CUHZ · PRIVATE CONTROLS</p><h1>Sign in again to continue</h1><p>Your current session cannot open these controls. Sign in with the same owner account, then return here.</p><p>Any saved pending receipt stays in this browser tab. After signing in, recover that same request deliberately before starting another action.</p><p class="recovery-links"><a href="/auth?next=${next}">Sign in and return to these controls</a></p><p class="recovery-links"><a href="/lounge-pass">Open Lounge Pass</a><a href="/app/lounge">Open Lounge hub</a></p><p>Signing in does not grant control or start the stage.</p></main></body></html>`;
}
