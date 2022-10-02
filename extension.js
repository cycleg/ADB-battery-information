const Mainloop = imports.mainloop;
const {St, Clutter} = imports.gi;
const Main = imports.ui.main;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const EstimatePeriod = 180;

let devDescriptions;
let panelButton;
let panelButtonText;
let timeout;
let visible;
let beginTimestamp;
let refreshTimestamp;
let beginBatteryLevel;
let prevBatteryLevel;
let lastEstimation;

function getCurrentFile() {
    let stack = (new Error()).stack;

    // Assuming we're importing this directly from an extension (and we shouldn't
    // ever not be), its UUID should be directly in the path here.
    let stackLine = stack.split('\n')[1];
    if (!stackLine)
        throw new Error('Could not find current file');

    // The stack line is like:
    //   init([object Object])@/home/user/data/gnome-shell/extensions/u@u.id/prefs.js:8
    //
    // In the case that we're importing from
    // module scope, the first field is blank:
    //   @/home/user/data/gnome-shell/extensions/u@u.id/prefs.js:8
    let match = new RegExp('@(.+):\\d+').exec(stackLine);
    if (!match)
        throw new Error('Could not find current file');

    let path = match[1];
    let file = Gio.File.new_for_path(path);
    return [file.get_path(), file.get_parent().get_path(), file.get_basename()];
}

function init () {
    // get the contents of the json file
    let [, extensionPath,] = getCurrentFile()
    let [ok, contents] = GLib.file_get_contents(extensionPath + '/devices.json');
    if (ok) {
        devDescriptions = JSON.parse(contents);
    } else {
        devDescriptions = {}
    }
    // Create a Button
    panelButton = new St.Bin({
        style_class : "panel-button",
    });
    
    panelButtonText = new St.Label({
        text : "",
        y_align: Clutter.ActorAlign.CENTER,
    });

    panelButton.set_child(panelButtonText);

    visible = false;
    beginTimestamp = 0;
    refreshTimestamp = 0;
    beginBatteryLevel = -1;
    prevBatteryLevel = -1;
    lastEstimation = "";

    startDaemon();
}

//start adb daemon on init
function startDaemon() {
    GLib.spawn_async(null, ["bash", "-c", "adb devices"], null, GLib.SpawnFlags.SEARCH_PATH, null, null);
}

function getModel() {
    let cmd = 'adb shell getprop ro.product.model';
    let [res, out, error, status] = GLib.spawn_sync(null, ["bash", "-c", cmd], null, GLib.SpawnFlags.SEARCH_PATH, null);
    return out.toString().replace("\n", "");
}

function getDevDescription(model) {
    let ret = model
    if (ret in devDescriptions) {
      let brand = devDescriptions[ret]["brand"]
      let name = devDescriptions[ret]["name"]
      ret = brand + ((name !== "") ? " " + name : "")
    }
    return (ret !== "") ? ret : model;
}

function getChargeInfo() {
    let cmd = 'adb shell dumpsys battery';
    let currTimestamp = Date.now() / 1000;
    let [res, out, error, status] = GLib.spawn_sync(null, ["bash", "-c", cmd], null, GLib.SpawnFlags.SEARCH_PATH, null);
    if (status !== 0) {
        return ""
    }
    let result = txtToMap(out.toString());
    if (result.size == 0) {
        return ""
    }
    let currLevel = result.has("level") ? result.get("level") : -1;
    if (beginBatteryLevel == -1) {
        beginBatteryLevel = currLevel;
    }
    if (prevBatteryLevel == -1) {
        prevBatteryLevel = currLevel;
    }
    if ((currLevel > prevBatteryLevel) || (currTimestamp - refreshTimestamp > EstimatePeriod)) {
        let speed = (currLevel - beginBatteryLevel) * 1.0 / (currTimestamp - beginTimestamp);
        let seconds = (100 - currLevel) * 1.0 / speed;
        let hours = Math.floor(seconds / 3600);
        let mins = Math.floor((seconds - hours * 3600) / 60);
        seconds = Math.round(seconds % 60);
        let leadingZeros = (n, len) => n.toString().padStart(len, "0");
        lastEstimation = ", " + hours + ":" + leadingZeros(mins, 2) + ":" + leadingZeros(seconds, 2);
        if (currTimestamp - refreshTimestamp > EstimatePeriod) {
            refreshTimestamp = currTimestamp;
        }
        prevBatteryLevel = currLevel;
    }
    let message = ((currLevel > -1) ? "Battery " + currLevel + "%" : "Getting battery info error") + lastEstimation;
    if (currLevel == 100) {
        message = "Battery fully charged"
    }
    return message + " (" + getDevDescription(getModel()) + ")";
}

function showInfo() {
    if (!visible) {
        // Add the button to the panel
        Main.panel._rightBox.insert_child_at_index(panelButton, 0);
        visible = true;
        beginTimestamp = Date.now() / 1000;
        refreshTimestamp = beginTimestamp;
    }
}

function hideInfo() {
    if (visible) {
        lastEstimation = "";
        prevBatteryLevel = -1;
        beginBatteryLevel = -1;
        refreshTimestamp = 0;
        beginTimestamp = refreshTimestamp;
        visible = false;
        Main.panel._rightBox.remove_child(panelButton);
    }
}

function updateBattery() {
    let info = getChargeInfo()
    if (info !== "") {
        panelButtonText.set_text(info);
        showInfo();
    } else {
        hideInfo()
    }
    return true;
}

function enable() {
    showInfo();
    timeout = Mainloop.timeout_add_seconds(10.0, updateBattery);
    updateBattery();
}

function disable() {
    hideInfo();
    Mainloop.source_remove(timeout);
}

function txtToMap(str) {
    var params = str.split("\n");
    var dict = new Map();
    for (var i = 0; i < params.length; i++) {
      var parts = params[i].split(":");
      dict.set(parts[0].trim(), parts.length > 1 ? parts[1].trim() : "");
    }
    return dict
}
