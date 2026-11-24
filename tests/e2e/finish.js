// Posts a suite's final report, and closes the tab if the runner says it passed.
// Failing tabs stay open so their log can be read. WebKit only lets a page close a tab
// whose history has one entry, so the pages mustn't add any.
export async function finishReport(name, body) {
    const response = await fetch(`/report?name=${encodeURIComponent(name)}&ext=json&final=1`, { method: 'POST', body });
    if (await response.text() === 'close') window.close();
}
