import { ConstraintError } from "./errors.js";
const MAX_KEY = 9007199254740992;
class KeyGenerator {
    num = 0;
    next() {
        if (this.num >= MAX_KEY) {
            throw new ConstraintError();
        }
        this.num += 1;
        return this.num;
    }
    setIfLarger(num) {
        const value = Math.floor(Math.min(num, MAX_KEY)) - 1;
        if (value >= this.num) {
            this.num = value + 1;
        }
    }
}
export default KeyGenerator;


//# sourceURL=src/lib/KeyGenerator.ts