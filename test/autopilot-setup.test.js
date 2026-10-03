'use strict';
const assert = require('assert/strict');
const { configureProfile, normalize } = require('../src/autopilot-profile');
let passed = 0, failed = 0;
const initial = { enabled: true, grants: [{ id: 'old', effect: 'deny', operation: 'write_file', target: '/fixture/private.txt', scope: 'once', workspace: '/fixture' }] };
function mock(answers, input = '/fixture/input.txt', stored = initial) {
    const writes = [], settings = { get: () => stored, update: async (...args) => writes.push(args) };
    return { writes, ConfigurationTarget: { Global: 1 }, workspace: { workspaceFolders: [{ uri: { fsPath: '/fixture' } }], getConfiguration: () => settings },
        window: { showQuickPick: async () => answers.shift(), showInputBox: async () => input, showWarningMessage: async () => {} } };
}
async function check(name, fn) { try { await fn(); passed++; } catch (e) { failed++; console.error(name, e); } }
(async () => {
    await check('cancel after draft toggle never writes', async () => {
        const v = mock([{ id: 'toggle' }, undefined]); assert.equal(await configureProfile(v), false); assert.equal(v.writes.length, 0); assert.equal(initial.enabled, true);
    });
    await check('cancel midway through grant never writes', async () => {
        const v = mock([{ id: 'add' }, 'read_file', undefined]); assert.equal(await configureProfile(v), false); assert.equal(v.writes.length, 0); assert.equal(initial.grants.length, 1);
    });
    await check('guided grant saves generated identity and exact workspace', async () => {
        const v = mock([{ id: 'toggle' }, { id: 'add' }, 'read_file', { id: 'once' }, 'allow', { id: 'save' }], '/fixture/input.txt', { enabled: false, grants: [] });
        assert.equal(await configureProfile(v), true); assert.equal(v.writes.length, 1);
        const [name, profile, target] = v.writes[0]; assert.equal(name, 'autopilotProfile'); assert.equal(profile.enabled, true); assert.equal(target, 1);
        assert.equal(profile.grants[0].workspace, '/fixture'); assert.equal(profile.grants[0].target, '/fixture/input.txt'); assert.equal(profile.grants[0].scope, 'once'); assert(profile.grants[0].id.length > 20);
    });
    await check('disable preserves grants for next enable', async () => {
        const v = mock([{ id: 'toggle' }, { id: 'save' }]); assert.equal(await configureProfile(v), true);
        assert.equal(v.writes[0][1].enabled, false); assert.deepEqual(v.writes[0][1].grants, initial.grants); assert.equal(normalize(v.writes[0][1]).grants.length, 1);
    });
    await check('remove operates on exact id and only saves explicitly', async () => {
        const v = mock([{ id: 'remove' }, { id: 'old' }, { id: 'save' }]); assert.equal(await configureProfile(v), true); assert.deepEqual(v.writes[0][1].grants, []); assert.equal(initial.grants.length, 1);
    });
    await check('invalid target cannot be persisted even if UI validation is bypassed', async () => {
        const v = mock([{ id: 'add' }, 'read_file', { id: 'once' }, 'allow', { id: 'save' }], '*', { enabled: true, grants: [] });
        assert.equal(await configureProfile(v), true); assert.deepEqual(v.writes[0][1].grants, []);
    });
    console.log(`Results: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
