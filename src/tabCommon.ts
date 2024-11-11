import { sort } from "socket-function/src/misc";
import { dismissed, TabInfo } from "./TabState";

export function sortTabs(tabs: TabInfo[]) {
    sort(tabs, x => -(dismissed.get(x.id + "") || x.lastAccessed || 0));
}