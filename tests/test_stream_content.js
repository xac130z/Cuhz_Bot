const assert = require('assert');
const content = require('../src/stream_content');
const policy = require('../src/safety_policy');

function run() {
    const build = content.launchCommandResponse('!build');
    assert.strictEqual(build, content.launchCommandResponse('!services'));
    assert.match(build, /CUHZ Bot/);
    assert.match(build, /availability, scope, and pricing are confirmed by the team/i);
    assert.strictEqual(policy.validateOutbound(build, { source: 'bot' }).allowed, true);

    for (const command of ['!shop', '!tools', '!audit']) {
        const response = content.launchCommandResponse(command);
        assert.ok(response);
        assert.match(response, /not (available|enabled)/i);
        assert.strictEqual(policy.validateOutbound(response, { source: 'bot' }).allowed, true);
    }

    assert.doesNotMatch(content.utilityHelp(false), /!gamble/);
    assert.match(content.utilityHelp(true), /!gamble/);
    assert.match(content.RESPONSES.gamblingDisabled, /unavailable/i);
    console.log('✅ Stream launch content tests passed');
}

run();
