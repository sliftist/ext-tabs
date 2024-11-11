import preact from "preact";
import { observer } from "./observer";
import { observable } from "./mobxTyped";
import { css } from "typesafecss";
import { exportTabs, importTabs, TabState } from "./TabState";


@observer
export class ConfigPage extends preact.Component<{
}> {
    synced = observable({
    });
    render() {
        return (
            <div className={css.vbox(20)}>
                <button onClick={() => {
                    let data = exportTabs();
                    let file = new Blob([data], { type: "application/json" });
                    let url = URL.createObjectURL(file);
                    let a = document.createElement("a");
                    a.href = url;
                    a.download = "tabs.json";
                    a.click();
                }}>
                    Export
                </button>
                <button onClick={() => {
                    let input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".json";
                    input.onchange = async () => {
                        if (input.files?.length) {
                            let file = input.files[0];
                            let text = await file.text();
                            await importTabs(text);
                        }
                    };
                    input.click();
                }}>
                    Import
                </button>
            </div>
        );
    }
}