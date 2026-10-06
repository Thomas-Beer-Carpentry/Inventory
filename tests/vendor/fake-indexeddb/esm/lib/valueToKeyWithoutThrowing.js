import isSharedArrayBuffer from "./isSharedArrayBuffer.js";
export const INVALID_TYPE = Symbol("INVALID_TYPE");
export const INVALID_VALUE = Symbol("INVALID_VALUE");
const valueToKeyWithoutThrowing = (input, seen)=>{
    if (typeof input === "number") {
        if (isNaN(input)) {
            return INVALID_VALUE;
        }
        return input;
    } else if (Object.prototype.toString.call(input) === "[object Date]") {
        const ms = input.valueOf();
        if (isNaN(ms)) {
            return INVALID_VALUE;
        }
        return new Date(ms);
    } else if (typeof input === "string") {
        return input;
    } else if (input instanceof ArrayBuffer || isSharedArrayBuffer(input) || typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(input)) {
        if ("detached" in input ? input.detached : input.byteLength === 0) {
            return INVALID_VALUE;
        }
        let arrayBuffer;
        let offset = 0;
        let length = 0;
        if (input instanceof ArrayBuffer || isSharedArrayBuffer(input)) {
            arrayBuffer = input;
            length = input.byteLength;
        } else {
            arrayBuffer = input.buffer;
            offset = input.byteOffset;
            length = input.byteLength;
        }
        return arrayBuffer.slice(offset, offset + length);
    } else if (Array.isArray(input)) {
        if (seen === undefined) {
            seen = new Set();
        } else if (seen.has(input)) {
            return INVALID_VALUE;
        }
        seen.add(input);
        let hasInvalid = false;
        const keys = Array.from({
            length: input.length
        }, (_, i)=>{
            if (hasInvalid) {
                return;
            }
            const hop = Object.hasOwn(input, i);
            if (!hop) {
                hasInvalid = true;
                return;
            }
            const entry = input[i];
            const key = valueToKeyWithoutThrowing(entry, seen);
            if (key === INVALID_VALUE || key === INVALID_TYPE) {
                hasInvalid = true;
                return;
            }
            return key;
        });
        if (hasInvalid) {
            return INVALID_VALUE;
        }
        return keys;
    } else {
        return INVALID_TYPE;
    }
};
export default valueToKeyWithoutThrowing;


//# sourceURL=src/lib/valueToKeyWithoutThrowing.ts