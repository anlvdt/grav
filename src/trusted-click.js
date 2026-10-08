'use strict';

// Renderer-owned tickets: console messages alone never authorize pointer input.
function createClickTickets(document, now = () => Date.now()) {
    const pending = new Map();
    let sequence = 0;
    const instance = Math.random().toString(36).slice(2);
    function enqueue(button, validate, attempt) {
        if (!button || button.ownerDocument !== document || pending.size >= 256) return null;
        const ticket = instance + ':' + (++sequence) + ':' + now();
        pending.set(ticket, { button, validate, attempt, at: now() });
        return ticket;
    }
    function prepare(ticket) {
        const request = pending.get(ticket);
        pending.delete(ticket);
        if (!request || now() - request.at >= 1000) return null;
        const { button, validate, attempt } = request;
        if (!button.isConnected || button.disabled || !validate()) return null;
        const rect = button.getBoundingClientRect();
        const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        if (!(rect.width > 0 && rect.height > 0) || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null;
        let hit = document.elementFromPoint(x, y);
        // The browser hit test stops at each open shadow host.
        for (let depth = 0; hit && hit.shadowRoot && depth < 16; depth++) {
            const inner = hit.shadowRoot.elementFromPoint(x, y);
            if (!inner || inner === hit) break;
            hit = inner;
        }
        if (hit !== button && !(button.contains && button.contains(hit))) return null;
        return { x, y, ...attempt() };
    }
    return { enqueue, prepare, discard: ticket => pending.delete(ticket), clear: () => pending.clear() };
}

async function dispatchTrustedClick({ ticket, policyVersion, isCurrent, send, remember }) {
    if (typeof ticket !== 'string' || ticket.length > 100 || !isCurrent()) return false;
    const reply = await send('Runtime.evaluate', {
        expression: `window.__gravObserver && window.__gravObserver.prepareClick(${JSON.stringify(ticket)})`,
        returnByValue: true,
    });
    const point = reply && reply.result && reply.result.value;
    if (!point || point.policyVersion !== policyVersion || typeof point.intentId !== 'string' ||
        !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0) return false;
    // Preparation consumes the renderer claim. Preserve it even if a later check fails.
    if (remember(point) === false) return false;
    if (!isCurrent()) return false;
    const params = { x: point.x, y: point.y, button: 'left', clickCount: 1, pointerType: 'mouse' };
    try {
        await send('Input.dispatchMouseEvent', { ...params, type: 'mousePressed', buttons: 1 });
    } finally {
        // Release once even when the press reply times out; never replay a press.
        await send('Input.dispatchMouseEvent', { ...params, type: 'mouseReleased', buttons: 0 });
    }
    return true;
}

module.exports = { createClickTickets, dispatchTrustedClick, browserSource: createClickTickets.toString() };
