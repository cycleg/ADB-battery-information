'use strict';

// from unistd.h
/* Values for the second argument to access().
   These may be OR'd together.  */
const R_OK = 4;   /* Test for read permission.  */
const W_OK = 2;   /* Test for write permission.  */
const X_OK = 1;   /* Test for execute permission.  */
const F_OK = 0;   /* Test for existence.  */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {HttpDownloader} from './HttpDownloader.js';
import * as CSV from './CSV.js';

export class ReferenceStorage {
    // Google Play supported devices, https://support.google.com/googleplay/answer/1727131
    static DEVICES_DB_URL = 'https://storage.googleapis.com/play_public/supported_devices.csv';
    static DEVICES_DB_FILE = 'devices.json';
    static GSETTINGS_SCHEMA_ID_PREFIX = 'org.gnome.shell.extensions.adb_bp@gnome_extensions.github.com.';
    static FIELDS = ['brand', 'name', 'device'];
    static FIELDS_TO_CSV = {
        'brand': '﻿Retail Branding',
        'name': 'Marketing Name',
        'device': 'Device',
    };
    static CSV_DIALECT = {
        quote: '"',
        separators: ',',
        ignoreSpacesAfterQuotedString: true,
        linefeedBeforeEOF: true,
    };

    static _unicodeToGSettingPath = function(str) {
        return str.replace(/./g, function(ch) {
            return 'u' + ('000' + ch.charCodeAt().toString(16)).slice(-4);
        });
    };

    static _gSettingPathToUnicode = function(str) {
        return JSON.parse('"' + str.replaceAll('u', '\\u') + '"');
    };

    constructor(extensionObject) {
        this._updateState = 'end';
        this._extensionObject = extensionObject
        this._clear();
    }

    get _cacheFile() {
        return this._extensionObject.path + GLib.DIR_SEPARATOR_S + ReferenceStorage.DEVICES_DB_FILE;
    }

    get empty() {
        return this._hash == '';
    }

    get updateDate() {
        return new Date(this._timestamp * 1000)
    }

    _clear() {
        this._reference = {};
        this._hash = '';
        this._timestamp = 0;
    }

    _loadSettingsSchema(schema) {
        const GioSSS = Gio.SettingsSchemaSource;
        let schemaSource = GioSSS.new_from_directory(
            this._extensionObject.dir.get_child('schemas').get_path(),
            GioSSS.get_default(),
            false,
        );
        let schemaObj = schemaSource.lookup(ReferenceStorage.GSETTINGS_SCHEMA_ID_PREFIX + schema, true);
        if (!schemaObj)
            throw new Error(
                `schema ${ReferenceStorage.GSETTINGS_SCHEMA_ID_PREFIX + schema} could not be found`,
            );
        return schemaObj;
    }

    getDevDescription(model) {
        let ret = model;
        if (ret in this._reference) {
            let brand = this._reference[ret].brand;
            let name = this._reference[ret].name;
            let [gt, lt] = brand.length >= name ? [brand, name] : [name, brand];
            ret = (gt.indexOf(lt) == -1 ? brand : "")  + ((name !== "") ? " " + name : "");
        }
        return (ret !== "") ? ret : model;
    }

    loadFromFile() {
        const cache = this._cacheFile;
        let ok;
        let contents;
        if (GLib.access(cache, F_OK | R_OK) == -1) {
            console.log(
                '[ADB-battery-information] Devices reference storage "%s" not exists or not readable.',
                cache,
            );
            return
        }
        try {
            [ok, contents] = GLib.file_get_contents(cache);
        } catch(err) {
            console.warn(
                '[ADB-battery-information] Devices reference storage "%s" loading error: %s',
                cache,
                err,
            );
            return;
        }
        if (ok) {
            let devReference = JSON.parse(contents);
            for (const [key, value] of Object.entries(devReference.items)) {
                this._reference[key] = value;
            }
            this._hash = devReference.hash;
            this._timestamp = devReference.timestamp;
            console.log(
                '[ADB-battery-information] Stored devices reference loaded from "%s".',
                cache,
            );
        } else {
            console.warn(
                '[ADB-battery-information] Stored devices reference not loaded from "%s".',
                cache,
            );
        }
    }

    loadGSettings() {
        let schemaObj = this._loadSettingsSchema('device-reference');
        let settings = new Gio.Settings({ settings_schema: schemaObj });
        try {
            this._hash = settings.get_string('hash');
            this._timestamp = settings.get_uint64('timestamp');
            ReferenceStorage.FIELDS.forEach(attr => {
                let ref = settings.get_value(attr).deep_unpack();
                for (const [key, value] of Object.entries(ref)) {
                    if (!(key in this._reference)) {
                        this._reference[key] = {};
                        ReferenceStorage.FIELDS.forEach(a => this._reference[key][a] = '');
                    }
                    this._reference[key][attr] = value;
                }
            });
        } catch(err) {
            this._clear();
        }
    }

    saveGSettings() {
        let schemaObj = this._loadSettingsSchema('device-reference');
        let settings = new Gio.Settings({ settings_schema: schemaObj });
        settings.delay();
        settings.set_string('hash', this._hash);
        settings.set_uint64('timestamp', this._timestamp);
        ReferenceStorage.FIELDS.forEach(attr => {
            let valueType = settings.get_value(attr).get_type_string();
            let ref = {};
            for (const [key, content] of Object.entries(this._reference)) {
                ref[key] = content[attr]
            }
            settings.set_value(attr, GLib.Variant.new(valueType, ref));
        });
        settings.apply();
        Gio.Settings.sync();
    }

    _saveFile() {
        let content = {
            hash: this._hash,
            timestamp: this._timestamp,
            items: {},
        };
        for (const [key, value] of Object.entries(this._reference)) {
          content.items[key] = value;
        };
        let fout = Gio.File.new_for_path(this._cacheFile);
        let [ok, etag] = fout.replace_contents(
            JSON.stringify(content, null, 2),
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null,
        );
        GLib.free(etag);
        return ok;
    }

    saveFileIfNotExists() {
        if (!GLib.file_test(this._cacheFile, GLib.FileTest.EXISTS) &&
            (this._updateState == 'end')) {
            if (!this._saveFile()) {
                console.error(
                    "[ADB-battery-information] Can't store devices reference to file \"%s\"",
                    this._cacheFile,
                );
            }
        }
    }

    loadRemote() {
        if (this._updateState != 'end') {
            console.warn(
                '[ADB-battery-information] Devices reference update already running.',
            );
            return;
        }
        console.log(
            '[ADB-battery-information] Devices reference update from remote resource "%s".',
            ReferenceStorage.DEVICES_DB_URL,
        );
        this._updateState = 'checkHash';
        let downloader = new HttpDownloader();
        // simple state machine
        downloader.head(
            ReferenceStorage.DEVICES_DB_URL
        ).then(
            this._smCheckHash.bind(this),
        ).then(
            this._smLoadFile.bind(this),
        ).catch(
            this._smFinalize.bind(this),
        );
    }

    _smCheckHash(downloader) {
        this._updateState = (downloader.hash == this._hash) ? 'end' : 'loadFile';
        if (this._updateState == 'end') {
            console.log(
                '[ADB-battery-information] Remote resource not changed; last updated at %s.',
                this.updateDate.toLocaleString(),
            );
            return new Promise((resolve, reject) => {
                reject(downloader);
            });
        }
        console.log(
            '[ADB-battery-information] Downloading remote resource...',
        );
        return downloader.get(ReferenceStorage.DEVICES_DB_URL);
    }

    _smLoadFile(downloader) {
        let devReference = {};
        console.log(
            '[ADB-battery-information] Remote resource successfully loaded.',
        );
        try {
            let decoder = new TextDecoder(downloader.charset);
            let parsed = CSV.parse(
                decoder.decode(downloader.data.toArray()),
                ReferenceStorage.CSV_DIALECT,
            );
            parsed.mappedRows.forEach(function(row) {
                devReference[row["Model"]] = {};
                ReferenceStorage.FIELDS.forEach(
                    attr => devReference[row["Model"]][attr] = row[ReferenceStorage.FIELDS_TO_CSV[attr]]
                );
            });
            this._updateState = 'saveFile';
        } catch (err) {
            console.error('[ADB-battery-information] Parse error %s', err);
            this._updateState = 'end';
        }
        if (this._updateState == 'saveFile') {
            this._reference = devReference;
            this._hash = downloader.hash;
            this._timestamp = Math.floor(Date.now() / 1000);
            let ok = this._saveFile();
            if (ok) {
                console.log(
                    '[ADB-battery-information] Devices reference stored.',
                );
            } else {
                console.error(
                    "[ADB-battery-information] Can't save devices reference to file \"%s\"",
                    this._cacheFile,
                );
            }
            this.saveGSettings();
            this._updateState = 'end';
        }
        return new Promise((resolve, reject) => {
            reject(downloader);
        });
        // ...or simply call
        // _smFinalize(downloader);
    }

    _smFinalize(downloader) {
        if (this._updateState == 'checkHash') {
            if (downloader.error) {
                console.error(
                    '[ADB-battery-information] Check remote resource error: %s',
                    downloader.error,
                );
            } else {
                console.error(
                    '[ADB-battery-information] Remote resource status: %d %s',
                    downloader.request.status_code,
                    downloader.request.reason_phrase,
                );
            }
            this._updateState = 'end';
        }
        if (this._updateState == 'loadFile') {
            if (downloader.error) {
                console.error(
                    '[ADB-battery-information] Remote resource loading error: %s',
                    downloader.error,
                );
            } else {
                console.error(
                    '[ADB-battery-information] Remote resource loading status: %d %s',
                    downloader.request.status_code,
                    downloader.request.reason_phrase,
                );
            }
            this._updateState = 'end';
        }
        console.log(
            '[ADB-battery-information] Devices reference update complete.',
        );
    }
}
