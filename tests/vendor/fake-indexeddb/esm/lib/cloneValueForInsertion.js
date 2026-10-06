export function cloneValueForInsertion(value, transaction) {
    if (transaction._state !== "active") {
        throw new Error("Assert: transaction state is active");
    }
    transaction._state = "inactive";
    try {
        return structuredClone(value);
    } finally{
        transaction._state = "active";
    }
}


//# sourceURL=src/lib/cloneValueForInsertion.ts