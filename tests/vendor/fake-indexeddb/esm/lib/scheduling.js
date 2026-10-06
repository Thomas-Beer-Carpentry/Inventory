function getSetImmediateFromJsdom() {
    if (typeof navigator !== "undefined" && /jsdom/.test(navigator.userAgent)) {
        const outerRealmFunctionConstructor = Node.constructor;
        return new outerRealmFunctionConstructor("return setImmediate")();
    } else {
        return undefined;
    }
}
const schedulerPostTask = typeof scheduler !== "undefined" && ((fn)=>scheduler.postTask(fn));
const doSetTimeout = (fn)=>setTimeout(fn, 0);
export const queueTask = (fn)=>{
    const setImmediate = globalThis.setImmediate || getSetImmediateFromJsdom() || schedulerPostTask || doSetTimeout;
    setImmediate(fn);
};


//# sourceURL=src/lib/scheduling.ts