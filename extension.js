'use strict';

// max. period without estimations update
const EstimatePeriod = 60;
// info refresh period
const RefreshPeriod = 10;

const ByteArray = imports.byteArray;
const {Clutter, Gio, GLib, St} = imports.gi;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const DeviceInfo = Me.imports.DeviceInfo.DeviceInfo;
const PanelMenuBaloon = Me.imports.PanelMenuBaloon.PanelMenuBaloon;
const ReferenceStorage = Me.imports.ReferenceStorage.ReferenceStorage

const GETTEXT_DOMAIN = 'ADB-battery-information@golovin.alexei_gmail.com';
const Gettext = imports.gettext.domain(GETTEXT_DOMAIN);
const _ = Gettext.gettext;

let storage = null;
let panelButton = null;
let panelBaloon = null;
let initComplete = false;
let firstEnable = true;
let visible = false;
let enabled = false;
let refreshInfoTask = null;
let devicesData = new Map();

function init () {
    let ok = false;
    let childPid = null;
    storage = new ReferenceStorage();
    // start adb daemon
    try {
        [ok, childPid] = GLib.spawn_async(
            null,
            ["adb", "devices"],
            null,
            GLib.SpawnFlags.SEARCH_PATH,
            null,
        );
    } catch (err) {
       console.error('[ADB-battery-information] --- %s ---', err);
       console.error('[ADB-battery-information] --- Initialization failed ---');
    }
    if (ok) {
        GLib.spawn_close_pid(childPid);
        initComplete = true;
    }
    if (initComplete) {
        console.log('[ADB-battery-information] --- Init from "%s" ---', Me.path);
    }
}

function getConnectedDevices() {
    let devices = [];
    let [res, out, error, status] = GLib.spawn_sync(
        null,
        ["adb", "devices"],
        null,
        GLib.SpawnFlags.SEARCH_PATH,
        null,
    );
    if (status !== 0) {
        return devices;
    }
    let lines = ByteArray.toString(out).split("\n");
    if (lines.length < 2) {
        return devices;
    }
    for (let i = 1; i < lines.length; i++) {
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
    let [res, out, error, status] = GLib.spawn_sync(
        null,
        ["adb", "-s", deviceId, 'shell', 'getprop', 'ro.product.model'],
        null,
        GLib.SpawnFlags.SEARCH_PATH,
        null,
    );
    return ByteArray.toString(out).replace("\n", "");
}

function getChargeInfo(deviceId) {
    let [res, out, error, status] = GLib.spawn_sync(
        null,
        ["adb", "-s", deviceId, 'shell', 'dumpsys', 'battery'],
        null,
        GLib.SpawnFlags.SEARCH_PATH,
        null,
    );
    if (status !== 0) {
        return "";
    }
    let result = txtToMap(ByteArray.toString(out));
    if (result.size == 0) {
        return "";
    }
    let currTimestamp = Math.floor(Date.now() / 1000);
    let currLevel = result.has("level") ? result.get("level") : -1;
    let devData = devicesData.get(deviceId)
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
    let message = ((currLevel > -1) ? "" + currLevel + "%" : _("getting info error")) + devData.lastEstimation;
    if (currLevel == 100) {
        message = _("fully charged");
    }
    if (devData.model == "") {
        devData.model = getModel(deviceId);
    }
    devicesData.set(deviceId, devData);
    return storage.getDevDescription(devData.model) + ": " + message;
}

function runDataCollector() {
    if (refreshInfoTask == null) {
        refreshInfoTask = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RefreshPeriod, updateBattery);
    }
}

function stopDataCollector() {
    if (refreshInfoTask != null) {
        GLib.Source.remove(refreshInfoTask);
        refreshInfoTask = null;
    }
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
            _('Android devices charge level'),
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
        Main.panel.addToStatusArea('ADB-battery-information', panelButton, 0, 'right');
        visible = true;
    }
}

function hideInfo() {
    if (visible) {
        visible = false;
        Main.panel.statusArea['ADB-battery-information'].destroy();
        panelBaloon.destroy();
        panelBaloon = null;
        panelButton.destroy();
        panelButton = null;
    }
}

function updateBattery() {
    let devices = getConnectedDevices();
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
        if (enabled) {
            showInfo();
        }
        if (visible) {
            if (devices.length == 1) {
                let info = getChargeInfo(devices[0]);
                panelBaloon.set_text(
                    (info == '') ?  devices[0] + ": " + _("no info") : info,
                );
            } else {
                panelBaloon.set_text(_('Android devices charge level'));
            }
            panelButton.menu.removeAll();
        }
        devices.forEach(function(deviceId) {
            let info = getChargeInfo(deviceId);
            if (!visible) {
                return;
            }
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
                text: info == "" ? deviceId + ": " + _("no info") : info,
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
    if (!initComplete || enabled) {
        return;
    }
    if (storage.empty) {
        storage.loadGSettings();
    }
    if (storage.empty) {
        storage.loadFromFile();
        storage.saveGSettings();
    }
    if (storage.empty || firstEnable) {
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            storage.loadRemote();
            return GLib.SOURCE_REMOVE;
        });
    }
    storage.saveFileIfNotExists();
    enabled = true;
    showInfo();
    updateBattery();
    if (firstEnable) {
        runDataCollector();
        firstEnable = false;
    }
    console.log('[ADB-battery-information] --- Enable ---');
}

function disable() {
    if (!initComplete || !enabled) {
        return;
    }
    hideInfo();
    /*
    stopDataCollector();
    */
    enabled = false;
    console.log('[ADB-battery-information] --- Disable ---');
}

function txtToMap(str) {
    let params = str.split("\n");
    let dict = new Map();
    for (let i = 0; i < params.length; i++) {
        let parts = params[i].split(":");
        dict.set(parts[0].trim(), parts.length > 1 ? parts[1].trim() : "");
    }
    return dict
}
