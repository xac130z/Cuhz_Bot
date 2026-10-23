const trusted = new WeakSet();
// Kept separate from the exported runtime. Only the broker imports this mint;
// request JSON cannot reproduce object provenance. Trusted server code remains
// in the same trust boundary and must never mint from caller-supplied identity.
export function mintAuthContext(value) { const context=Object.freeze({...value}); trusted.add(context); return context; }
export const isTrustedAuthContext = value => !!value && trusted.has(value);
const emergency = new WeakSet();
export function mintEmergencyContext(value) { const context=Object.freeze({...value,authority:'emergency_hold'}); emergency.add(context); return context; }
export const isTrustedEmergencyContext = value => !!value && emergency.has(value);
