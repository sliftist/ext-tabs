import { observable } from "./mobxTyped";
import { isInBuild } from "./helpers";


export class PersistedMap<T> {
    public static info = observable({
        unsaved: 0,
    });
    private static allMaps: PersistedMap<any>[] = [];
    public static async saveAllNow() {
        for (let map of this.allMaps) {
            await map.flushPendingUpdates();
        }
    }
    public initialLoad = Promise.resolve();

    constructor(
        private collection: string,
        private type: "local" | "sync",
        private noKeys?: "noKeys",
    ) {
        if (isInBuild()) return;
        PersistedMap.allMaps.push(this);
    }
    private setupOnce = false;
    public setup() {
        if (this.setupOnce) return;
        this.setupOnce = true;

        this.initialLoad = this.loadData();
        this.initialLoad.catch(e => console.error("Error loading data", e));

        if (!this.noKeys) {
            let reloadRate = 60 * 60 * 1000;
            if (this.type === "local") {
                reloadRate = 60 * 1000;
            }
            setInterval(() => this.reloadKeys(), reloadRate);
        }
    }

    private FLUSH_DELAY = (
        this.type === "local" && 1000
        || 60 * 1000
    );

    private cache = new Map<string, T>();
    private pendingUpdates = new Map<string, T | undefined>();

    private synced = observable({
        seqNum: 0
    });

    public get(key: string): T | undefined {
        this.setup();
        this.synced.seqNum;
        return this.cache.get(key);
    }
    public getPromise(key: string): Promise<T | undefined> {
        return this.getFromStorage(key);
    }

    public set(key: string, value: T): void {
        this.cache.set(key, value);
        if (!this.pendingUpdates.has(key)) {
            PersistedMap.info.unsaved++;
        }
        this.pendingUpdates.set(key, value);
        this.synced.seqNum++;
        this.onPendingUpdateChanged();
    }

    public delete(key: string): void {
        this.cache.delete(key);
        if (!this.pendingUpdates.has(key)) {
            PersistedMap.info.unsaved++;
        }
        this.pendingUpdates.set(key, undefined);
        this.synced.seqNum++;
        this.onPendingUpdateChanged();
    }

    public getKeys(): string[] {
        this.synced.seqNum;
        return Array.from(this.cache.keys());
    }

    public getValues(): T[] {
        this.synced.seqNum;
        return Array.from(this.cache.values());
    }

    private getStorage() {
        return this.type === "local" ? chrome.storage.local : chrome.storage.sync;
    }

    private getKey(key: string) {
        return JSON.stringify([this.collection, key]);
    }

    private getKeysKey() {
        return JSON.stringify([this.collection, "__keys"]);
    }

    private async loadData() {
        let keys = await this.getKeysFromStorage();
        console.log(`Loaded keys ${keys.length} into ${this.collection}`);
        for (let key of keys) {
            let value = await this.getFromStorage(key);
            if (value !== undefined) {
                this.cache.set(key, value);
            }
        }
        this.synced.seqNum++;
    }

    private async getKeysFromStorage(): Promise<string[]> {
        if (this.noKeys) return [];
        let keysKey = this.getKeysKey();
        let storage = this.getStorage();
        let result = await storage.get(keysKey);
        let keysString = result[keysKey] || "[]";
        try {
            return JSON.parse(keysString) as string[];
        } catch (e) {
            console.error("Error parsing keys", e);
            return [];
        }
    }

    private async getFromStorage(key: string, reload?: "reload"): Promise<T | undefined> {
        if (!reload && this.cache.has(key)) {
            return this.cache.get(key);
        }
        let storageKey = this.getKey(key);
        let storage = this.getStorage();
        let result = await storage.get(storageKey);
        let valueString = result[storageKey];
        if (valueString !== undefined) {
            try {
                return JSON.parse(valueString) as T;
            } catch (e) {
                console.error("Error parsing value for key", key, e);
                return undefined;
            }
        } else {
            return undefined;
        }
    }

    private doNotUpdateBefore = 0;
    private pendingUpdate = false;
    private onPendingUpdateChanged = () => {
        let now = Date.now();
        if (now < this.doNotUpdateBefore) {
            if (!this.pendingUpdate) {
                this.pendingUpdate = true;
                setTimeout(() => {
                    this.pendingUpdate = false;
                    this.onPendingUpdateChanged();
                }, this.doNotUpdateBefore - now);
            }
            return;
        }
        this.doNotUpdateBefore = now + this.FLUSH_DELAY;
        this.flushPendingUpdates().catch(e => console.error("Error flushing updates", e));
    };

    public async flushPendingUpdates() {
        if (this.pendingUpdates.size === 0) {
            return;
        }
        this.setup();
        await this.initialLoad;

        let updates = new Map(this.pendingUpdates);
        this.pendingUpdates.clear();
        PersistedMap.info.unsaved -= updates.size;

        let storage = this.getStorage();

        let toSet: { [key: string]: string } = {};
        let toRemove: string[] = [];

        for (let [key, value] of updates) {
            let storageKey = this.getKey(key);
            if (value !== undefined) {
                toSet[storageKey] = JSON.stringify(value);
            } else {
                toRemove.push(storageKey);
            }
        }

        if (!this.noKeys) {
            // Update the keys list
            let keysKey = this.getKeysKey();
            let keys = this.getKeys();
            toSet[keysKey] = JSON.stringify(keys);
        }

        try {
            await storage.set(toSet);
            if (toRemove.length > 0) {
                await storage.remove(toRemove);
            }
            console.log(`${this.collection} | Flushed ${updates.size} updates, cached keys ${this.cache.size}`);
        } catch (e) {
            console.error("Error flushing updates", e);
            // Requeue updates
            for (let [key, value] of updates) {
                this.pendingUpdates.set(key, value);
            }
        }
        PersistedMap.info.unsaved += this.pendingUpdates.size;
    }

    public async reloadKeys() {
        try {
            let keys = await this.getKeysFromStorage();
            let newKeysSet = new Set(keys);
            let currentKeysSet = new Set(this.cache.keys());

            let addedKeys = [...newKeysSet].filter(x => !currentKeysSet.has(x));
            let removedKeys = [...currentKeysSet].filter(x => !newKeysSet.has(x));

            for (let key of addedKeys) {
                let value = await this.getFromStorage(key, "reload");
                if (value !== undefined) {
                    this.cache.set(key, value);
                }
            }

            for (let key of removedKeys) {
                this.cache.delete(key);
            }

            this.synced.seqNum++;
        } catch (e) {
            console.error("Error reloading keys", e);
        }
    }
}
