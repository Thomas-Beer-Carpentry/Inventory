import FDBKeyRange from "../FDBKeyRange.js";
import { DataError } from "./errors.js";
import valueToKey from "./valueToKey.js";
const valueToKeyRange = (value, nullDisallowedFlag = false)=>{
    if (value instanceof FDBKeyRange) {
        return value;
    }
    if (value === null || value === undefined) {
        if (nullDisallowedFlag) {
            throw new DataError();
        }
        return new FDBKeyRange(undefined, undefined, false, false);
    }
    const key = valueToKey(value);
    return FDBKeyRange.only(key);
};
export default valueToKeyRange;


//# sourceURL=src/lib/valueToKeyRange.ts