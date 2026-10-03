'use strict';

// Shared with the renderer; grants deliberately match a full target, never a glob.
function createAutopilotProfile() {
    const operations = ['command', 'read_file', 'write_file', 'read_url', 'execute_url', 'mcp'];
    const scopes = ['once', 'conversation', 'project', 'workspace', 'global'];
    function validGrant(g) {
        return g && typeof g.id === 'string' && g.id.length > 0 && g.id.length <= 200 &&
            ['allow', 'deny'].includes(g.effect) && operations.includes(g.operation) && scopes.includes(g.scope) &&
            typeof g.target === 'string' && g.target.trim() === g.target && g.target.length > 0 && g.target.length <= 2000 &&
            !/[\0\r\n*]/.test(g.target) && (g.workspace === undefined || typeof g.workspace === 'string');
    }
    function normalize(input) {
        if (!input) return { enabled: false, grants: [] };
        if (typeof input.enabled !== 'boolean') return { enabled: false, grants: [], error: 'invalid-autopilot-profile' };
        if (!Array.isArray(input.grants) || input.grants.length > 256 || input.grants.some(g => !validGrant(g))) return { enabled: false, grants: [], error: 'invalid-autopilot-profile' };
        return { enabled: input.enabled, grants: input.grants.map(g => ({ id: g.id, effect: g.effect, operation: g.operation, target: g.target, scope: g.scope, ...(g.workspace === undefined ? {} : { workspace: g.workspace }) })) };
    }
    return { normalize, validGrant, operations, scopes };
}
async function configureProfile(vscode) {
    const api = createAutopilotProfile();
    const config = vscode.workspace.getConfiguration('grav');
    const draft = api.normalize(config.get('autopilotProfile', { enabled: false, grants: [] }));
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
    delete draft.error;
    for (;;) {
        const action = await vscode.window.showQuickPick([
            { label: draft.enabled ? 'Disable autopilot' : 'Enable autopilot', id: 'toggle', description: 'Observe, pause and dry-run still prevent automatic approval' },
            { label: 'Add grant', id: 'add', description: 'Choose an exact operation, target and selected permission scope' },
            { label: 'Remove grant', id: 'remove', description: 'Saved host permissions must also be revoked in host settings' },
            { label: 'Save profile', id: 'save', description: draft.grants.length + ' grants; autopilot ' + (draft.enabled ? 'enabled' : 'disabled') },
        ], { placeHolder: 'Set up Autopilot once; cancel discards unsaved changes' });
        if (!action) return false;
        if (action.id === 'toggle') draft.enabled = !draft.enabled;
        if (action.id === 'remove') {
            const picked = await vscode.window.showQuickPick(draft.grants.map(g => ({ label: g.effect + ' ' + g.operation + ': ' + g.target, description: g.scope, id: g.id })), { placeHolder: 'Remove an exact Grav grant' });
            if (!picked) return false;
            draft.grants = draft.grants.filter(g => g.id !== picked.id);
        }
        if (action.id === 'add') {
            if (!workspace) { await vscode.window.showWarningMessage('[Grav] Open the project workspace before adding an autopilot grant.'); continue; }
            if (draft.grants.length >= 256) { await vscode.window.showWarningMessage('[Grav] Remove a grant before adding more than 256.'); continue; }
            const operation = await vscode.window.showQuickPick(api.operations, { placeHolder: 'Permission operation (read and write are separate grants)' });
            if (!operation) return false;
            const target = await vscode.window.showInputBox({ prompt: 'Exact target from the permission card; no wildcards',
                validateInput: target => api.validGrant({ id: 'preview', effect: 'allow', operation, target, scope: 'once' }) ? null : 'Enter an exact target, at most 2000 characters, with no wildcards or newlines.' });
            if (target === undefined) return false;
            const scope = await vscode.window.showQuickPick(api.scopes.map(id => ({ label: id === 'once' ? 'Once (Recommended)' : id, id, description: id === 'once' ? 'Default new card scope; approve this request once' : 'Save host permission; revoke it later in host settings' })), { placeHolder: 'Scope must match the card’s selected scope; Grav does not switch options' });
            if (!scope) return false;
            const effect = await vscode.window.showQuickPick(['allow', 'deny'], { placeHolder: 'Explicit deny takes precedence across permission scopes' });
            if (!effect) return false;
            const grant = { id: require('crypto').randomUUID(), effect, operation, target, scope: scope.id, workspace };
            if (!api.validGrant(grant)) { await vscode.window.showWarningMessage('[Grav] Invalid autopilot grant.'); continue; }
            draft.grants.push(grant);
        }
        if (action.id === 'save') {
            const profile = api.normalize(draft);
            if (profile.error) { await vscode.window.showWarningMessage('[Grav] ' + profile.error); return false; }
            await config.update('autopilotProfile', profile, vscode.ConfigurationTarget.Global);
            return true;
        }
    }
}
module.exports = { createAutopilotProfile, ...createAutopilotProfile(), configureProfile };
