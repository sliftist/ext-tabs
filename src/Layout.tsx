import preact from "preact";
import { TabPage } from "./TabPage";
import { css } from "typesafecss";
import { observable } from "./mobxTyped";
import { observer } from "./observer";
import { TabState } from "./TabState";
import { isHidden } from "./hiddenFlag";
import { ConfigPage } from "./ConfigPage";

@observer
export class Layout extends preact.Component {
    synced = observable({
        tab: "",
    });
    render() {
        let allTabs = TabState.rawTabs;
        let hiddenTabs = allTabs.filter(x => isHidden(x.url));
        let visibleTabs = allTabs.filter(x => !isHidden(x.url));
        let realTabs = visibleTabs.filter(x => !x.saved);
        let saved = visibleTabs.filter(x => x.saved);

        const TABS = [
            {
                name: "Open",
                ui: <TabPage type="main" tabs={realTabs} />,
                tabs: realTabs,
            },
            {
                name: "Saved",
                ui: <TabPage type="saved" tabs={saved} />,
                tabs: saved,
            },
            {
                name: "Hidden",
                ui: <TabPage type="secondary" tabs={hiddenTabs} />,
                tabs: hiddenTabs,
            },
            {
                name: "History",
                ui: <TabPage type="history" tabs={[]} />,
            },
            {
                name: "Config",
                ui: <ConfigPage />,
            },
        ];
        let tab = TABS.find(x => x.name === this.synced.tab) || TABS[0];
        if (tab.name === "Open" && !tab.tabs?.length) {
            tab = TABS[1];
        }
        return (
            <div className={
                css.size("100vw", "100vh").overflowAuto
                    .paddingBottom(0, "important")
                    .paddingRight(0, "important")
                    .hbox(20)
            }>
                <div
                    className={css.vbox(0).width(100).overflowHidden.fillHeight}
                >
                    {TABS.map((x, index, list) => (
                        <div
                            key={x.name}
                            className={
                                css.vbox(2).center.button
                                    .hsl(0, 0, x.name === tab.name ? 10 : 20)
                                    .padding(10)
                                    .fillWidth
                                    .boldStyle
                                    .fontSize(20)
                                    .color(x.name === tab.name ? "white" : "gray")
                                + (x.name === tab.name && css.border("1px solid hsl(0, 0%, 30%)"))
                                + (index !== list.length - 1 && css.borderBottom("2px solid hsl(0, 0%, 30%)"))
                                + css.borderLeftWidth(0, "important")
                            }
                            onClick={() => this.synced.tab = x.name}
                        >
                            <div>{x.name}</div>
                            {x.tabs && <div>({x.tabs.length})</div>}
                        </div>
                    ))}
                    <div className={css.marginAuto} />
                </div>
                <div className={css.fillBoth.overflowAuto.pad(20, 10)}>
                    {tab.ui}
                </div>
            </div>
        );
    }
}