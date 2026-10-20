const modes = new Set(['idle','showcase','live_session','results','hold']);
const phases = new Set(['queued','creating','review','unavailable']);
const clean = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && ![...value].some(char => char.charCodeAt(0)<32 || char.charCodeAt(0)===127);
export const isPublicAssetHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
/** Build, never spread. Only independently approved presentation fields enter. */
export function publicStage(value) {
  const version = Number.isSafeInteger(value?.version) && value.version >= 0 ? value.version : 0;
  const mode = modes.has(value?.mode) ? value.mode : 'hold';
  const item = value?.artwork;
  const artwork = ['showcase','live_session','results'].includes(mode) && item && isPublicAssetHash(item.asset)
    && clean(item.title,100) && clean(item.creator,40) && ['ai','member_made','Made with AI in CUHZ Lounge','Member-made in Chain Studio'].includes(item.label)
    ? Object.freeze({ asset:item.asset,title:item.title,creator:item.creator,
      label:['ai','Made with AI in CUHZ Lounge'].includes(item.label) ? 'Made with AI in CUHZ Lounge' : 'Member-made in Chain Studio' }) : null;
  const end = typeof value?.endsAt === 'string' ? Date.parse(value.endsAt) : NaN;
  const fresh = typeof value?.freshUntil === 'string' ? Date.parse(value.freshUntil) : NaN;
  const source = value?.activity;
  const activity = mode === 'live_session' && Number.isFinite(end) && source && phases.has(source.phase)
    ? Object.freeze({phase:source.phase,displayName:clean(source.displayName,40) ? source.displayName : null}) : null;
  return Object.freeze({version,mode,endsAt:mode === 'live_session' && Number.isFinite(end) ? new Date(end).toISOString() : null,
    freshUntil:Number.isFinite(fresh) ? new Date(fresh).toISOString() : null,artwork,activity});
}
/** Mon–Fri starts at noon; each day continues until 01:00 the next day. */
export function showcaseIsOpen(at) {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return false;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  const hour = Number(parts.hour);
  return (hour >= 12 && ['Mon','Tue','Wed','Thu','Fri'].includes(parts.weekday))
    || (hour < 1 && ['Tue','Wed','Thu','Fri','Sat'].includes(parts.weekday));
}
