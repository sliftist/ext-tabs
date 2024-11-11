import { TabInfo, TabState } from "./TabState";

export function getPreview(tabInfo: TabInfo) {
    let url = tabInfo.url;

    // Special case youtube, to get better thumbnails
    if (url.startsWith("https://www.youtube.com/watch?")) {
        let videoId = new URL(url).searchParams.get("v");
        if (videoId) {
            // NOTE: maxresdefault is way too high of a res, and probably lags, BUT, it doesn't
            //      have black bars, so it looks better.
            //  3.jpg shows a frame in the video, which can be nice
            return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
        }
    }
    // Also, shorts
    if (url.startsWith("https://www.youtube.com/shorts/")) {
        let match = url.match(/https:\/\/www\.youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/);
        if (match) {
            return `https://img.youtube.com/vi/${match[1]}/mqdefault.jpg`;
        }
    }

    return (
        TabState.screenshots[tabInfo.id || 0]
        || TabState.urlPreviews[tabInfo.id || 0]
        || TabState.screenshots[tabInfo.url]
        || TabState.urlPreviews[tabInfo.url]
    );
}
