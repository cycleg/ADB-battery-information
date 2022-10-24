const Mainloop = imports.mainloop;
const {St, Clutter} = imports.gi;
const Main = imports.ui.main;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const EstimatePeriod = 180;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const DeviceInfo = Me.imports.DeviceInfo.DeviceInfo;

let devDescriptions;
let panelButton;
let panelButtonText;
let timeout;
let visible;
let devicesData = new Map();

function init () {
    var [ok, contents] = GLib.file_get_contents(Me.path + '/devices.json');
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
    var devData = devicesData.get(deviceId)
    if (devData.beginBatteryLevel == -1) {
        devData.beginBatteryLevel = currLevel;
    }
    if (devData.prevBatteryLevel == -1) {
        devData.prevBatteryLevel = currLevel;
    }
    if ((currLevel > devData.prevBatteryLevel) || (currTimestamp - devData.refreshTimestamp > EstimatePeriod)) {
        let speed = (currLevel - devData.beginBatteryLevel) * 1.0 / (currTimestamp - devData.beginTimestamp);
        if (currTimestamp - devData.refreshTimestamp > EstimatePeriod) {
            devData.refreshTimestamp = currTimestamp;
        }
        if (speed > 0) {
            let leadingZeros = (n, len) => n.toString().padStart(len, "0");
            let seconds = (100 - currLevel) * 1.0 / speed;
            let hours = Math.floor(seconds / 3600);
            let mins = Math.floor((seconds - hours * 3600) / 60);
            seconds = Math.round(seconds % 60);
            devData.lastEstimation = ", " + hours + ":" + leadingZeros(mins, 2) + ":" + leadingZeros(seconds, 2);
            devData.prevBatteryLevel = currLevel;
        }
    }
    var message = ((currLevel > -1) ? "Battery " + currLevel + "%" : "Getting battery info error") + devData.lastEstimation;
    if (currLevel == 100) {
        message = "Battery fully charged";
    }
    if (devData.model == "") {
        devData.model = getModel(deviceId);
    }
    devicesData.set(deviceId, devData);
    return message + " (" + getDevDescription(devData.model) + ")";
}

function showInfo() {
    if (!visible) {
        // Add the button to the panel
        Main.panel._rightBox.insert_child_at_index(panelButton, 0);
        visible = true;
    }
}

function hideInfo() {
    if (visible) {
        visible = false;
        Main.panel._rightBox.remove_child(panelButton);
    }
}

function updateBattery() {
    var devices = getConnectedDevices();
    if (devices.length > 0) {
        let inCache = Array.from(devicesData.keys());
        // add new
        let _keys = devices.filter(e => !inCache.includes(e));
        _keys.forEach(function(key) {
            let info = new DeviceInfo();
            info.beginTimestamp = Math.floor(Date.now() / 1000);
            info.refreshTimestamp = info.beginTimestamp;
            devicesData.set(key, info)
        });
        // clean disconnected
        _keys = inCache.filter(e => !devices.includes(e));
        _keys.forEach(key => devicesData.get(key).clean());
        // update devices data
        devices.forEach(function(deviceId, index) {
            let info = getChargeInfo(deviceId);
            if ((info !== "") && (index == 0)) {
                // only first from devices list show
                panelButtonText.set_text(info);
                showInfo();
            }
        });
    } else {
        hideInfo();
        devicesData.forEach(e => e.clean());
    }
    return true;
}

function enable() {
    updateBattery();
    timeout = Mainloop.timeout_add_seconds(10.0, updateBattery);
}

function disable() {
    hideInfo();
    devicesData.forEach(e => e.clean());
    Mainloop.source_remove(timeout);
}

function txtToMap(str) {
    var params = str.split("\n");
    var dict = new Map();
    for (let i = 0; i < params.length; i++) {
        let parts = params[i].split(":");
        dict.set(parts[0].trim(), parts.length > 1 ? parts[1].trim() : "");
    }
    return dict
}
