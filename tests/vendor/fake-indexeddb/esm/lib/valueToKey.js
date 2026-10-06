import { DataError } from "./errors.js";
import valueToKeyWithoutThrowing, { INVALID_TYPE, INVALID_VALUE } from "./valueToKeyWithoutThrowing.js";
const valueToKey = (input, seen)=>{
    const result = valueToKeyWithoutThrowing(input, seen);
    if (result === INVALID_VALUE || result === INVALID_TYPE) {
        throw new DataError();
    }
    return result;
};
export default valueToKey;


//# sourceURL=src/lib/valueToKey.ts