export function validateRequiredArguments(numArguments, expectedNumArguments, methodName) {
    if (numArguments < expectedNumArguments) {
        throw new TypeError(`${methodName}: At least ${expectedNumArguments} ${expectedNumArguments === 1 ? "argument" : "arguments"} ` + `required, but only ${arguments.length} passed`);
    }
}


//# sourceURL=src/lib/validateRequiredArguments.ts