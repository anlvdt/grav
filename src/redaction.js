'use strict';
function redact(text) {
    return String(text).slice(0, 4000)
        .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
        .replace(/((?:--?(?:token|password|secret|api[-_]?key)|authorization)\s*(?:=|:)?\s*)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1[redacted]')
        .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{8,}/g, '[redacted]');
}
module.exports = { redact };
