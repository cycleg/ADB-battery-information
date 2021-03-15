const Mainloop = imports.mainloop;
const {St, Clutter} = imports.gi;
const Main = imports.ui.main;
const GLib = imports.gi.GLib;

let panelButton;
let panelButtonText;
let timeout;

const ERROR_TEXT = "No device";

function init () {
    // Create a Button
    panelButton = new St.Bin({
        style_class : "panel-button",
    });
    
    panelButtonText = new St.Label({
        text : "",
        y_align: Clutter.ActorAlign.CENTER,
    });

    panelButton.set_child(panelButtonText);

    startDaemon();
}

//start adb daemon on init
function startDaemon() {
    GLib.spawn_async(null, ["bash", "-c", "adb devices"], null, GLib.SpawnFlags.SEARCH_PATH, null, null);
}

function getModel() {
    let cmd = 'adb shell getprop ro.product.model';
    let [res, out, error] = GLib.spawn_sync(null, ["bash", "-c", cmd], null, GLib.SpawnFlags.SEARCH_PATH, null);
    return out.toString().replace("\n", "");
}

function getChargeInfo() {
    let cmd = 'adb shell dumpsys battery | grep level | tail -c 3 | python3 -c "(print(input().strip()))"';
    let [res, out, error] = GLib.spawn_sync(null, ["bash", "-c", cmd], null, GLib.SpawnFlags.SEARCH_PATH, null);
    let result = out.toString().replace("\n", "");
    return isEmpty(result) ? ERROR_TEXT : result + "% (" + getModel() + ")";
}

function updateBattery() {
    panelButtonText.set_text(getChargeInfo());
    return true;
}

function enable() {
    // Add the button to the panel
    Main.panel._rightBox.insert_child_at_index(panelButton, 0);
    timeout = Mainloop.timeout_add_seconds(10.0, updateBattery);

    updateBattery();
}

function disable() {
    Main.panel._rightBox.remove_child(panelButton);
    Mainloop.source_remove(timeout);
}

function isEmpty(str) {
	return (!str || str.length === 0 || !str.trim());
}