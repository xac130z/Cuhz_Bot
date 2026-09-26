'use strict';

// P3 local retirement. Existing recovered/founder balances are custody to
// preserve, never amounts to recalculate at boot. Recovery requires an approved
// immutable artifact and cutover/recovery gates. Do not import the DB, read seed
// files, or infer that a missing account needs a grant here.
async function seedPoints() {
    return Object.freeze({ status: 'disabled', reason: 'legacy_seed_retired' });
}

module.exports = Object.freeze({ seedPoints });
