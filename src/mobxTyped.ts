// @ts-ignore
import * as mobx from "mobx/dist/mobx.cjs.development.js";
import mobxType from "mobx";
type Mobx = typeof mobxType;
const mobxInstance = mobx as Mobx;

mobxInstance.configure({
    enforceActions: "never",
    // reactionScheduler(callback) {
    //     void Promise.resolve().finally(callback);
    // }
});

export let { observable, Reaction, action } = mobxInstance;