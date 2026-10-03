'use strict';

const VERSION = 'adapter-v1';
function capabilityManifest(host = {}) {
    return {
        version: VERSION, host: { name: host.name || 'unknown', version: host.version || 'unknown' },
        adapters: [
            { id: 'cdp-dom', target: 'verified-agent-webview', identity: 'host-react-props-or-attribute-or-local-fingerprint', policyRead: 'grav-snapshot', policyWrite: false, approvalReceipt: 'ui-postcondition-only', completion: false, cancellation: 'pending-local-work', sessionScope: 'document', verified: !!host.cdpVerified },
            { id: 'injected-dom', target: 'guarded-workbench', identity: 'host-react-props-or-attribute-or-local-fingerprint', policyRead: 'leased-bridge', policyWrite: false, approvalReceipt: 'ui-postcondition-only', completion: false, cancellation: 'pending-local-work', sessionScope: 'document', verified: false },
            { id: 'native-edit', target: 'known-edit-command', identity: false, policyRead: 'grav-snapshot', policyWrite: false, approvalReceipt: false, completion: false, cancellation: false, sessionScope: false, verified: false, automatic: false, explicitUserCommand: true },
        ],
        interactions: { contract: 'ide-2.5.5-unified-permission-dom', evidence: 'installed-renderer-static-and-synthetic-replay', liveCaptureVerified: false, operations: ['command', 'read_file', 'write_file', 'read_url', 'execute_url', 'mcp'], match: 'exact-target-and-selected-scope', selection: 'already-selected-native-radio', receipts: 'ui-postcondition-only' },
        unsupported: ['direct-host-permission-write', 'command-completion', 'exactly-once', 'native-terminal-approval', 'native-browser-approval', 'native-mcp-approval', 'unrecognized-permission-card', 'permission-scope-switching', 'suggested-persist-pattern', 'agent-question-answer', 'mcp-elicitation', 'sandbox-bypass-scope', 'undocumented-host-grant-rpc'],
    };
}
module.exports = { VERSION, capabilityManifest };
