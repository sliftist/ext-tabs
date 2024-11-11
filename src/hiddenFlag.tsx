import { sha256HashBuffer } from "socket-function/src/misc";
import { PersistedMap } from "./PersistMap";
// @ts-ignore
//import sha256 from "./sha256";

// NOTE: We don't sha256 hash, because... these are domains, so they should be fairly small.
//  Also, we need to show them in the browser anyways...

let hiddenLookup = new PersistedMap<"1">("hidden", "sync");

export function isHidden(url: string) {
    if (!(url.startsWith("https://") || url.startsWith("file://") || url.startsWith("http://"))) return true;
    let domain = getDomain(url);
    return hiddenLookup.get(domain) === "1";
}

export function setHiddenState(urlOrDomain: string, hidden: boolean) {
    let domain = getDomain(urlOrDomain);
    if (hidden) {
        hiddenLookup.set(domain, "1");
    } else {
        hiddenLookup.delete(domain);
    }
}

export function getAllHiddenDomains() {
    return hiddenLookup.getKeys();
}

function getDomain(urlOrDomain: string) {
    try {
        return new URL(urlOrDomain).hostname.split(".").slice(-2).join(".");
    } catch (e) {
        return urlOrDomain.split(".").slice(-2).join(".");
    }
}