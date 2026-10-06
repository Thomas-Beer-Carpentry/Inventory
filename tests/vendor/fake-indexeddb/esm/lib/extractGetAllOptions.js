import isPotentiallyValidKeyRange from "./isPotentiallyValidKeyRange.js";
import enforceRange from "./enforceRange.js";
const extractGetAllOptions = (queryOrOptions, count, numArguments)=>{
    let query;
    let direction;
    if (queryOrOptions === undefined || queryOrOptions === null || isPotentiallyValidKeyRange(queryOrOptions)) {
        query = queryOrOptions;
        if (numArguments > 1 && count !== undefined) {
            count = enforceRange(count, "unsigned long");
        }
    } else {
        const getAllOptions = queryOrOptions;
        if (getAllOptions.query !== undefined) {
            query = getAllOptions.query;
        }
        if (getAllOptions.count !== undefined) {
            count = enforceRange(getAllOptions.count, "unsigned long");
        }
        if (getAllOptions.direction !== undefined) {
            direction = getAllOptions.direction;
        }
    }
    return {
        query,
        count,
        direction
    };
};
export default extractGetAllOptions;


//# sourceURL=src/lib/extractGetAllOptions.ts