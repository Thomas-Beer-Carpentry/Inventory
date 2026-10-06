export default function isSharedArrayBuffer(input) {
    return typeof SharedArrayBuffer !== "undefined" && input instanceof SharedArrayBuffer;
}


//# sourceURL=src/lib/isSharedArrayBuffer.ts