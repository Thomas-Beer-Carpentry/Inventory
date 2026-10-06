export function intersection(set1, set2) {
    if ("intersection" in set1) {
        return set1.intersection(set2);
    }
    return new Set([
        ...set1
    ].filter((item)=>set2.has(item)));
}


//# sourceURL=src/lib/intersection.ts