import { nextId, sort, throttleFunction } from "socket-function/src/misc";
import { observable } from "./mobxTyped";
import { isHidden } from "./hiddenFlag";
import { PersistedMap } from "./PersistMap";
import { isInChromeExtension, isInNewTabPage, isInServiceWorker } from "./helpers";
import { sortTabs } from "./tabCommon";

const STALE_DELAY = 1000 * 60 * 5;

// TODO: Clean up dismissed once in a while
export let dismissed = new PersistedMap<number | string>("dismissed", "local");

// NOTE: This is too big to save in "sync", so even if we wanted to, we can't
export let savedTabs = new PersistedMap<TabInfo>("savedTabs", "local");
export let saveHistory = new PersistedMap<TabInfo>("saveHistory", "local");
if (isInServiceWorker()) {
    saveHistory.setup();
    savedTabs.setup();
}


export interface TabInfo {
    id: number | string;
    windowId: number;
    // Ex, saved
    saved?: boolean;

    url: string;
    active: boolean;
    title: string;
    lastAccessed: number;

    discarded: boolean;
    playingAudio: boolean;
}

export interface TabState {
    rawTabs: TabInfo[];
    screenshots: Record<number | string, string>;
    urlPreviews: Record<number | string, string>;
}



let triggerUpdate = () => { };

// Export TabState for new tab page
export let TabState: TabState = {
    rawTabs: [],
    screenshots: {},
    urlPreviews: {},
};
if (!isInServiceWorker()) {
    TabState = observable(TabState);
}

export async function importTabs(data: string) {
    await chrome.runtime.sendMessage({ type: "importTabs", data });
}
export function exportTabs() {
    return JSON.stringify(TabState, null, 4);
}

if (isInServiceWorker()) {
    chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
        if (message.type === "importTabs") {
            let data = message.data;
            let newTabState = JSON.parse(data) as TabState;
            Object.assign(TabState, newTabState);

            for (let tab of TabState.rawTabs) {
                if (tab.saved) {
                    savedTabs.set(tab.id + "", tab);
                }
            }
            for (let [id, value] of Object.values(TabState.screenshots)) {
                screenshotCache.set(id, value);
            }
            for (let [id, value] of Object.values(TabState.urlPreviews)) {
                urlCache.set(id, value);
            }

            await triggerUpdate();
        }
    });
}

export function saveTabsPromise(tabIds: (number | string)[], noClose?: "noClose") {
    return chrome.runtime.sendMessage({ type: "saveTabs", tabIds, noClose: noClose });
}
export function saveTabs(tabIds: (number | string)[], noClose?: "noClose") {
    saveTabsPromise(tabIds).catch(() => { });
}
if (isInServiceWorker()) {
    chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
        if (message.type === "saveTabs") {
            await saveTabsServiceWorker(message.tabIds, message.noClose);
        }
    });
}
async function saveTabsServiceWorker(tabIds: (number | string)[], noClose?: "noClose") {
    for (let tabId of tabIds) {
        void captureTab(+tabId);
        void updateUrlPreview(+tabId);
        let index = TabState.rawTabs.findIndex(tab => tab.id === tabId);
        let tab = TabState.rawTabs[index];
        await saveTabsBase([tab], noClose);
    }
    await savedTabs.flushPendingUpdates();
    await triggerUpdate();
}
async function saveTabsBase(tabs: TabInfo[], noClose?: "noClose") {
    for (let tab of tabs) {
        dismissed.delete(tab.url + "");
        console.log(`Saving tab ${tab.url}`);
        let baseTabId = tab.id;
        tab = { ...tab };
        tab.saved = true;
        tab.playingAudio = false;
        tab.id = tab.url;
        savedTabs.set(tab.id + "", tab);
        if (!saveHistory.get(tab.url)) {
            saveHistory.set(tab.url, {
                ...tab,
                lastAccessed: Date.now(),
            });
        }

        // ONLY close if it isn't active, or playing audio
        if (typeof baseTabId === "number" && !tab?.active && !tab?.playingAudio && !noClose) {
            await chrome.tabs.remove(baseTabId);
        }
    }
    await savedTabs.flushPendingUpdates();
    await triggerUpdate();
}


if (isInServiceWorker()) {
    // register action
    chrome.action.onClicked.addListener(async (tab) => {
        if (tab.id) {
            let isSaved = !!savedTabs.get(tab.url || "");
            if (isSaved) {
                await unsaveTabsServiceWorker([tab.url || ""]);
            } else {
                await saveTabsServiceWorker([tab.id]);
            }
            await ensureIconStateCorrect();
        }
    });
}

async function getCurrentTab(): Promise<chrome.tabs.Tab | undefined> {
    let tabs = await new Promise<chrome.tabs.Tab[]>(resolve => chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        resolve(tabs);
    }));
    return tabs[0];
}

async function flashIconPattern(pattern: [IconState, number][]) {
    for (let [icon, t] of pattern) {
        curIconState = icon;
        console.log(`Set icon to ${icon}`);
        await chrome.action.setIcon({ path: iconStates[icon] });
        await new Promise(resolve => setTimeout(resolve, t));
    }
    await ensureIconStateCorrect();
}

async function evalInTab<T>(tabId: number, fnc: () => T): Promise<T | undefined> {
    return await new Promise<T | undefined>((resolve, reject) => {
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: fnc
        }, (result) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError.message);
                return;
            }

            resolve(result?.[0].result as any);
        });
    });
}

async function goToTopSaved() {
    let curTab = await getCurrentTab();
    if (!curTab?.id) return;
    let tabs = TabState.rawTabs.filter(x => x.saved);
    dismissed.setup();
    await dismissed.initialLoad;
    sortTabs(tabs);
    let tab = tabs[0];
    if (!tab) return;
    let open = TabState.rawTabs.find(x => !x.saved && x.url === tab.url);
    // UNLESS the current tab is the top saved, then just update it, no need to close it
    if (open && curTab.url !== tab.url) {
        // Close current tab, and move to the existing tab
        console.log(`Closing ${curTab.url} (${curTab.id}) and moving to ${tab.url}`);
        await chrome.tabs.remove(curTab.id);
        await chrome.tabs.update(+open.id, { active: true });
    } else {
        console.log(`Updating ${curTab.url} (${curTab.id}) to ${tab.url}`);
        await chrome.tabs.update(curTab.id, { url: tab.url });
    }
    triggerUpdate();
}

if (isInServiceWorker()) {
    chrome.commands.onCommand.addListener(async (command) => {
        if (command === "save-hover-link") {
            let tab = await getCurrentTab();
            let tabId = tab?.id;
            if (!tabId) return;
            let savedTab = tab && savedTabs.get(tab.url || "");
            if (tab && tab.url && savedTab) {
                let tabs = TabState.rawTabs.filter(x => x.saved);
                sortTabs(tabs);
                if (tabs[0]?.url !== tab.url) {
                    dismissed.delete(tab.url);
                    savedTab.lastAccessed = Date.now();
                    savedTabs.set(tab.url || "", savedTab);
                    console.log(`Updated lastAccessed for ${tab.url}`);
                } else {
                    dismissed.set(tab.url || "", -Date.now());
                    console.log(`Dismissed ${tab.url}`);
                }
                await ensureIconStateCorrect();
                triggerUpdate();
                return;
            }
            let result = await evalInTab(tabId, () => {
                let link = document.querySelector("a:hover") as HTMLAnchorElement | null;
                if (!link) return undefined;
                return {
                    url: link.href,
                    title: link.innerText,
                };
            });
            let noFlash = false;
            if (!result) {
                if (!tab) return;
                // If nothing is selected, save the current tab
                result = { url: tab.url || "", title: tab.title || "" };
                noFlash = true;
            }
            let { url, title } = result;
            console.log("Hotkey found", { result });
            if (!url) return;
            await saveTabsBase([
                {
                    id: url,
                    windowId: -1,
                    url: url,
                    active: false,
                    title: title,
                    lastAccessed: Date.now(),
                    discarded: false,
                    playingAudio: false,
                },
            ]);

            if (!noFlash) {
                await flashIconPattern([["saveAlt", 300], ["normal", 300], ["saveAlt", 300], ["normal", 300]]);
            }
        }
        if (command === "unsave") {
            let tab = await getCurrentTab();
            if (tab?.url) {
                await unsaveTabsServiceWorker([tab?.url]);
            }
            await goToTopSaved();
        }
        if (command === "dismiss-and-goto-next") {
            let tab = await getCurrentTab();
            if (tab?.url && tab.id) {
                if (savedTabs.get(tab.url)) {
                    dismissed.set(tab.url, -Date.now());
                }
            }
            await goToTopSaved();
        }
        // if (command === "save-dismiss-and-goto-next") {
        //     let tab = await getCurrentTab();
        //     if (tab?.url && tab.id) {
        //         if (!savedTabs.get(tab.url)) {
        //             let tabObj = TabState.rawTabs.find(x => x.id === tab.id);
        //             if (tabObj) {
        //                 tabObj.lastAccessed = -Date.now();
        //                 await saveTabsBase([tabObj]);
        //             } else {
        //                 console.log(`Can't find tab ${tab.id} in rawTabs`);
        //             }
        //         }
        //         dismissed.set(tab.url, -Date.now());
        //     }
        //     await goToTopSaved();
        // }
        if (command === "save") {
            let tab = await getCurrentTab();
            if (tab?.id) {
                await saveTabsServiceWorker([tab.id]);
            }
            // Close the tab, as it is saved
            await chrome.tabs.remove(tab?.id!);
        }
    });
}

let iconStates = {
    normal: "icon32.png",
    save: "save32.png",
    saveAlt: "save32Alt.png",
};
type IconState = keyof typeof iconStates;
let curIconState: IconState = "normal";
async function ensureIconStateCorrect() {
    await new Promise<void>(resolve => {
        // Get the active tab
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            let tab = tabs[0];
            let newState: IconState = "normal";
            if (savedTabs.get(tab?.url || "")) {
                sortTabs(TabState.rawTabs);
                let saved = TabState.rawTabs.filter(x => x.saved);
                if (saved[0]?.url === tab?.url) {
                    newState = "save";
                    console.log(`Setting icon to save`);
                } else {
                    newState = "saveAlt";
                    console.log(`Setting icon to saveAlt`);
                }
            }
            if (newState !== curIconState) {
                curIconState = newState;
                await chrome.action.setIcon({ path: iconStates[newState] });
            }
            resolve();
        });
    });
}
if (isInServiceWorker()) {
    chrome.tabs.onActivated.addListener(ensureIconStateCorrect);
    chrome.tabs.onUpdated.addListener(ensureIconStateCorrect);
    chrome.tabs.onRemoved.addListener(ensureIconStateCorrect);
    chrome.windows.onFocusChanged.addListener(ensureIconStateCorrect);
}

export function unsaveTabsPromise(tabIds: (number | string)[]) {
    return chrome.runtime.sendMessage({ type: "unsaveTabs", tabIds });
}
export function unsaveTabs(tabIds: (number | string)[]) {
    unsaveTabsPromise(tabIds).catch(() => { });
}
if (isInServiceWorker()) {
    chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
        if (message.type === "unsaveTabs") {
            await unsaveTabsServiceWorker(message.tabIds);
        }
    });
}
async function unsaveTabsServiceWorker(tabIds: (number | string)[]) {
    for (let tabId of tabIds) {
        console.log(`Unsaving tab ${tabId}`);
        savedTabs.delete(tabId + "");
    }
    let savedTabsRemoved = new Set(tabIds);
    TabState.rawTabs = TabState.rawTabs.filter(tab => !savedTabsRemoved.has(tab.id));
    await savedTabs.flushPendingUpdates();
    await triggerUpdate();
}

// Because apparently, discarded is just wrong
async function isTabDiscarded(tabId: number) {
    return new Promise((resolve) => {
        // chrome.scripting.executeScript(tabId, { code: "document.readyState" }, (result) => {
        //     if (chrome.runtime.lastError) {
        //         console.log(`Error checking tab ${tabId}: ${chrome.runtime.lastError.message}`);
        //         resolve(false);
        //     } else {
        //         resolve(result && result[0] === "complete");
        //     }
        // });
        chrome.scripting.executeScript(
            {
                target: { tabId },
                func: () => {
                    return document.readyState;
                }
            },
            (result) => {
                if (chrome.runtime.lastError) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            }
        );
    });
}

function dataURLtoBlob(dataURL: string) {
    const [header, base64Data] = dataURL.split(",");
    const mimeType = header.match(/:(.*?);/)?.[1]!;
    const byteString = atob(base64Data);
    const arrayBuffer = new ArrayBuffer(byteString.length);
    const uint8Array = new Uint8Array(arrayBuffer);
    for (let i = 0; i < byteString.length; i++) {
        uint8Array[i] = byteString.charCodeAt(i);
    }
    return new Blob([arrayBuffer], { type: mimeType });
}
async function blobToDataURL(blob: Blob) {
    return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
            resolve(reader.result as string);
        };
        reader.readAsDataURL(blob);
    });
}

let urlCache = new PersistedMap<string>("urlCache3", "local", "noKeys");
let pendingLoad = new Map<string, Promise<void>>();

let screenshotCache = new PersistedMap<string>("screenshotCache", "local", "noKeys");

let blockCaptureUntil = new Map<number, number>();
let captureTabQueue: number[] = [];
let runningLoop = false;

async function triggerUpdateBase() {
    void baseUpdateTabs();
}
triggerUpdate = throttleFunction(250, triggerUpdateBase);

async function updateUrlPreview(tabId: number) {
    let tab = TabState.rawTabs.find(tab => tab.id === tabId);
    if (!tab) return;
    let url = tab.url;
    if (!url) return;
    if (isHidden(url)) return;
    let urlPreview = await urlCache.getPromise(url);
    if (urlPreview === undefined) {
        {
            let loading = pendingLoad.get(url);
            if (loading) {
                await loading;
                return updateUrlPreview(tabId);
            }
        }
        let onDone!: () => void;
        let promise = new Promise<void>(resolve => onDone = resolve);
        pendingLoad.set(url, promise);
        try {
            console.log(`No cache for ${url}, have in cache ${urlCache.getKeys().length}`);
            urlPreview = "";
            if (await isTabDiscarded(tabId) || tab.discarded) {
                try {
                    console.log(`Fetching ${url}`);
                    // Fetch the url, and read it that way!
                    let contents = await fetch(url).then(res => res.text());
                    urlPreview = contents.match(/<meta\s+property=["']og:image["']\s+content=["'](.+?)["']\s*\/?>/i)?.[1] || "";
                } catch (e) {
                    console.log(`Error fetching ${url}: ${e}`);
                }
            } else {
                urlPreview = await new Promise<string>((resolve, err) => {
                    chrome.scripting.executeScript(
                        {
                            target: { tabId },
                            func: () => {
                                let meta = document.querySelector("meta[property='og:image']");
                                if (!meta) return;
                                return meta.getAttribute("content");
                            }
                        },
                        (result) => {
                            if (chrome.runtime.lastError) {
                                console.log(`Error getting running query on ${url}: ${chrome.runtime.lastError.message}`);
                                resolve("");
                                return;
                            }
                            console.log(`Got result for ${url}`);
                            resolve(result[0].result || "");
                        }
                    );
                });
            }
            urlCache.set(url, urlPreview);
            console.log(`Save ${url} = ${urlPreview}, ${urlCache.getKeys().length}, save pending ${PersistedMap.info.unsaved}`);
            void triggerUpdate();
        } finally {
            pendingLoad.delete(url);
            onDone();
        }
    }
    TabState.urlPreviews[tabId] = urlPreview;
    TabState.urlPreviews[url] = urlPreview;
}

function canCaptureTab(tabId: number) {
    const tab = TabState.rawTabs.find(tab => tab.id === tabId);
    if (!tab) return;
    if (!tab.active) return;
    const time = Date.now();
    const windowId = tab.windowId;

    let blockUntil = blockCaptureUntil.get(windowId) || 0;
    if (time < blockUntil) return;
    return tab;
}

async function captureTab(tabId: number) {
    if (!canCaptureTab(tabId)) {
        return;
    }
    captureTabQueue.push(tabId);
    runLoop();
}
async function captureTabBase(tabId: number) {
    let tab = canCaptureTab(tabId);
    if (!tab) return;
    if (isHidden(tab.url)) return;
    let windowId = tab.windowId;
    let time = Date.now();

    blockCaptureUntil.set(windowId, time + STALE_DELAY);

    try {
        await new Promise<void>((resolve, rejected) => {
            chrome.tabs.captureVisibleTab(windowId, { format: "jpeg" }, async (dataUrl) => {
                if (chrome.runtime.lastError) {
                    rejected(chrome.runtime.lastError.message);
                    return;
                }
                try {
                    let bitmap = await createImageBitmap(dataURLtoBlob(dataUrl));
                    let newWidth = 300;
                    let newHeight = 300;
                    // Resize with canvas to 300 min dimension
                    let aspectRatio = bitmap.width / bitmap.height;
                    if (aspectRatio > 1) {
                        newWidth = 300 * aspectRatio;
                        newHeight = 300;
                    } else {
                        newWidth = 300;
                        newHeight = 300 / aspectRatio;
                    }
                    let canvas = new OffscreenCanvas(newWidth, newHeight);
                    let ctx = canvas.getContext("2d")!;
                    ctx.drawImage(bitmap, 0, 0, newWidth, newHeight);
                    let newBlob = await canvas.convertToBlob({ type: "image/jpeg" });
                    let newDataURL = await blobToDataURL(newBlob);

                    dataUrl = newDataURL;

                    console.log(`Captured tab in ${Date.now() - time}ms, queue is ${captureTabQueue.length}, ${windowId}:${tabId} (${tab.title})`);
                    TabState.screenshots[tabId] = dataUrl;
                    TabState.screenshots[tab.url] = dataUrl;
                    screenshotCache.set(tab.url, dataUrl);
                    resolve();
                } catch (e) {
                    rejected(e);
                }
            });
        });
    } catch (e) {
        throw e;
    }
}

function runLoop() {
    if (runningLoop) return;
    runningLoop = true;
    void ((async () => {
        try {
            while (true) {
                let tabId = captureTabQueue.shift();
                if (!tabId) break;
                if (!canCaptureTab(tabId)) {
                    continue;
                }
                try {
                    await captureTabBase(tabId);
                } catch (e) {
                    let tab = TabState.rawTabs.find(tab => tab.id === tabId);
                    console.log(`Error capturing tab ${tabId} (${tab?.title}`, e);
                }
                await new Promise<void>(resolve => setTimeout(resolve, 1000 / 1.5));
            }
        } finally {
            runningLoop = false;
        }
    }))();
}

function onTabsUpdated() {
    void baseUpdateTabs();
}



const baseUpdateTabs = throttleFunction(100, async function baseUpdateTabs() {
    await urlCache.initialLoad;
    await savedTabs.initialLoad;
    chrome.tabs.query({}, async (newTabs) => {
        newTabs = newTabs.filter(x => x.id);
        let rawTabs: TabInfo[] = newTabs.map(tab => ({
            id: tab.id || 0,
            windowId: tab.windowId,
            url: tab.url || "",
            active: tab.active,
            title: tab.title || "",
            lastAccessed: tab.lastAccessed || 0,
            discarded: tab.discarded,
            playingAudio: !!tab.audible,
        }));
        let titleLookup = new Map(rawTabs.map(tab => [tab.url, tab.title]));
        for (let tab of savedTabs.getValues()) {
            let newTitle = titleLookup.get(tab.url);
            if (newTitle && newTitle !== tab.title) {
                tab.title = newTitle;
                savedTabs.set(tab.id + "", tab);
            }
            rawTabs.push(tab);
        }
        console.log(`Loaded ${savedTabs.getValues().length} saved / ${rawTabs.length} tabs`);
        let time = Date.now();
        for (let tab of rawTabs) {
            if (TabState.screenshots[tab.url]) continue;
            let cached = await screenshotCache.getPromise(tab.url);
            if (cached) {
                TabState.screenshots[tab.url] = cached;
            }
        }
        for (let tab of rawTabs) {
            if (TabState.urlPreviews[tab.url]) continue;
            let cached = await urlCache.getPromise(tab.url);
            if (cached) {
                TabState.urlPreviews[tab.url] = cached;
            }
        }
        console.log(`Loaded screenshots in ${Date.now() - time}ms`);
        for (let tab of rawTabs) {
            if (tab.id) {
                // Only capture active tabs now
                //void captureTab(tab.id);
                void updateUrlPreview(+tab.id);
            }
        }
        sortTabs(rawTabs);
        TabState.rawTabs = rawTabs;
        await ensureIconStateCorrect();
        await new Promise(resolve => setTimeout(resolve, 0));
        try {
            await chrome.runtime.sendMessage({ type: "tabStateUpdate", data: TabState });
        } catch { }
    });
});


if (isInServiceWorker()) {
    // Initialize and set up listeners
    chrome.tabs.onActivated.addListener((activeInfo) => {
        // Get the url
        let tab = TabState.rawTabs.find(tab => tab.id === activeInfo.tabId);
        if (tab && isHidden(tab.url)) {
            return;
        }

        onTabsUpdated();
        blockCaptureUntil.delete(activeInfo.windowId);
        setTimeout(() => {
            // Wait, otherwise we might screenshot before the url changes, but finish after, which causes
            //      us to screenshot the wrong page!
            void captureTab(activeInfo.tabId);
        }, 500);
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (tab.url && isHidden(tab.url)) {
            return;
        }

        onTabsUpdated();
        console.log(`Tab updated: ${tab.title}, ${changeInfo.status}, ${tab.active ? "active" : ""}`);
        if (tab.active) {
            blockCaptureUntil.delete(tab.windowId);
            setTimeout(() => {
                // Wait, otherwise we might screenshot before the url changes, but finish after, which causes
                //      us to screenshot the wrong page!
                void captureTab(tabId);
            }, 500);
        }
    });

    chrome.tabs.onRemoved.addListener(onTabsUpdated);
    chrome.tabs.onCreated.addListener(onTabsUpdated);

    onTabsUpdated();

    // Periodically update, in case we miss anything
    setInterval(onTabsUpdated, STALE_DELAY);

    // Listen for requests from new tab pages
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === "getTabState") {
            sendResponse(TabState);
        }
    });
}

if (isInNewTabPage()) {
    function syncTabState() {
        // Request initial TabState from service worker
        chrome.runtime.sendMessage({ type: "getTabState" }, (response: TabState) => {
            if (chrome.runtime.lastError) {
                return;
            }
            if (response) {
                Object.assign(TabState, response);
            }
        });

        // Listen for TabState updates from service worker
        chrome.runtime.onMessage.addListener((message) => {
            if (message.type === "tabStateUpdate") {
                Object.assign(TabState, message.data);
            }
        });
    }

    // Initialize TabState synchronization
    syncTabState();
}