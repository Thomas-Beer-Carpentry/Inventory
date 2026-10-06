import FDBKeyRange from "../FDBKeyRange.js";
import valueToKeyWithoutThrowing, { INVALID_TYPE } from "./valueToKeyWithoutThrowing.js";
const isPotentiallyValidKeyRange = (value)=>{
    if (value instanceof FDBKeyRange) {
        return true;
    }
    const key = valueToKeyWithoutThrowing(value);
    return key !== INVALID_TYPE;
};
export default isPotentiallyValidKeyRange;


//# sourceURL=src/lib/isPotentiallyValidKeyRange.ts