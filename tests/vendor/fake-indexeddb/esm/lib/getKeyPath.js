const convertKey = (key)=>typeof key === 'object' && key ? key + '' : key;
export function getKeyPath(keyPath) {
    return Array.isArray(keyPath) ? keyPath.map(convertKey) : convertKey(keyPath);
}


//# sourceURL=src/lib/getKeyPath.ts