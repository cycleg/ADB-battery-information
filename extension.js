'use strict';

// max. period without estimations update
const EstimatePeriod = 60;
// info refresh period
const RefreshPeriod = 10;

const {Clutter, Gio, GLib, St} = imports.gi;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const DeviceInfo = Me.imports.DeviceInfo.DeviceInfo;
const PanelMenuBaloon = Me.imports.PanelMenuBaloon.PanelMenuBaloon;

const GETTEXT_DOMAIN = 'ADB-battery-information@golovin.alexei_gmail.com';
const Gettext = imports.gettext.domain(GETTEXT_DOMAIN);
const _ = Gettext.gettext;

let devReference;
let panelButton;
let panelBaloon;
let refreshInfoTimeout;
let visible;
let devicesData = new Map();

function init () {
    var [ok, contents] = GLib.file_get_contents(Me.path + GLib.DIR_SEPARATOR_S + 'devices.json');
    devReference = {
      'hash': '',
      'devices': {},
    };
    if (ok) {
        devReference = JSON.parse(contents);
    }
    visible = false;
    // start adb daemon
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
    if (ret in devReference['devices']) {
        let brand = devReference['devices'][ret]["brand"];
        let name = devReference['devices'][ret]["name"];
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
        devData.beginTimestamp = currTimestamp;
    }
    if (devData.prevBatteryLevel == -1) {
        devData.prevBatteryLevel = currLevel;
    }
    if ((currLevel > devData.prevBatteryLevel) || (currTimestamp - devData.refreshTimestamp > EstimatePeriod)) {
        let speed = (currLevel - devData.beginBatteryLevel) * 1.0 / (currTimestamp - devData.beginTimestamp);
        if (speed > 0) {
            let leadingZeros = (n, len) => n.toString().padStart(len, "0");
            let seconds = (100 - currLevel) * 1.0 / speed;
            let hours = Math.floor(seconds / 3600);
            let mins = Math.floor((seconds - hours * 3600) / 60);
            seconds = Math.round(seconds % 60);
            devData.lastEstimation = ", " + hours + ":" + leadingZeros(mins, 2) + ":" + leadingZeros(seconds, 2);
            devData.prevBatteryLevel = currLevel;
            devData.refreshTimestamp = currTimestamp;
        }
    }
    var message = ((currLevel > -1) ? "" + currLevel + "%" : _("getting info error")) + devData.lastEstimation;
    if (currLevel == 100) {
        message = _("fully charged");
    }
    if (devData.model == "") {
        devData.model = getModel(deviceId);
    }
    devicesData.set(deviceId, devData);
    return getDevDescription(devData.model) + ": " + message;
}

function showInfo() {
    if (!visible) {
        // Add the button to the panel
        panelButton = new PanelMenu.Button()
        let menuLayout = new St.BoxLayout();
        menuLayout.add(new St.Icon({
            style_class: 'system-status-icon',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            gicon: Gio.icon_new_for_string(Me.path + '/icons/android-white.svg'),
        }));
        menuLayout.add(new St.Icon({
            style_class: 'system-status-icon',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            gicon: Gio.icon_new_for_string('. GThemedIcon ac-adapter-symbolic'),
        }));
        panelBaloon = new PanelMenuBaloon(
            menuLayout,
            _('Android devices charge levels'),
            { style_class: 'adb-battery-info-label'}
        );
        panelButton.connect('enter-event', () => {
            panelBaloon.showLabel();
        });
        panelButton.connect('leave-event', () => {
            panelBaloon.hideLabel();
        });
        panelButton.add_actor(menuLayout);
        panelButton.setMenu(new PopupMenu.PopupMenu(panelButton, 0, St.Side.TOP));
        Main.panel.addToStatusArea('ADB-battery-information', panelButton);
        Main.panel._rightBox.insert_child_at_index(panelButton, 0);
        visible = true;
    }
}

function hideInfo() {
    if (visible) {
        visible = false;
        Main.panel._rightBox.remove_child(panelButton);
        Main.panel.statusArea['ADB-battery-information'].destroy();
        panelBaloon.destroy();
        panelBaloon = null;
        panelButton.destroy();
        panelButton = null;
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
        if (visible) {
            panelButton.menu.removeAll();
        }
        devices.forEach(function(deviceId) {
            showInfo();
            let info = getChargeInfo(deviceId);
            let level = devicesData.get(deviceId).prevBatteryLevel;
            let _item = new PopupMenu.PopupBaseMenuItem();
            let _icon_str = '. GThemedIcon ';
            if (level == 100) {
                _icon_str = _icon_str + 'battery-full-charged-symbolic';
            } else if (level > 90) {
                _icon_str = _icon_str + 'battery-full-charging-symbolic battery-full-symbolic';
            } else if (level > 20) {
                _icon_str = _icon_str + 'battery-good-charging-symbolic battery-good-symbolic';
            } else if (level > 14) {
                _icon_str = _icon_str + 'battery-low-charging-symbolic battery-low-symbolic';
            } else if (level > 0) {
                _icon_str = _icon_str + 'battery-caution-charging-symbolic battery-caution-symbolic';
            } else if (level == 0) {
                _icon_str = _icon_str + 'battery-empty-symbolic';
            } else { // -1
                _icon_str = _icon_str + 'battery-missing-symbolic';
            }
            _item.actor.add_child(new St.Icon({
                style_class: 'popup-menu-icon',
                gicon: Gio.icon_new_for_string(_icon_str),
            }));
            _item.actor.add_child(new St.Label({
                text: info == "" ? deviceId + _(": no info") : info,
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.START,
            }));
            panelButton.menu.addMenuItem(_item);
        });
    } else {
        hideInfo();
        devicesData.forEach(e => e.clean());
    }
    return GLib.SOURCE_CONTINUE;
}

function enable() {
    updateBattery();
    refreshInfoTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RefreshPeriod, updateBattery);
}

function disable() {
    hideInfo();
    devicesData.forEach(e => e.clean());
    GLib.Source.remove(refreshInfoTimeout);
    refreshInfoTimeout = null;
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
