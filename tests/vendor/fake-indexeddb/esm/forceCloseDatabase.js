import closeConnection from "./lib/closeConnection.js";
export default function forceCloseDatabase(db) {
    closeConnection(db, true);
}


//# sourceURL=src/forceCloseDatabase.ts