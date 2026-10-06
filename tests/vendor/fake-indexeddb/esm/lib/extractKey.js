import valueToKey from "./valueToKey.js";
const extractKey = (keyPath, value)=>{
    if (Array.isArray(keyPath)) {
        const result = [];
        for (let item of keyPath){
            if (item !== undefined && item !== null && typeof item !== "string" && item.toString) {
                item = item.toString();
            }
            const key = extractKey(item, value).key;
            result.push(valueToKey(key));
        }
        return {
            type: "found",
            key: result
        };
    }
    if (keyPath === "") {
        return {
            type: "found",
            key: value
        };
    }
    let remainingKeyPath = keyPath;
    let object = value;
    while(remainingKeyPath !== null){
        let identifier;
        const i = remainingKeyPath.indexOf(".");
        if (i >= 0) {
            identifier = remainingKeyPath.slice(0, i);
            remainingKeyPath = remainingKeyPath.slice(i + 1);
        } else {
            identifier = remainingKeyPath;
            remainingKeyPath = null;
        }
        const isSpecialIdentifier = identifier === "length" && (typeof object === "string" || Array.isArray(object)) || (identifier === "size" || identifier === "type") && typeof Blob !== "undefined" && object instanceof Blob || (identifier === "name" || identifier === "lastModified") && typeof File !== "undefined" && object instanceof File;
        if (!isSpecialIdentifier && (typeof object !== "object" || object === null || !Object.hasOwn(object, identifier))) {
            return {
                type: "notFound"
            };
        }
        object = object[identifier];
    }
    return {
        type: "found",
        key: object
    };
};
export default extractKey;


//# sourceURL=src/lib/extractKey.ts