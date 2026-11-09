// Lossless GSC1 column decoder. Integer-string vectors are restored through
// BigInt, never Number; null/absent values have explicit two-bit masks.
export const BINARY_TYPE = 'application/vnd.gramstat.columns.v1';
export function decodeColumns(buffer) {
    const bytes = new Uint8Array(buffer), view = new DataView(buffer), utf8 = new TextDecoder('utf-8', { fatal: true });
    let offset = 0, budget = 5000000;
    const take = (n) => {
        if (!Number.isSafeInteger(n) || n < 0 || offset + n > bytes.length) throw Error('Truncated chart data');
        const result = bytes.subarray(offset, offset + n); offset += n; return result;
    };
    const byte = () => take(1)[0];
    const uint = () => {
        let value = 0, factor = 1;
        for (let i = 0; i < 8; i++) {
            const b = byte(); value += (b & 127) * factor;
            if (!Number.isSafeInteger(value)) throw Error('Invalid chart length');
            if (b < 128) return value;
            factor *= 128;
        }
        throw Error('Invalid chart integer');
    };
    const count = () => { const n = uint(); budget -= n; if (budget < 0) throw Error('Chart data too large'); return n; };
    const text = () => utf8.decode(take(uint()));
    const value = (depth = 0) => {
        if (depth > 64) throw Error('Chart nesting too deep');
        const tag = byte();
        if (tag === 0) return null;
        if (tag === 1 || tag === 2) return tag === 2;
        if (tag === 3) { const at = offset; take(8); return view.getFloat64(at, true); }
        if (tag === 4) return text();
        if (tag === 8) return undefined;
        if (tag === 6) {
            const result = {}, n = count();
            for (let i = 0; i < n; i++) Object.defineProperty(result, text(), { value: value(depth + 1), enumerable: true, writable: true, configurable: true });
            return result;
        }
        const n = count();
        if (tag === 5) return Array.from({ length: n }, () => value(depth + 1));
        if (tag === 10) { const v = value(depth + 1); return Array(n).fill(v); }
        if (tag === 7) {
            const result = Array.from({ length: n }, () => ({})), columns = count();
            for (let j = 0; j < columns; j++) {
                const key = text(), column = value(depth + 1);
                if (!Array.isArray(column) || column.length !== n) throw Error('Invalid chart column');
                for (let i = 0; i < n; i++) if (column[i] !== undefined) Object.defineProperty(result[i], key, { value: column[i], enumerable: true, writable: true, configurable: true });
            }
            return result;
        }
        if (tag === 9) {
            const kind = byte(), width = byte(), masked = byte();
            if (kind > 1 || ![1, 2, 4, 8, 16].includes(width) || masked > 1) throw Error('Invalid chart vector');
            const mask = masked ? take(Math.ceil(n / 4)) : null;
            return Array.from({ length: n }, (_, i) => {
                const state = mask ? (mask[i >> 2] >> ((i & 3) * 2)) & 3 : 0;
                if (state === 1) return null;
                if (state === 2) return undefined;
                if (state === 3) throw Error('Invalid chart null mask');
                const b = take(width);
                let v = 0n; for (let j = width - 1; j >= 0; j--) v = (v << 8n) | BigInt(b[j]);
                if (kind === 1) return v.toString();
                const number = Number(v); if (!Number.isSafeInteger(number)) throw Error('Unsafe chart number'); return number;
            });
        }
        if (tag === 11 || tag === 12) {
            const kind = tag === 12 ? byte() : 0, start = uint(), step = uint();
            if (kind > 1) throw Error('Invalid chart axis');
            return Array.from({ length: n }, (_, i) => {
                const v = start + i * step;
                if (!Number.isSafeInteger(v)) throw Error('Unsafe chart axis');
                if (tag === 11) return v;
                return new Date(kind ? Date.UTC(Math.floor(v / 12), v % 12, 1) : v * 86400000).toISOString().slice(0, 10);
            });
        }
        throw Error('Unknown chart encoding');
    };
    if (utf8.decode(take(4)) !== 'GSC1') throw Error('Unsupported chart encoding');
    const result = value();
    if (offset !== bytes.length) throw Error('Trailing chart data');
    return result;
}
