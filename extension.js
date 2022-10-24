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
    var stack = (new Error()).stack;

    // Assuming we're importing this directly from an extension (and we shouldn't
    // ever not be), its UUID should be directly in the path here.
    var stackLine = stack.split('\n')[1];
    if (!stackLine)
        throw new Error('Could not find current file');

    // The stack line is like:
    //   init([object Object])@/home/user/data/gnome-shell/extensions/u@u.id/prefs.js:8
    //
    // In the case that we're importing from
    // module scope, the first field is blank:
    //   @/home/user/data/gnome-shell/extensions/u@u.id/prefs.js:8
    var match = new RegExp('@(.+):\\d+').exec(stackLine);
    if (!match)
        throw new Error('Could not find current file');

    var path = match[1];
    var file = Gio.File.new_for_path(path);
    return [file.get_path(), file.get_parent().get_path(), file.get_basename()];
}

function init () {
    // get the contents of the json file
    var [, extensionPath,] = getCurrentFile();
    var [ok, contents] = GLib.file_get_contents(extensionPath + '/devices.json');
    if (ok) {
        devDescriptions = JSON.parse(contents);
    } else {
        devDescriptions = {};
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

function getConnectedDevices() {
    var devices = [];
    var [res, out, error, status] = GLib.spawn_sync(null, ["bash", "-c", "adb devices"], null, GLib.SpawnFlags.SEARCH_PATH, null);
    if (status !== 0) {
        return devices;
    }
    var lines = out.toString().split("\n");
    if (lines.length < 2) {
        return devices;
    }
    for (var i = 1; i < lines.length; i++) {
        let parts = lines[i].split("\t");
        if (parts.length < 2) {
            continue;
        }
        if (parts[1] !== "device") {
            continue;
        }
        devices.push(parts[0]);
    }
    return devices;
}

function getModel(deviceId) {
    var cmd = 'adb -s ' + deviceId + ' shell getprop ro.product.model';
    var [res, out, error, status] = GLib.spawn_sync(null, ["bash", "-c", cmd], null, GLib.SpawnFlags.SEARCH_PATH, null);
    return out.toString().replace("\n", "");
}

function getDevDescription(model) {
    var ret = model;
    if (ret in devDescriptions) {
        let brand = devDescriptions[ret]["brand"];
        let name = devDescriptions[ret]["name"];
        ret = brand + ((name !== "") ? " " + name : "");
    }
    return (ret !== "") ? ret : model;
}

function getChargeInfo(deviceId) {
    var cmd = 'adb -s ' + deviceId + ' shell dumpsys battery';
    var [res, out, error, status] = GLib.spawn_sync(null, ["bash", "-c", cmd], null, GLib.SpawnFlags.SEARCH_PATH, null);
    if (status !== 0) {
        return "";
    }
    var result = txtToMap(out.toString());
    if (result.size == 0) {
        return "";
    }
    var currTimestamp = Math.floor(Date.now() / 1000);
    var currLevel = result.has("level") ? result.get("level") : -1;
    if (beginBatteryLevel == -1) {
        beginBatteryLevel = currLevel;
    }
    if (prevBatteryLevel == -1) {
        prevBatteryLevel = currLevel;
    }
    if ((currLevel > prevBatteryLevel) || (currTimestamp - refreshTimestamp > EstimatePeriod)) {
        let speed = (currLevel - beginBatteryLevel) * 1.0 / (currTimestamp - beginTimestamp);
        if (currTimestamp - refreshTimestamp > EstimatePeriod) {
            refreshTimestamp = currTimestamp;
        }
        if (speed > 0) {
            let leadingZeros = (n, len) => n.toString().padStart(len, "0");
            let seconds = (100 - currLevel) * 1.0 / speed;
            let hours = Math.floor(seconds / 3600);
            let mins = Math.floor((seconds - hours * 3600) / 60);
            seconds = Math.round(seconds % 60);
            lastEstimation = ", " + hours + ":" + leadingZeros(mins, 2) + ":" + leadingZeros(seconds, 2);
            prevBatteryLevel = currLevel;
        }
    }
    var message = ((currLevel > -1) ? "Battery " + currLevel + "%" : "Getting battery info error") + lastEstimation;
    if (currLevel == 100) {
        message = "Battery fully charged";
    }
    return message + " (" + getDevDescription(getModel(deviceId)) + ")";
}

function showInfo() {
    if (!visible) {
        // Add the button to the panel
        Main.panel._rightBox.insert_child_at_index(panelButton, 0);
        visible = true;
        beginTimestamp = Math.floor(Date.now() / 1000);
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
    var devices = getConnectedDevices();
    if (devices.length > 0) {
        let info = getChargeInfo(devices[0]);
        if (info !== "") {
            panelButtonText.set_text(info);
            showInfo();
        }
    } else {
        hideInfo();
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
        let parts = params[i].split(":");
        dict.set(parts[0].trim(), parts.length > 1 ? parts[1].trim() : "");
    }
    return dict
}
