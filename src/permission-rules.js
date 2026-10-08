'use strict';
const crypto = require('crypto');
const Policy = require('./action-policy');
let sessionRules = [];

function validateRule(input) {
    if (!input || !['allow', 'deny'].includes(input.effect) || !['exact', 'prefix'].includes(input.match) || !['session', 'project', 'user'].includes(input.scope)) throw new Error('Invalid rule effect, matcher or scope');
    const argv = Policy.parseArgv(input.command);
    if (!argv) throw new Error('Rule needs one literal argv command');
    if (input.scope === 'project' && !input.workspace) throw new Error('Open a workspace before creating a project rule');
    if (input.expiresAt !== null && (!Number.isFinite(input.expiresAt) || input.expiresAt <= Date.now())) throw new Error('Expiry must be in the future');
    return { id: crypto.randomUUID(), effect: input.effect, match: input.match, argv, scope: input.scope, workspace: input.scope === 'project' ? input.workspace : null, expiresAt: input.expiresAt, createdAt: Date.now(), provenance: 'explicit-user-rule' };
}
function activeRules(rules, workspace, now = Date.now()) {
    if (!Array.isArray(rules) || rules.length + sessionRules.length > 256 || rules.some(r => !Policy.validRule(r))) return [{ invalid: true }];
    return [...(Array.isArray(rules) ? rules.filter(r => r && r.scope !== 'session') : []), ...sessionRules].filter(r => r && (r.expiresAt === null || Number.isFinite(r.expiresAt) && r.expiresAt > now) && (r.scope !== 'project' || r.workspace === workspace));
}
function preview(rule, commands, policy) { return commands.map(command => ({ command, ...Policy.evaluateCommand(command, { ...policy, permissionRules: [...(policy.permissionRules || []), rule] }) })); }
async function manageRules(vscode, ctx, getPolicy) {
    const config = vscode.workspace.getConfiguration('grav');
    const action = await vscode.window.showQuickPick(['Create rule', 'Revoke rule', 'View history'], { placeHolder: 'Explicit Antigravity Auto Submit rules; host permissions are unchanged' });
    if (!action) return;
    if (action === 'Create rule' && (config.get('permissionRules', []).length + sessionRules.length >= 256)) return vscode.window.showWarningMessage('[Antigravity Auto Submit] Rule budget reached; revoke an existing rule first.');
    const history = (ctx.globalState.get('permissionHistory', []) || []).slice(-49);
    if (action === 'View history') {
        const doc = await vscode.workspace.openTextDocument({ content: JSON.stringify(history, null, 2), language: 'json' });
        return vscode.window.showTextDocument(doc);
    }
    if (action === 'Revoke rule') {
        const rules = [...(config.get('permissionRules', []) || []), ...sessionRules];
        const selected = await vscode.window.showQuickPick(rules.map(r => ({ label: r.effect + ' ' + r.match + ': ' + r.argv.join(' '), description: r.scope + ' · ' + r.id, rule: r })), { placeHolder: 'Select the exact rule to revoke' });
        if (!selected) return;
        sessionRules = sessionRules.filter(r => r.id !== selected.rule.id);
        await config.update('permissionRules', rules.filter(r => r.scope !== 'session' && r.id !== selected.rule.id), vscode.ConfigurationTarget.Global);
        await ctx.globalState.update('permissionHistory', [...history, { action: 'revoke', id: selected.rule.id, at: Date.now() }]);
        return;
    }
    const command = await vscode.window.showInputBox({ prompt: 'Literal command example (quoting supported; shell syntax requires manual review)' });
    if (!command) return;
    const effect = await vscode.window.showQuickPick(['allow', 'deny'], { placeHolder: 'Antigravity Auto Submit auto-approval decision' });
    if (!effect) return;
    const match = await vscode.window.showQuickPick(['exact', 'prefix'], { placeHolder: 'Exact argv, or prefix allowing additional arguments' });
    if (!match) return;
    const scope = await vscode.window.showQuickPick(['session', 'project', 'user'], { placeHolder: 'Session ends on extension restart; project is bound to this workspace' });
    if (!scope) return;
    const duration = await vscode.window.showQuickPick(['1 hour', '1 day', 'No expiry'], { placeHolder: 'Rule expiry' });
    if (!duration) return;
    try {
        const policy = getPolicy();
        const rule = validateRule({ command, effect, match, scope, workspace: policy.workspace, expiresAt: duration === 'No expiry' ? null : Date.now() + (duration === '1 hour' ? 3600000 : 86400000) });
        const examples = [command, command + ' --extra', command.replace(/\S+$/, '$&-other')];
        const ruleOnly = { ...policy, permissionProfile: 'legacy', builtInGrants: [], terminalWhitelist: [], permissionRules: [] };
        const doc = await vscode.workspace.openTextDocument({ content: JSON.stringify({ rule, ruleOnlyPreview: preview(rule, examples, ruleOnly), effectivePreview: preview(rule, examples, policy), note: 'Prefix grants permit extra arguments. Existing legacy grants may allow near matches independently. Blacklists always win.' }, null, 2), language: 'json' });
        await vscode.window.showTextDocument(doc);
        if (await vscode.window.showInformationMessage('Save this explicit rule after reviewing its scope and examples?', 'Save Rule', 'Cancel') !== 'Save Rule') return;
        if (rule.scope === 'session') sessionRules.push(rule);
        else await config.update('permissionRules', [...(config.get('permissionRules', []) || []), rule], vscode.ConfigurationTarget.Global);
        await ctx.globalState.update('permissionHistory', [...history, { action: 'create', id: rule.id, scope: rule.scope, match: rule.match, at: Date.now() }]);
    } catch (error) { await vscode.window.showWarningMessage('[Antigravity Auto Submit] ' + error.message); }
}
module.exports = { validateRule, activeRules, preview, manageRules };
