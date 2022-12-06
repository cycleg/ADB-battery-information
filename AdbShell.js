'use strict';

const ByteArray = imports.byteArray;
const {GLib} = imports.gi;

var AdbShell = class AdbShell {
    _txtToMap(str) {
        let params = str.split("\n");
        let dict = new Map();
        for (let i = 0; i < params.length; i++) {
            let parts = params[i].split(":");
            dict.set(parts[0].trim(), parts.length > 1 ? parts[1].trim() : "");
        }
        return dict;
    }

    _spawn_async(_arguments) {
        let args = Array.from(['adb']).concat(_arguments);
        return GLib.spawn_async(null, args, null, GLib.SpawnFlags.SEARCH_PATH, null);
    }

    _spawn_sync(_arguments) {
        let args = Array.from(['adb']).concat(_arguments);
        return GLib.spawn_sync(null, args, null, GLib.SpawnFlags.SEARCH_PATH, null);
    }

    init() {
        return this._spawn_async(['devices']);
    }

    getConnectedDevices() {
        let devices = [];
        let [res, out, error, status] = this._spawn_sync(['devices']);
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

    getModel(deviceId) {
        let [res, out, error, status] = this._spawn_sync(['-s', deviceId, 'shell', 'getprop', 'ro.product.model']);
        if (status !== 0) {
            return '';
        }
        return ByteArray.toString(out).replace("\n", "");
    }

    getChargeInfo(deviceId) {
        let dict = new Map();
        let [res, out, error, status] = this._spawn_sync(['-s', deviceId, 'shell', 'dumpsys', 'battery']);
        if (status !== 0) {
            return dict;
        }
        dict = this._txtToMap(ByteArray.toString(out));
        return dict;
    }
}
