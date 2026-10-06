import cmp from "./lib/cmp.js";
import { DataError } from "./lib/errors.js";
import valueToKey from "./lib/valueToKey.js";
class FDBKeyRange {
    static only(value) {
        if (arguments.length === 0) {
            throw new TypeError();
        }
        value = valueToKey(value);
        return new FDBKeyRange(value, value, false, false);
    }
    static lowerBound(lower, open = false) {
        if (arguments.length === 0) {
            throw new TypeError();
        }
        lower = valueToKey(lower);
        return new FDBKeyRange(lower, undefined, open, true);
    }
    static upperBound(upper, open = false) {
        if (arguments.length === 0) {
            throw new TypeError();
        }
        upper = valueToKey(upper);
        return new FDBKeyRange(undefined, upper, true, open);
    }
    static bound(lower, upper, lowerOpen = false, upperOpen = false) {
        if (arguments.length < 2) {
            throw new TypeError();
        }
        const cmpResult = cmp(lower, upper);
        if (cmpResult === 1 || cmpResult === 0 && (lowerOpen || upperOpen)) {
            throw new DataError();
        }
        lower = valueToKey(lower);
        upper = valueToKey(upper);
        return new FDBKeyRange(lower, upper, lowerOpen, upperOpen);
    }
    lower;
    upper;
    lowerOpen;
    upperOpen;
    constructor(lower, upper, lowerOpen, upperOpen){
        this.lower = lower;
        this.upper = upper;
        this.lowerOpen = lowerOpen;
        this.upperOpen = upperOpen;
    }
    includes(key) {
        if (arguments.length === 0) {
            throw new TypeError();
        }
        key = valueToKey(key);
        if (this.lower !== undefined) {
            const cmpResult = cmp(this.lower, key);
            if (cmpResult === 1 || cmpResult === 0 && this.lowerOpen) {
                return false;
            }
        }
        if (this.upper !== undefined) {
            const cmpResult = cmp(this.upper, key);
            if (cmpResult === -1 || cmpResult === 0 && this.upperOpen) {
                return false;
            }
        }
        return true;
    }
    get [Symbol.toStringTag]() {
        return "IDBKeyRange";
    }
}
export default FDBKeyRange;


//# sourceURL=src/FDBKeyRange.ts