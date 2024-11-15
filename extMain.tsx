/// <reference path="./node_modules/@types/chrome/index.d.ts" />
import preact from "preact";
import { Layout } from "./src/Layout";
import { observable } from "./src/mobxTyped";
import { isInBrowser, isInServiceWorker } from "./src/helpers";



if (isInBrowser()) {
    window.process = {
        env: {
        }
    } as any;
}

if (isInBrowser()) {
    console.log("Loading");

    /*
    const socket = new WebSocket("ws://localhost:8080");

    socket.onmessage = function (event) {
        if (event.data === "Build completed successfully") {
            location.reload();
        } else {
            console.log(event.data);
        }
    };
    */


    document.body.innerHTML = "";
    preact.render(<Layout />, document.body);
}