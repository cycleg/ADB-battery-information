'use strict';

// max. period without estimations update
const EstimatePeriod = 60;
// info refresh period
const RefreshPeriod = 10;

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DeviceInfo} from './DeviceInfo.js';
import {PanelMenuBaloon} from './PanelMenuBaloon.js';
import {ReferenceStorage} from './ReferenceStorage.js';
import {AdbShell} from './AdbShell.js';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

let adbShell = null;
let dataCollectorTask = null;
let devicesData = new Map();
let extensionEnabled = false;
let extensionFirstEnable = true;
let extensionInitComplete = false;
let isVisible = false;
let Me = null; // extensionObject
let panelButton = null;
let panelBaloon = null;
let storage = null;

function estimationTime(hours, _mins, _secs) {
    const leadingZeros = (n, len) => n.toString().padStart(len, '0');
    const mins = leadingZeros(_mins, 2);
    const secs = leadingZeros(_secs, 2);
    return `, ${hours}:${mins}:${secs} ` + _('to completion');
}

function getChargeInfo(deviceId) {
    let result = adbShell.getChargeInfo(deviceId);
    if (result.size == 0) {
        return '';
    }
    let currTimestamp = Math.floor(Date.now() / 1000);
    let currLevel = result.has('level') ? result.get('level') : -1;
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
            const seconds = (100 - currLevel) * 1.0 / speed;
            const hours = Math.floor(seconds / 3600);
            devData.lastEstimation = estimationTime(
                hours,
                Math.floor((seconds - hours * 3600) / 60),
                Math.round(seconds % 60),
            );
            devData.prevBatteryLevel = currLevel;
            devData.refreshTimestamp = currTimestamp;
        }
    }
    if (devData.lastEstimation == '') {
        devData.lastEstimation = _(', counting time to completion...')
    }
    let message = ((currLevel > -1) ? '' + currLevel + '%' : _('getting info error')) + devData.lastEstimation;
    if (currLevel == 100) {
        message = _('fully charged');
    }
    if (devData.model == '') {
        devData.model = adbShell.getModel(deviceId);
    }
    devicesData.set(deviceId, devData);
    return storage.getDevDescription(devData.model) + ': ' + message;
}

function showInfo() {
    if (!isVisible) {
        // Add the button to the panel
        panelButton = new PanelMenu.Button()
        let menuLayout = new St.BoxLayout();
        menuLayout.add_child(new St.Icon({
            style_class: 'system-status-icon',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            gicon: Gio.icon_new_for_string('. GThemedIcon ac-adapter-symbolic'),
        }));
        menuLayout.add_child(new St.Icon({
            style_class: 'system-status-icon',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            gicon: Gio.icon_new_for_string(Me.path + '/icons/android-white.svg'),
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
        panelButton.add_child(menuLayout);
        panelButton.setMenu(new PopupMenu.PopupMenu(panelButton, 0, St.Side.TOP));
        Main.panel.addToStatusArea('ADB-battery-information', panelButton, 0, 'right');
        isVisible = true;
    }
}

function hideInfo() {
    if (isVisible) {
        isVisible = false;
        Main.panel.statusArea['ADB-battery-information'].destroy();
        panelBaloon.destroy();
        panelBaloon = null;
    }
}

function dataCollectorStep() {
    let devices = adbShell.getConnectedDevices();
    if (devices.length > 0) {
        let inCache = Array.from(devicesData.keys());
        // add new
        let _keys = devices.filter(e => !inCache.includes(e));
        _keys.forEach(function(key) {
            let info = new DeviceInfo();
            info.beginTimestamp = Math.floor(Date.now() / 1000);
            info.refreshTimestamp = info.beginTimestamp;
            devicesData.set(key, info);
            console.log('[ADB-battery-information] Device connected: ' + storage.getDevDescription(adbShell.getModel(key)));
        });
        // clean disconnected
        _keys = inCache.filter(e => !devices.includes(e));
        _keys.forEach(function(key) {
            let devData = devicesData.get(key);
            if (!devData.cleaned) {
                console.log('[ADB-battery-information] Device disconnected: ' + storage.getDevDescription(devData.model));
                devData.clean();
            }
        });
        // update devices data
        if (extensionEnabled) {
            showInfo();
        }
        if (isVisible) {
            if (devices.length == 1) {
                let info = getChargeInfo(devices[0]);
                panelBaloon.set_text(
                    (info == '') ? devices[0] + ': ' + _('no info') : info,
                );
            } else {
                panelBaloon.set_text(_('Android devices charge level'));
            }
            panelButton.menu.removeAll();
            devices.forEach(function(deviceId) {
                let info = getChargeInfo(deviceId);
                let level = devicesData.get(deviceId).prevBatteryLevel;
                let _item = new PopupMenu.PopupBaseMenuItem();
                let _detail = '';
                let _common = '';
                if (level < 0) {
                    _common = 'battery-missing-symbolic';
                }
                if (level == 0) {
                    _common = 'battery-empty-charging-symbolic';
                }
                if (level > 0) {
                    _common = 'battery-caution-charging-symbolic battery-caution-symbolic';
                }
                if (level > 10) {
                    _detail = 'battery-level-10-charging-symbolic ';
                    _common = 'battery-low-charging-symbolic battery-low-symbolic';
                }
                if ((level >= 20) && (level < 90)) {
                    _detail = 'battery-level-' + Math.floor(level / 10) * 10 + '-charging-symbolic ';
                    _common = 'battery-good-charging-symbolic battery-good-symbolic';
                }
                if (level >= 90) {
                    _detail = 'battery-level-90-charging-symbolic ';
                    _common = 'battery-full-charging-symbolic battery-full-symbolic';
                }
                if (level == 100) {
                    _common = 'battery-full-charged-symbolic battery-full-symbolic';
                }
                _item.add_child(new St.Icon({
                    style_class: 'popup-menu-icon',
                    gicon: Gio.icon_new_for_string('. GThemedIcon ' + _detail + _common),
                }));
                _item.add_child(new St.Label({
                    text: info == '' ? deviceId + ': ' + _('no info') : info,
                    x_align: Clutter.ActorAlign.START,
                    y_align: Clutter.ActorAlign.START,
                }));
                panelButton.menu.addMenuItem(_item);
            });
        }
    } else {
        hideInfo();
        devicesData.forEach(function(devData) {
            if (!devData.cleaned) {
                console.log('[ADB-battery-information] Device disconnected: ' + storage.getDevDescription(devData.model));
                devData.clean();
            }
        });
    }
    return GLib.SOURCE_CONTINUE;
}

function runDataCollector() {
    if (dataCollectorTask == null) {
        dataCollectorTask = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RefreshPeriod, dataCollectorStep);
    }
}

function stopDataCollector() {
    if (dataCollectorTask != null) {
        GLib.Source.remove(dataCollectorTask);
        dataCollectorTask = null;
    }
}

export default class AdbBatteryInfoExtension extends Extension {
    constructor(metadata) {
        let ok = false;
        let childPid = null;
        super(metadata);
        adbShell = new AdbShell();
        Me = this
        storage = new ReferenceStorage(this);
        // start adb daemon
        try {
            [ok, childPid] = adbShell.init();
        } catch (err) {
           console.error('[ADB-battery-information] --- %s ---', err);
           console.error('[ADB-battery-information] --- Initialization failed ---');
        }
        if (ok) {
            GLib.spawn_close_pid(childPid);
            extensionInitComplete = true;
        }
        if (extensionInitComplete) {
            console.log('[ADB-battery-information] --- Init from "%s" ---', Me.path);
        }
    }

    enable() {
        if (!extensionInitComplete || extensionEnabled) {
            return;
        }
        if (storage.empty) {
            storage.loadGSettings();
        }
        if (storage.empty) {
            storage.loadFromFile();
            storage.saveGSettings();
        }
        if (storage.empty || extensionFirstEnable) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                storage.loadRemote();
                return GLib.SOURCE_REMOVE;
            });
        }
        storage.saveFileIfNotExists();
        extensionEnabled = true;
        showInfo();
        dataCollectorStep();
        if (extensionFirstEnable) {
            runDataCollector();
            extensionFirstEnable = false;
        }
        console.log('[ADB-battery-information] --- Enable ---');
    }

    disable() {
        if (!extensionInitComplete || !extensionEnabled) {
            return;
        }
        hideInfo();
/*
        stopDataCollector();
*/
        extensionEnabled = false;
        console.log('[ADB-battery-information] --- Disable ---');
    }
}
