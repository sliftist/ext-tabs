import preact from "preact";
import { css } from "typesafecss";
import { observable } from "./mobxTyped";
import { observer } from "./observer";
import { dismissed, savedTabs, saveHistory, saveTabs, saveTabsPromise, TabInfo, TabState, unsaveTabs, unsaveTabsPromise } from "./TabState";
import { sort } from "socket-function/src/misc";
import { isHidden, getAllHiddenDomains, setHiddenState } from "./hiddenFlag";
import { performDrag2 } from "./drag";
import { PersistedMap } from "./PersistMap";
import { getPreview } from "./previews";
import { sortTabs } from "./tabCommon";


@observer
export class TabPage extends preact.Component<{
    type: "main" | "secondary" | "saved" | "history";
    tabs: TabInfo[];
}> {
    synced = observable({
        showAllTabs: false,
        selectMode: false,
        selected: {} as { [key: string]: boolean },
        selectionRect: null as { left: number; top: number; width: number; height: number } | null,
    });
    lastFocusedTab: TabInfo | null = null;
    tabElements: { [key: number | string]: HTMLElement | null } = {};
    containerElement: HTMLElement | null = null;

    lastTabs: TabInfo[] = [];

    render() {
        let time = Date.now();
        setTimeout(() => {
            console.log("Rendered in", Date.now() - time, "ms");
        });
        const { type } = this.props;
        const { selectMode, selected, selectionRect } = this.synced;
        let tabs = this.props.tabs;

        if (type === "history") {
            tabs = saveHistory.getValues();
            tabs = tabs.filter(x => x.url);
            saveHistory.setup();
        }

        tabs = tabs.slice();
        if (type !== "history") {
            sortTabs(tabs);
        } else {
            sort(tabs, x => -(x.lastAccessed || 0));
        }
        //sort(tabs, x => getPreview(x) ? 0 : 1);
        if (type === "main") {
            sort(tabs, x => x.playingAudio ? 0 : 1);
        }

        this.lastTabs = tabs;


        let allTabs = tabs;
        if (!this.synced.showAllTabs) {
            tabs = tabs.slice(0, 40);
        }
        const GRID_WIDTH = 200;
        const IMAGE_HEIGHT = 136;
        const TEXT_HEIGHT = 45;
        const GRID_HEIGHT = IMAGE_HEIGHT + TEXT_HEIGHT;

        const containerRect = this.containerElement?.getBoundingClientRect() || { left: 0, top: 0 };


        return (
            <div className={css.fillBoth.relative} ref={el => (this.containerElement = el)}>
                <div className={css.fillBoth.vbox(10)}>
                    {this.renderHeader(tabs)}
                    {type === "secondary" &&
                        <div className={css.hbox(10).wrap}>
                            {getAllHiddenDomains().map(domain => (
                                <div
                                    key={domain}
                                    className={css.hbox(10).center.button.hsl(0, 0, 90).padding(10).borderRadius(5).boldStyle.fontSize(20).color("black")}
                                    onClick={() => {
                                        setHiddenState(domain, false);
                                    }}
                                >
                                    {domain} (X)
                                </div>
                            ))}
                        </div>
                    }
                    <div
                        className={
                            css.hbox(10).pad2(4).wrap.maxHeight("100%").overflowAuto
                            + (selectMode && css.hsl(0, 0, 20))
                        }
                        onMouseDown={e => this.onMouseDownTab(undefined, e)}
                    >
                        {tabs.map(tab => (
                            <div
                                key={tab.id}
                                ref={el => (this.tabElements[tab.id] = el)}
                                className={
                                    css
                                        .hbox(10)
                                        .size(GRID_WIDTH, GRID_HEIGHT)
                                        .vbox(2)
                                        .button
                                        .relative
                                    //+ (tab.discarded ? css.opacity(0.5) : "")
                                    + (
                                        selected[tab.id] && css.outline("4px solid hsl(210, 75%, 75%)")
                                        || selectMode && css.outline("4px solid hsla(0, 0%, 0%, 0.3)")
                                    )
                                    + (type !== "history" && dismissed.get(tab.id + "") && css.opacity(0.6))
                                    + (
                                        css.hsl(0, 0, 20)
                                    )
                                }
                                title={`${tab.title} ${tab.url}`}
                                onMouseDown={e => {
                                    if (this.synced.selectMode) {
                                        this.onMouseDownTab(tab, e);
                                    }
                                }}
                                {...{
                                    onAuxClick: async () => {
                                        // Open in a new tab
                                        await chrome.tabs.create({ url: tab.url, active: false });
                                    }
                                } as any}
                                onClick={async e => {
                                    if (this.synced.selectMode) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (tab.saved) {
                                        let allTabs = TabState.rawTabs;
                                        let existingTab = allTabs.find(x => x.url === tab.url && !x.saved);
                                        if (existingTab) {
                                            await chrome.windows.update(existingTab.windowId, { focused: true });
                                            await chrome.tabs.update(+existingTab.id, { active: true });
                                        } else {
                                            await chrome.tabs.create({ url: tab.url });
                                        }
                                    } else {
                                        await chrome.windows.update(tab.windowId, { focused: true });
                                        await chrome.tabs.update(+tab.id, { active: true });
                                    }
                                    window.close();
                                }}
                            >
                                <img
                                    className={
                                        css.width("100%").height(IMAGE_HEIGHT).objectFit("contain").objectPosition("top")
                                            .flexShrink0
                                    }
                                    src={getPreview(tab)}
                                />
                                <div className={
                                    css.pad2(5).height(TEXT_HEIGHT).overflowHidden
                                        .maxWidth("100%")
                                        .overflowWrap("break-word")
                                }>{tab.title}</div>
                                {(() => {
                                    let saved = tab.saved || savedTabs.get(tab.url);
                                    return (
                                        <div
                                            className={
                                                css.absolute.pos(3, 3)
                                                    .opacity(0.8)
                                                    .opacity(0.4, "hover")
                                                    .button
                                            }
                                            onMouseDown={async (e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                if (saved) {
                                                    await unsaveTabsPromise([tab.url]);
                                                } else {
                                                    await saveTabsPromise([tab.id], "noClose");
                                                }
                                                await savedTabs.reloadKeys();
                                            }}
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                            }}
                                        >
                                            <svg width="30" viewBox="0 0 256 256" xml:space="preserve">
                                                <g style="stroke: none; stroke-width: 0; stroke-dasharray: none; stroke-linecap: butt; stroke-linejoin: miter; stroke-miterlimit: 10; fill: none; fill-rule: nonzero; opacity: 1;" transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)" >

                                                    <circle cx="45" cy="45" r="45" style={`stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-linejoin: miter; stroke-miterlimit: 10; fill: hsl(126, ${saved ? "67%" : "0%"}, 46%); fill-rule: nonzero; opacity: 1;`} transform="  matrix(1 0 0 1 0 0) " />
                                                    {saved && <path d="M 38.478 64.5 c -0.01 0 -0.02 0 -0.029 0 c -1.3 -0.009 -2.533 -0.579 -3.381 -1.563 L 21.59 47.284 c -1.622 -1.883 -1.41 -4.725 0.474 -6.347 c 1.884 -1.621 4.725 -1.409 6.347 0.474 l 10.112 11.744 L 61.629 27.02 c 1.645 -1.862 4.489 -2.037 6.352 -0.391 c 1.862 1.646 2.037 4.49 0.391 6.352 l -26.521 30 C 40.995 63.947 39.767 64.5 38.478 64.5 z" style="stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-linejoin: miter; stroke-miterlimit: 10; fill: rgb(255,255,255); fill-rule: nonzero; opacity: 1;" transform=" matrix(1 0 0 1 0 0) " stroke-linecap="round" />}
                                                </g>
                                            </svg>
                                        </div>
                                    );
                                })()}

                                {/* Text too close to the bottom looks bad, but padding won't work, so... we do this */}
                                {/* <div className={css.absolute.left0.bottom0.height(4).fillWidth.hsl(0, 0, 40)} /> */}
                                {selectMode && selected[tab.id] && (
                                    <div className={css.absolute.fillBoth.hsla(210, 80, 54, 0.6)} />
                                )}
                                {tab.playingAudio && (
                                    //+ (tab.playingAudio && css.outline("4px solid hsl(260, 75%, 75%)"))
                                    <div className={css.absolute.bottom0.fillWidth.height(5).hsla(260, 80, 54, 0.6)} />
                                )}
                            </div>
                        ))}
                        {allTabs.length > tabs.length && (
                            <div
                                className={
                                    css
                                        .hbox(10)
                                        .size(GRID_WIDTH, GRID_HEIGHT)
                                        .overflowHidden
                                        .hsl(0, 0, 40)
                                        .vbox(2)
                                        .borderBottom("8px solid transparent")
                                        .button
                                        .center
                                        .fontSize(40)
                                }
                                onClick={() => {
                                    this.synced.showAllTabs = true;
                                }}
                            >
                                +{allTabs.length - tabs.length}
                            </div>
                        )}
                    </div>
                </div>
                {/* Render selection rectangle */}
                {selectionRect && (
                    <div
                        className={
                            css
                                .absolute
                                .hsla(210, 80, 54, 0.3)
                                .border("1px solid hsl(210, 80%, 54%)")
                                .pos(selectionRect.left - containerRect.left, selectionRect.top - containerRect.top)
                                .size(selectionRect.width, selectionRect.height)
                                .pointerEvents("none")
                        }
                    />
                )}
            </div>
        );
    }


    renderHeader(allTabs: TabInfo[]) {
        const { type } = this.props;
        const { selectMode } = this.synced;
        return (
            <div className={css.hbox(10).fillWidth.paddingRight(20)}>
                <div className={css.fontSize(24).boldStyle}>
                    {
                        type === "secondary" && "Hidden Tabs"
                        || type === "saved" && "Saved Tabs"
                        || "Tabs"
                    } ({allTabs.length} / {TabState.rawTabs.length})
                </div>
                <div className={css.marginAuto} />
                {(() => {
                    let selected = Object.keys(this.synced.selected);
                    if (selected.length === 0) return undefined;
                    const goToNext = () => {

                        let indexes = new Set<number>();
                        for (let i = 0; i < allTabs.length; i++) {
                            if (selected.includes(allTabs[i].id + "")) {
                                indexes.add(i);
                            }
                        }
                        let nextIndex = Math.max(...Array.from(indexes)) + 1;
                        let next = allTabs[nextIndex];
                        if (next) {
                            this.synced.selected = { [next.id]: true };
                        }
                        this.lastFocusedTab = next;
                    };
                    return (
                        <>
                            <button data-hotkey="u" onClick={() => unsaveTabs(selected)}>
                                Unsave [u]
                            </button>
                            <button data-hotkey="arrowup" onClick={() => {
                                let tabs = TabState.rawTabs.filter(x => selected.includes(x.id + ""));
                                let toSave = tabs.filter(x => !x.saved);
                                let alreadySaved = tabs.filter(x => x.saved);
                                if (toSave.length > 0) {
                                    saveTabs(toSave.map(x => x.id));
                                } else {
                                    for (let tab of alreadySaved) {
                                        dismissed.delete(tab.url + "");
                                    }
                                }
                                goToNext();
                            }}>
                                Save [Arrow Up]
                            </button>
                            <button data-hotkey="arrowdown" onClick={() => {
                                for (let id of selected) {
                                    dismissed.set(id + "", -Date.now());
                                }
                                goToNext();
                            }}>
                                Dismiss [Arrow Down]
                            </button>
                            <button data-hotkey="h" onClick={async () => {
                                for (let id of selected) {
                                    let tab = TabState.rawTabs.find(x => String(x.id) === id);
                                    if (tab) {
                                        setHiddenState(tab.url, true);
                                    }
                                }
                                goToNext();
                            }}>
                                Hide Domain [h]
                            </button>
                            <button data-hotkey="delete" onClick={async () => {
                                let tabs = TabState.rawTabs.filter(x => selected.includes(x.id + ""));
                                let alreadySaved = tabs.filter(x => x.saved);
                                let toSave = tabs.filter(x => !x.saved);
                                for (let id of alreadySaved.map(x => x.id)) {
                                    unsaveTabs([id]);
                                }
                                for (let tab of toSave) {
                                    await chrome.tabs.remove(+tab.id);
                                }
                                goToNext();
                            }}>
                                Close [Del]
                            </button>
                        </>
                    );
                })()}
                {PersistedMap.info.unsaved > 0 &&
                    <button onClick={() => PersistedMap.saveAllNow()}>
                        Save {PersistedMap.info.unsaved} unsaved config changes
                    </button>
                }
                <button data-hotkey={"e"} onClick={() => (this.synced.selectMode = !selectMode)}>
                    {selectMode ? "Exit Select Mode [e]" : "Enter Select Mode [e]"}
                </button>
            </div>
        );
    }

    componentDidMount() {
        document.addEventListener("keydown", this.onKeyDown);
    }

    componentWillUnmount() {
        document.removeEventListener("keydown", this.onKeyDown);
    }

    onKeyDown = (e: KeyboardEvent) => {
        // Ignore if it is for an input, text area, etc
        let ignore = (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement ||
            e.target instanceof HTMLSelectElement
        );
        if (ignore) return;
        console.log("Checking hotkey", e.key, e);

        let tabs = this.lastTabs;
        if (!e.ctrlKey && !e.shiftKey) {
            let hotkeyDataAttribute = `[data-hotkey="${e.key.toLowerCase()}"]`;
            let el = document.querySelector<HTMLElement>(hotkeyDataAttribute);
            if (el) {
                el.click();
            }
        }
        const currentIndex = this.lastFocusedTab ? tabs.findIndex(t => t.id === this.lastFocusedTab!.id) : -1;

        if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
            e.preventDefault();
            let nextIndex = currentIndex;

            if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                nextIndex = Math.max(0, currentIndex - 1);
            } else if (e.key === "ArrowRight") {
                nextIndex = Math.min(tabs.length - 1, currentIndex + 1);
            }

            const nextTab = tabs[nextIndex];
            if (nextTab) {
                if (e.shiftKey && this.lastFocusedTab) {
                    this.selectRange(nextTab);
                } else {
                    this.synced.selected = { [nextTab.id]: true };
                }
                this.lastFocusedTab = nextTab;
            }
        } else if (e.key.toLowerCase() === "a" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            tabs.forEach(tab => {
                this.synced.selected[tab.id] = true;
            });
        } else if (e.key === "Escape") {
            this.synced.selectMode = false;
        }
    };

    onMouseDownTab = (tab: TabInfo | undefined, e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const { shiftKey, ctrlKey } = e;
        const initialSelected = { ...this.synced.selected };
        const startX = e.clientX;
        const startY = e.clientY;

        performDrag2({
            e,
            onMove: (offset) => {
                let left = startX;
                let top = startY;
                let right = left + offset.x;
                let bottom = top + offset.y;
                if (offset.x < 0) {
                    [left, right] = [right, left];
                }
                if (offset.y < 0) {
                    [top, bottom] = [bottom, top];
                }
                let width = right - left;
                let height = bottom - top;
                console.log({ left, top, right, bottom });

                // Copy the values needed into a plain object
                this.synced.selectionRect = { left, top, width, height };
                this.updateSelectionFromRect({ left, top, right, bottom }, initialSelected, ctrlKey);
            },
            onDone: (offset) => {
                this.synced.selectionRect = null;
            },
            onFinally: (passedSlop) => {
                if (!passedSlop) {
                    if (tab) {
                        this.handleClickSelection(tab, shiftKey, ctrlKey);
                    } else {
                        this.synced.selected = {};
                    }
                }
            },
        });
    };

    handleClickSelection(tab: TabInfo, shiftKey: boolean, ctrlKey: boolean) {
        const { selected } = this.synced;

        if (shiftKey && this.lastFocusedTab) {
            this.selectRange(tab);
        } else if (ctrlKey) {
            if (selected[tab.id]) {
                delete selected[tab.id];
            } else {
                selected[tab.id] = true;
            }
            this.lastFocusedTab = tab;
        } else {
            // Select only this tab
            this.synced.selected = { [tab.id]: true };
            this.lastFocusedTab = tab;
        }
    }

    selectRange(tab: TabInfo) {
        const tabs = this.lastTabs;
        const { selected } = this.synced;

        const startIndex = tabs.findIndex(t => t.id === this.lastFocusedTab?.id);
        const endIndex = tabs.findIndex(t => t.id === tab.id);

        if (startIndex >= 0 && endIndex >= 0) {
            const [start, end] = [startIndex, endIndex].sort((a, b) => a - b);
            for (let i = start; i <= end; i++) {
                selected[tabs[i].id] = true;
            }
        }
    }

    updateSelectionFromRect(rect: { left: number; top: number; right: number; bottom: number }, initialSelected: { [key: number | string]: boolean }, ctrlKey: boolean) {
        const { selected } = this.synced;
        const tabs = this.lastTabs;
        tabs.forEach(tab => {
            const el = this.tabElements[tab.id];
            if (el) {
                const elRect = el.getBoundingClientRect();
                if (this.rectsOverlap(rect, elRect)) {
                    if (ctrlKey) {
                        selected[tab.id] = !initialSelected[tab.id];
                    } else {
                        selected[tab.id] = true;
                    }
                } else {
                    if (!ctrlKey) {
                        delete selected[tab.id];
                    }
                }
            }
        });
    }

    rectsOverlap(rect1: { left: number; top: number; right: number; bottom: number }, rect2: DOMRect) {
        return !(rect1.right < rect2.left ||
            rect1.left > rect2.right ||
            rect1.bottom < rect2.top ||
            rect1.top > rect2.bottom);
    }
}
